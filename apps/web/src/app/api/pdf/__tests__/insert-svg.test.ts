/**
 * Tests for POST /api/pdf/insert-svg (embed an inline SVG onto a page).
 *
 * Strategy (mirrors links.test.ts):
 *   - Mock @giga-pdf/pdf-engine so the WASM engine never loads in jsdom. The
 *     mock `openDocument` returns a handle whose `_doc` exposes pageCount() and
 *     addSvg(). The route contract — status, headers, validation, the engine
 *     call args — is exercised end to end without real PDF bytes.
 *   - Mock @/lib/auth-helpers, @/lib/server-logger and 'server-only'.
 *   - Drive the POST handler with a fake Request whose formData() resolves
 *     synchronously (jsdom cannot parse multipart streams).
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

// ── Mocks (declared before route imports) ─────────────────────────────────────

vi.mock('@giga-pdf/pdf-engine', () => {
  const PDFCorruptedError = class PDFCorruptedError extends Error {
    constructor(message = 'corrupted') {
      super(message);
      this.name = 'PDFCorruptedError';
    }
  };
  return {
    openDocument: vi.fn(),
    saveDocument: vi.fn(),
    PDFCorruptedError,
  };
});

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/server-logger', () => ({
  serverLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('server-only', () => ({}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST as insertSvgPOST } from '../insert-svg/route';
import { openDocument, saveDocument } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const PAGE_COUNT = 4;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';

const mockAuthOk = {
  ok: true as const,
  context: { userId: 'user-123', email: 'test@example.com', role: 'user' },
};

const mockAuthFail = {
  ok: false as const,
  response: new Response(
    JSON.stringify({ success: false, error: 'Authentication required.' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  ),
};

function makeDoc() {
  return {
    pageCount: vi.fn(() => PAGE_COUNT),
    addSvg: vi.fn(() => true),
  };
}

function makeHandle(doc: ReturnType<typeof makeDoc>) {
  return { id: 'h1', pageCount: PAGE_COUNT, isDirty: false, wasEncrypted: false, _doc: doc };
}

function makeFile(name = 'doc.pdf'): File {
  const plain = new Uint8Array(new ArrayBuffer(FAKE_PDF.byteLength));
  plain.set(FAKE_PDF);
  return new File([plain], name, { type: 'application/pdf' });
}

function makeRequest(fields: { key: string; value: File | string }[]): Request {
  const fd = new FormData();
  for (const { key, value } of fields) fd.append(key, value);
  const req = new Request('http://localhost/api/pdf/insert-svg', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'text/plain' },
  });
  Object.defineProperty(req, 'formData', { value: () => Promise.resolve(fd) });
  return req;
}

function baseFields(over: Partial<Record<string, string>> = {}) {
  return [
    { key: 'file', value: makeFile() },
    { key: 'svg', value: over.svg ?? SVG },
    { key: 'page', value: over.page ?? '2' },
    { key: 'x', value: over.x ?? '72' },
    { key: 'y', value: over.y ?? '100' },
    { key: 'w', value: over.w ?? '200' },
    { key: 'h', value: over.h ?? '150' },
  ];
}

async function bodyStartsWithPdf(res: Response): Promise<boolean> {
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/insert-svg', () => {
  let doc: ReturnType<typeof makeDoc>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    doc = makeDoc();
    vi.mocked(openDocument).mockResolvedValue(makeHandle(doc) as never);
    vi.mocked(saveDocument).mockResolvedValue(Buffer.from(FAKE_PDF) as never);
  });

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await insertSvgPOST(makeRequest(baseFields()));
    expect(res.status).toBe(401);
  });

  it('embeds the SVG and returns the PDF binary', async () => {
    const res = await insertSvgPOST(makeRequest(baseFields()));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(doc.addSvg).toHaveBeenCalledWith(2, SVG, 72, 100, 200, 150);
  });

  it('rejects a missing file with 400', async () => {
    const res = await insertSvgPOST(
      makeRequest(baseFields().filter((f) => f.key !== 'file')),
    );
    expect(res.status).toBe(400);
    expect(doc.addSvg).not.toHaveBeenCalled();
  });

  it('rejects non-SVG markup with 400', async () => {
    const res = await insertSvgPOST(
      makeRequest(baseFields({ svg: '<html><body>nope</body></html>' })),
    );
    expect(res.status).toBe(400);
    expect(doc.addSvg).not.toHaveBeenCalled();
  });

  it('accepts an XML-prolog SVG', async () => {
    const xml = `<?xml version="1.0"?>${SVG}`;
    const res = await insertSvgPOST(makeRequest(baseFields({ svg: xml })));
    expect(res.status).toBe(200);
    expect(doc.addSvg).toHaveBeenCalledWith(2, xml, 72, 100, 200, 150);
  });

  it('rejects a page out of range with 400', async () => {
    const res = await insertSvgPOST(makeRequest(baseFields({ page: '99' })));
    expect(res.status).toBe(400);
    expect(doc.addSvg).not.toHaveBeenCalled();
  });

  it('rejects a degenerate size (w <= 0) with 400', async () => {
    const res = await insertSvgPOST(makeRequest(baseFields({ w: '0' })));
    expect(res.status).toBe(400);
    expect(doc.addSvg).not.toHaveBeenCalled();
  });

  it('rejects a non-finite coordinate with 400', async () => {
    const res = await insertSvgPOST(makeRequest(baseFields({ x: 'NaN' })));
    expect(res.status).toBe(400);
    expect(doc.addSvg).not.toHaveBeenCalled();
  });

  it('maps an engine false to 422 and does not save', async () => {
    doc.addSvg.mockReturnValueOnce(false);
    const res = await insertSvgPOST(makeRequest(baseFields()));
    expect(res.status).toBe(422);
    expect(vi.mocked(saveDocument)).not.toHaveBeenCalled();
  });

  it('maps a corrupted PDF to 422', async () => {
    const { PDFCorruptedError } = await import('@giga-pdf/pdf-engine');
    vi.mocked(openDocument).mockRejectedValueOnce(new PDFCorruptedError('corrupted'));
    const res = await insertSvgPOST(makeRequest(baseFields()));
    expect(res.status).toBe(422);
  });
});
