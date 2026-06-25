/**
 * Tests for POST /api/pdf/page-boxes — read/write the five PDF page boxes.
 *
 * Strategy (mirrors pdfa.test.ts):
 *   - Mock @qrcommunication/gigapdf-lib so the WASM engine never loads in jsdom.
 *     The fake GigaPdfDoc returns a plain PageBoxes object for `get` and real
 *     `%PDF` bytes from save() for `set`, so the route contract — status,
 *     headers, body, and which engine method runs for each mode — is exercised
 *     end to end. PAGE_BOX_KINDS is re-exported because the route reads it at
 *     runtime to validate the `kind` field.
 *   - Use the REAL validatePdfFile / sanitizeContentDisposition (server-only is
 *     stubbed so they import in jsdom).
 *   - Mock @/lib/auth-helpers to control auth, and the logger to stay quiet.
 *   - Drive POST directly with a fake Request whose formData() resolves sync.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── jsdom polyfill: File.prototype.arrayBuffer ────────────────────────────────
if (!('arrayBuffer' in File.prototype)) {
  Object.defineProperty(File.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value: function (this: File): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    },
  });
}

// ── Hoisted engine mocks (referenced by the vi.mock factory AND the tests) ────
const engine = vi.hoisted(() => ({
  getPageBoxes: vi.fn(),
  setPageBox: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
  loadDefault: vi.fn(),
}));

vi.mock('@qrcommunication/gigapdf-lib', () => ({
  GigaPdfEngine: { loadDefault: engine.loadDefault },
  // The route validates the untrusted `kind` field against this runtime value.
  PAGE_BOX_KINDS: ['media', 'crop', 'bleed', 'trim', 'art'],
}));

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/server-logger', () => ({
  serverLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// 'server-only' guard — pulled in by request-validation + content-disposition.
vi.mock('server-only', () => ({}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '../page-boxes/route';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const FAKE_BOXES = {
  media: [0, 0, 612, 792],
  crop: [0, 0, 612, 792],
  bleed: [0, 0, 612, 792],
  trim: [0, 0, 612, 792],
  art: [0, 0, 612, 792],
  declared: { media: true, crop: false, bleed: false, trim: false, art: false },
};

const mockAuthOk = {
  ok: true as const,
  context: { userId: 'user-123', email: 'test@example.com', role: 'user' },
};

const mockAuthFail = {
  ok: false as const,
  response: new Response(JSON.stringify({ success: false, error: 'Authentication required.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  }),
};

function makeFile(name: string, content: Uint8Array, type = 'application/pdf'): File {
  const plain = new Uint8Array(new ArrayBuffer(content.byteLength));
  plain.set(content);
  return new File([plain], name, { type });
}

function makeRequest(fields: { key: string; value: File | string }[]): Request {
  const fd = new FormData();
  for (const { key, value } of fields) fd.append(key, value);
  const req = new Request('http://localhost/api/pdf/page-boxes', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'text/plain' },
  });
  Object.defineProperty(req, 'formData', { value: () => Promise.resolve(fd) });
  return req;
}

async function bodyStartsWithPdf(res: Response): Promise<boolean> {
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/page-boxes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    engine.getPageBoxes.mockReturnValue(FAKE_BOXES);
    engine.setPageBox.mockReturnValue(true);
    engine.save.mockReturnValue(FAKE_PDF);
    engine.close.mockReturnValue(undefined);
    engine.open.mockReturnValue({
      getPageBoxes: engine.getPageBoxes,
      setPageBox: engine.setPageBox,
      save: engine.save,
      close: engine.close,
    });
    engine.loadDefault.mockResolvedValue({ open: engine.open });
  });

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await POST(makeRequest([{ key: 'file', value: makeFile('a.pdf', FAKE_PDF) }]));
    expect(res.status).toBe(401);
    expect(engine.getPageBoxes).not.toHaveBeenCalled();
  });

  it('default mode → 200 JSON with the five boxes, getPageBoxes(page 1)', async () => {
    const res = await POST(makeRequest([{ key: 'file', value: makeFile('doc.pdf', FAKE_PDF) }]));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = (await res.json()) as { success: boolean; page: number; boxes: typeof FAKE_BOXES };
    expect(body.success).toBe(true);
    expect(body.page).toBe(1);
    expect(body.boxes).toEqual(FAKE_BOXES);
    expect(engine.getPageBoxes).toHaveBeenCalledWith(1);
    expect(engine.setPageBox).not.toHaveBeenCalled();
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('mode=get honours an explicit 1-based page', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'mode', value: 'get' },
        { key: 'page', value: '4' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.getPageBoxes).toHaveBeenCalledWith(4);
  });

  it('mode=set → 200 application/pdf, setPageBox(page, kind, {x,y,w,h}) + save()', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'mode', value: 'set' },
        { key: 'page', value: '2' },
        { key: 'kind', value: 'trim' },
        { key: 'x', value: '10' },
        { key: 'y', value: '20' },
        { key: 'w', value: '100' },
        { key: 'h', value: '200' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(engine.setPageBox).toHaveBeenCalledWith(2, 'trim', { x: 10, y: 20, w: 100, h: 200 });
    expect(engine.save).toHaveBeenCalledTimes(1);
    expect(res.headers.get('X-Page-Box-Kind')).toBe('trim');
    expect(res.headers.get('X-Page-Number')).toBe('2');
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for an unknown mode', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'mode', value: 'patch' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/mode must be/i);
  });

  it('returns 400 for a non-positive / non-integer page', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'page', value: '0' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/page must be/i);
  });

  it('mode=set returns 400 for an unknown kind', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'mode', value: 'set' },
        { key: 'kind', value: 'spine' },
        { key: 'x', value: '0' },
        { key: 'y', value: '0' },
        { key: 'w', value: '10' },
        { key: 'h', value: '10' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/kind must be one of/i);
    expect(engine.setPageBox).not.toHaveBeenCalled();
  });

  it('mode=set returns 400 when x/y/w/h are missing', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'mode', value: 'set' },
        { key: 'kind', value: 'crop' },
        { key: 'x', value: '0' },
        { key: 'y', value: '0' },
        // w and h omitted
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/required finite numbers/i);
  });

  it('mode=set returns 400 for a degenerate box (w <= 0)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'mode', value: 'set' },
        { key: 'kind', value: 'media' },
        { key: 'x', value: '0' },
        { key: 'y', value: '0' },
        { key: 'w', value: '0' },
        { key: 'h', value: '100' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/greater than 0/i);
    expect(engine.setPageBox).not.toHaveBeenCalled();
  });

  it('mode=set returns 422 when the engine rejects the box', async () => {
    engine.setPageBox.mockReturnValue(false);
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'mode', value: 'set' },
        { key: 'kind', value: 'art' },
        { key: 'x', value: '0' },
        { key: 'y', value: '0' },
        { key: 'w', value: '10' },
        { key: 'h', value: '10' },
      ]),
    );
    expect(res.status).toBe(422);
    expect(engine.save).not.toHaveBeenCalled();
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('returns 422 when the engine cannot open the PDF', async () => {
    engine.open.mockImplementation(() => {
      throw new Error('invalid xref table');
    });
    const res = await POST(makeRequest([{ key: 'file', value: makeFile('doc.pdf', FAKE_PDF) }]));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/operation failed/i);
  });

  it('returns 400 when no file is supplied', async () => {
    const res = await POST(makeRequest([{ key: 'mode', value: 'get' }]));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the file is empty', async () => {
    const res = await POST(
      makeRequest([{ key: 'file', value: makeFile('empty.pdf', new Uint8Array(0)) }]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/empty/i);
  });
});
