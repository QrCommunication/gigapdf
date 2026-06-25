/**
 * Tests for POST /api/pdf/pdfa — PDF/A + PDF/UA (accessible, tagged) export.
 *
 * Strategy (mirrors merge-universal.test.ts):
 *   - Mock @qrcommunication/gigapdf-lib so the WASM engine never loads in jsdom.
 *     The fake GigaPdfDoc returns real `%PDF` bytes, so the route contract —
 *     status, headers, body magic, and which engine method is called for each
 *     conformance choice — is exercised end to end.
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
  toPdfA: vi.fn(),
  toTagged: vi.fn(),
  figureCount: vi.fn(),
  setFigureAlt: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
  loadDefault: vi.fn(),
}));

vi.mock('@qrcommunication/gigapdf-lib', () => ({
  GigaPdfEngine: { loadDefault: engine.loadDefault },
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

import { POST } from '../pdfa/route';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

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
  const req = new Request('http://localhost/api/pdf/pdfa', {
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

describe('POST /api/pdf/pdfa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    engine.toPdfA.mockReturnValue(FAKE_PDF);
    engine.toTagged.mockReturnValue(FAKE_PDF);
    engine.figureCount.mockReturnValue(0);
    engine.setFigureAlt.mockReturnValue(true);
    engine.close.mockReturnValue(undefined);
    engine.open.mockReturnValue({
      toPdfA: engine.toPdfA,
      toTagged: engine.toTagged,
      figureCount: engine.figureCount,
      setFigureAlt: engine.setFigureAlt,
      close: engine.close,
    });
    engine.loadDefault.mockResolvedValue({ open: engine.open });
  });

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await POST(makeRequest([{ key: 'file', value: makeFile('a.pdf', FAKE_PDF) }]));
    expect(res.status).toBe(401);
  });

  it('default → 200, application/pdf, body %PDF, toPdfA("pdfa-2u")', async () => {
    const res = await POST(makeRequest([{ key: 'file', value: makeFile('doc.pdf', FAKE_PDF) }]));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(engine.toPdfA).toHaveBeenCalledWith('pdfa-2u');
    expect(engine.toTagged).not.toHaveBeenCalled();
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit level-A variant (pdfa-2a)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'variant', value: 'pdfa-2a' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.toPdfA).toHaveBeenCalledWith('pdfa-2a');
    expect(res.headers.get('X-PDF-Conformance')).toBe('pdfa-2a');
  });

  it('returns 400 for an unknown variant', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'variant', value: 'pdfa-9z' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/variant must be one of/i);
  });

  it('pdfUa=true → toTagged({pdfUa:true}), not toPdfA, .ua.pdf + pdf-ua-1 header', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'pdfUa', value: 'true' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.toTagged).toHaveBeenCalledWith({ pdfUa: true });
    expect(engine.toPdfA).not.toHaveBeenCalled();
    expect(res.headers.get('X-PDF-Conformance')).toBe('pdf-ua-1');
    expect(res.headers.get('Content-Disposition')).toContain('doc.ua.pdf');
  });

  it('applies figure alt-text bounded by figureCount()', async () => {
    engine.figureCount.mockReturnValue(2);
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'variant', value: 'pdfa-2a' },
        { key: 'figureAlts', value: JSON.stringify(['Alpha', 'Beta', 'Gamma']) },
      ]),
    );
    expect(res.status).toBe(200);
    // figureCount = 2 → only the first two of three alts are applied.
    expect(engine.setFigureAlt).toHaveBeenCalledTimes(2);
    expect(engine.setFigureAlt).toHaveBeenNthCalledWith(1, 0, 'Alpha');
    expect(engine.setFigureAlt).toHaveBeenNthCalledWith(2, 1, 'Beta');
  });

  it('skips empty alt entries (keeps the engine placeholder)', async () => {
    engine.figureCount.mockReturnValue(2);
    await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'variant', value: 'pdfa-1a' },
        { key: 'figureAlts', value: JSON.stringify(['', '  ']) },
      ]),
    );
    expect(engine.setFigureAlt).not.toHaveBeenCalled();
  });

  it('returns 400 when figureAlts is not a JSON array', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'figureAlts', value: '{"not":"an array"}' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/figureAlts must be a JSON array/i);
  });

  it('returns 422 when the engine cannot process the PDF', async () => {
    engine.open.mockImplementation(() => {
      throw new Error('invalid xref table');
    });
    const res = await POST(makeRequest([{ key: 'file', value: makeFile('doc.pdf', FAKE_PDF) }]));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/conversion failed/i);
  });

  it('returns 400 when no file is supplied', async () => {
    const res = await POST(makeRequest([{ key: 'variant', value: 'pdfa-2b' }]));
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

  it('names the download <base>.pdfa.pdf for a PDF/A variant', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('report.pdf', FAKE_PDF) },
        { key: 'variant', value: 'pdfa-2b' },
      ]),
    );
    expect(res.headers.get('Content-Disposition')).toContain('report.pdfa.pdf');
  });
});
