/**
 * Tests for the AcroForm field-completeness actions of POST /api/pdf/forms:
 * addSignatureField · setFieldScript · setCalculationOrder · removeField ·
 * regenerateFieldAppearance (issue #82).
 *
 * Strategy (mirrors page-labels.test.ts):
 *   - Mock @giga-pdf/pdf-engine so the WASM engine never loads in jsdom. The
 *     mock `openDocument` returns a handle whose `_doc` is a stub GigaPdfDoc
 *     exposing the methods the route calls. The route contract — status code,
 *     validation, the engine method + args, and 404/422 mapping — is exercised
 *     end to end without real PDF bytes. The get/fill/create wrappers are mocked
 *     too so the module imports cleanly.
 *   - Mock @/lib/auth-helpers / server-logger / 'server-only' to keep the route
 *     importable and control auth.
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
    constructor(message = 'out of range') {
      super(message);
      this.name = 'PDFPageOutOfRangeError';
    }
  };
  return {
    openDocument: vi.fn(),
    saveDocument: vi.fn(),
    // get/fill/create wrappers — mocked only so the module imports cleanly.
    getFormFields: vi.fn(),
    fillForm: vi.fn(),
    addFormField: vi.fn(),
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

import { POST } from '../forms/route';
import { openDocument, saveDocument } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const PAGE_COUNT = 3;

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
    addSignatureField: vi.fn(() => true),
    setFieldScript: vi.fn(() => true),
    setCalculationOrder: vi.fn(() => true),
    removeField: vi.fn(() => true),
    regenerateFieldAppearance: vi.fn(() => true),
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
  const req = new Request('http://localhost/api/pdf/forms', {
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

describe('POST /api/pdf/forms — field-completeness actions', () => {
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
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'removeField' },
        { key: 'name', value: 'sig' },
      ]),
    );
    expect(res.status).toBe(401);
    expect(openDocument).not.toHaveBeenCalled();
  });

  it('rejects an unknown action with 400', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'frobnicate' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/action must be one of/i);
  });

  // ── addSignatureField ────────────────────────────────────────────────────────

  it('addSignatureField → 200 PDF, calls doc.addSignatureField(page, name, rect, {style})', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'addSignatureField' },
        { key: 'name', value: 'Signature1' },
        { key: 'pageNumber', value: '2' },
        { key: 'rect', value: JSON.stringify([72, 72, 252, 144]) },
        { key: 'style', value: JSON.stringify({ border: 0x0000ff, borderWidth: 2 }) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(doc.addSignatureField).toHaveBeenCalledWith(
      2,
      'Signature1',
      [72, 72, 252, 144],
      { style: { border: 0x0000ff, borderWidth: 2 } },
    );
    expect(saveDocument).toHaveBeenCalledTimes(1);
  });

  it('addSignatureField without style passes opts undefined', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'addSignatureField' },
        { key: 'name', value: 'Sig' },
        { key: 'pageNumber', value: '1' },
        { key: 'rect', value: JSON.stringify([0, 0, 100, 50]) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(doc.addSignatureField).toHaveBeenCalledWith(1, 'Sig', [0, 0, 100, 50], undefined);
  });

  it('addSignatureField rejects a missing name with 400', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'addSignatureField' },
        { key: 'pageNumber', value: '1' },
        { key: 'rect', value: JSON.stringify([0, 0, 100, 50]) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.addSignatureField).not.toHaveBeenCalled();
  });

  it('addSignatureField rejects a degenerate rect (x1 <= x0) with 400', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'addSignatureField' },
        { key: 'name', value: 'Sig' },
        { key: 'pageNumber', value: '1' },
        { key: 'rect', value: JSON.stringify([100, 0, 100, 50]) },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/x1 > x0/i);
    expect(doc.addSignatureField).not.toHaveBeenCalled();
  });

  it('addSignatureField rejects an out-of-range page with 400', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'addSignatureField' },
        { key: 'name', value: 'Sig' },
        { key: 'pageNumber', value: '9' }, // pageCount is 3
        { key: 'rect', value: JSON.stringify([0, 0, 100, 50]) },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/pageNumber must be an integer between 1 and 3/i);
    expect(doc.addSignatureField).not.toHaveBeenCalled();
  });

  it('addSignatureField → 422 when the engine refuses (returns false), no save', async () => {
    doc.addSignatureField.mockReturnValue(false);
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'addSignatureField' },
        { key: 'name', value: 'Sig' },
        { key: 'pageNumber', value: '1' },
        { key: 'rect', value: JSON.stringify([0, 0, 100, 50]) },
      ]),
    );
    expect(res.status).toBe(422);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  // ── setFieldScript ───────────────────────────────────────────────────────────

  it('setFieldScript → 200, calls doc.setFieldScript(name, trigger, js)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setFieldScript' },
        { key: 'name', value: 'total' },
        { key: 'trigger', value: 'calculate' },
        { key: 'js', value: 'event.value = this.getField("a").value * 2;' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(doc.setFieldScript).toHaveBeenCalledWith(
      'total',
      'calculate',
      'event.value = this.getField("a").value * 2;',
    );
    expect(saveDocument).toHaveBeenCalledTimes(1);
  });

  it('setFieldScript rejects an unknown trigger with 400', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setFieldScript' },
        { key: 'name', value: 'total' },
        { key: 'trigger', value: 'onBlur' },
        { key: 'js', value: 'x = 1;' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/trigger must be one of/i);
    expect(doc.setFieldScript).not.toHaveBeenCalled();
  });

  it('setFieldScript rejects an empty js with 400', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setFieldScript' },
        { key: 'name', value: 'total' },
        { key: 'trigger', value: 'format' },
        { key: 'js', value: '' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setFieldScript).not.toHaveBeenCalled();
  });

  it('setFieldScript → 404 when no field has that name', async () => {
    doc.setFieldScript.mockReturnValue(false);
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setFieldScript' },
        { key: 'name', value: 'ghost' },
        { key: 'trigger', value: 'calculate' },
        { key: 'js', value: 'x = 1;' },
      ]),
    );
    expect(res.status).toBe(404);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  // ── setCalculationOrder ──────────────────────────────────────────────────────

  it('setCalculationOrder → 200, calls doc.setCalculationOrder(names)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setCalculationOrder' },
        { key: 'names', value: JSON.stringify(['a', 'b', 'total']) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(doc.setCalculationOrder).toHaveBeenCalledWith(['a', 'b', 'total']);
  });

  it('setCalculationOrder rejects invalid JSON with 400', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setCalculationOrder' },
        { key: 'names', value: '{not json' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setCalculationOrder).not.toHaveBeenCalled();
  });

  it('setCalculationOrder rejects a non-array with 400', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setCalculationOrder' },
        { key: 'names', value: JSON.stringify({ a: 1 }) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setCalculationOrder).not.toHaveBeenCalled();
  });

  // ── removeField ──────────────────────────────────────────────────────────────

  it('removeField → 200, calls doc.removeField(name)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'removeField' },
        { key: 'name', value: 'obsolete' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(doc.removeField).toHaveBeenCalledWith('obsolete');
    expect(saveDocument).toHaveBeenCalledTimes(1);
  });

  it('removeField → 404 when no field was removed, no save', async () => {
    doc.removeField.mockReturnValue(false);
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'removeField' },
        { key: 'name', value: 'ghost' },
      ]),
    );
    expect(res.status).toBe(404);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it('removeField rejects a missing name with 400', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'removeField' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.removeField).not.toHaveBeenCalled();
  });

  // ── regenerateFieldAppearance ────────────────────────────────────────────────

  it('regenerateFieldAppearance → 200, calls doc.regenerateFieldAppearance(name)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'regenerateFieldAppearance' },
        { key: 'name', value: 'amount' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(doc.regenerateFieldAppearance).toHaveBeenCalledWith('amount');
  });

  it('regenerateFieldAppearance → 422 when the engine cannot regenerate', async () => {
    doc.regenerateFieldAppearance.mockReturnValue(false);
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'regenerateFieldAppearance' },
        { key: 'name', value: 'radioParent' },
      ]),
    );
    expect(res.status).toBe(422);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  // ── error mapping ────────────────────────────────────────────────────────────

  it('maps a corrupted PDF to 422', async () => {
    const { PDFCorruptedError } = await import('@giga-pdf/pdf-engine');
    vi.mocked(openDocument).mockRejectedValueOnce(new PDFCorruptedError('corrupted'));
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'removeField' },
        { key: 'name', value: 'x' },
      ]),
    );
    expect(res.status).toBe(422);
  });
});
