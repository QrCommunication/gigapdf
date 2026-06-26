/**
 * Tests for POST /api/pdf/text-style.
 *
 * Re-styles sub-ranges of an existing parsed text run in place via
 * `GigaPdfDoc.setTextRunStyle(page, index, spans)`.
 *
 * Strategy (mirrors annotations.test.ts):
 *   - Mock @giga-pdf/pdf-engine so the WASM engine never loads in jsdom. The mock
 *     `openDocument` returns a handle whose `_doc` is a stub GigaPdfDoc exposing
 *     `pageCount` / `setTextRunStyle` / `saveCompressed`. The route contract —
 *     status, headers, validation, the args forwarded to `setTextRunStyle`,
 *     the engine `false` → 422 mapping — is exercised without real PDF bytes.
 *   - Mock @/lib/auth-helpers, @/lib/server-logger, and 'server-only'.
 *   - Drive POST with a fake Request whose formData() resolves synchronously.
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
  const PDFPageOutOfRangeError = class PDFPageOutOfRangeError extends Error {
    constructor(message = 'page out of range') {
      super(message);
      this.name = 'PDFPageOutOfRangeError';
    }
  };
  return {
    openDocument: vi.fn(),
    PDFCorruptedError,
    PDFPageOutOfRangeError,
  };
});

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/server-logger', () => ({
  serverLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// 'server-only' guard — pulled in transitively via lib/content-disposition.
vi.mock('server-only', () => ({}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST as textStylePOST } from '../text-style/route';
import { openDocument } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const PAGE_COUNT = 6;

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

/** A stub GigaPdfDoc with vi.fn() spies for every method the route calls. */
function makeDoc() {
  return {
    pageCount: vi.fn(() => PAGE_COUNT),
    setTextRunStyle: vi.fn(() => true),
    saveCompressed: vi.fn(() => FAKE_PDF),
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
  const req = new Request('http://localhost/api/pdf/text-style', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'text/plain' },
  });
  Object.defineProperty(req, 'formData', { value: () => Promise.resolve(fd) });
  return req;
}

async function bodyStartsWithPdf(res: Response): Promise<boolean> {
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/text-style', () => {
  let doc: ReturnType<typeof makeDoc>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    doc = makeDoc();
    vi.mocked(openDocument).mockResolvedValue(makeHandle(doc) as never);
  });

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await textStylePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'page', value: '1' },
        { key: 'index', value: '0' },
        { key: 'spans', value: JSON.stringify([{ start: 0, end: 5, bold: true }]) },
      ]),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a missing/invalid page with 400', async () => {
    const res = await textStylePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'index', value: '0' },
        { key: 'spans', value: JSON.stringify([{ start: 0, end: 5 }]) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setTextRunStyle).not.toHaveBeenCalled();
  });

  it('rejects a missing/invalid index with 400', async () => {
    const res = await textStylePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'page', value: '1' },
        { key: 'spans', value: JSON.stringify([{ start: 0, end: 5 }]) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setTextRunStyle).not.toHaveBeenCalled();
  });

  it('restyles a run and returns the PDF, forwarding parsed spans verbatim', async () => {
    const spans = [
      { start: 0, end: 4, color: [1, 0, 0], sizePt: 14, bold: true, italic: true, underline: true, strike: false },
    ];
    const res = await textStylePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'page', value: '2' },
        { key: 'index', value: '3' },
        { key: 'spans', value: JSON.stringify(spans) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(doc.setTextRunStyle).toHaveBeenCalledTimes(1);
    expect(doc.setTextRunStyle).toHaveBeenCalledWith(2, 3, spans);
    expect(doc.saveCompressed).toHaveBeenCalledTimes(1);
  });

  it('maps an engine false (non top-level run) to 422', async () => {
    doc.setTextRunStyle.mockReturnValueOnce(false);
    const res = await textStylePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'page', value: '1' },
        { key: 'index', value: '0' },
        { key: 'spans', value: JSON.stringify([{ start: 0, end: 5 }]) },
      ]),
    );
    expect(res.status).toBe(422);
    expect(doc.saveCompressed).not.toHaveBeenCalled();
  });

  it('rejects a page beyond the page count with 400', async () => {
    const res = await textStylePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'page', value: '7' }, // pageCount is 6
        { key: 'index', value: '0' },
        { key: 'spans', value: JSON.stringify([{ start: 0, end: 5 }]) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setTextRunStyle).not.toHaveBeenCalled();
  });

  it('rejects an empty spans array with 400', async () => {
    const res = await textStylePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'page', value: '1' },
        { key: 'index', value: '0' },
        { key: 'spans', value: JSON.stringify([]) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setTextRunStyle).not.toHaveBeenCalled();
  });

  it('rejects a span with end < start with 400', async () => {
    const res = await textStylePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'page', value: '1' },
        { key: 'index', value: '0' },
        { key: 'spans', value: JSON.stringify([{ start: 5, end: 2 }]) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setTextRunStyle).not.toHaveBeenCalled();
  });

  it('rejects an out-of-gamut colour with 400', async () => {
    const res = await textStylePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'page', value: '1' },
        { key: 'index', value: '0' },
        { key: 'spans', value: JSON.stringify([{ start: 0, end: 5, color: [2, 0, 0] }]) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setTextRunStyle).not.toHaveBeenCalled();
  });

  it('rejects invalid spans JSON with 400', async () => {
    const res = await textStylePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'page', value: '1' },
        { key: 'index', value: '0' },
        { key: 'spans', value: '{not json' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setTextRunStyle).not.toHaveBeenCalled();
  });

  it('maps a corrupted PDF to 422', async () => {
    const { PDFCorruptedError } = await import('@giga-pdf/pdf-engine');
    vi.mocked(openDocument).mockRejectedValueOnce(new PDFCorruptedError('corrupted'));
    const res = await textStylePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'page', value: '1' },
        { key: 'index', value: '0' },
        { key: 'spans', value: JSON.stringify([{ start: 0, end: 5 }]) },
      ]),
    );
    expect(res.status).toBe(422);
  });
});
