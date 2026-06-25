/**
 * Tests for POST /api/pdf/page-labels (get/set page-label ranges).
 *
 * Strategy (mirrors metadata.test.ts):
 *   - Mock @giga-pdf/pdf-engine so the WASM engine never loads in jsdom. The
 *     mock `openDocument` returns a handle whose `_doc` is a stub GigaPdfDoc
 *     exposing the methods the route calls (pageCount / getPageLabels /
 *     pageLabel / setPageLabels). The route contract — status, headers, JSON
 *     shape, validation, which engine calls fire — is exercised end to end
 *     without real PDF bytes.
 *   - Mock @/lib/auth-helpers to control auth outcomes.
 *   - Mock @/lib/server-logger and 'server-only' to keep the route importable.
 *   - Drive the POST handler with a fake Request whose formData() resolves
 *     synchronously (jsdom cannot parse multipart streams).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── jsdom polyfill: File.prototype.arrayBuffer / Blob.prototype.arrayBuffer ───
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

// 'server-only' guard — pulled in transitively via lib/content-disposition.
vi.mock('server-only', () => ({}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST as pageLabelsPOST } from '../page-labels/route';
import { openDocument, saveDocument } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const PAGE_COUNT = 6;

const FAKE_RANGES = [
  { startPage: 1, style: 'romanLower', prefix: '', startNumber: 1 },
  { startPage: 4, style: 'decimal', prefix: '', startNumber: 1 },
];

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
function makeDoc(ranges: typeof FAKE_RANGES = FAKE_RANGES) {
  return {
    pageCount: vi.fn(() => PAGE_COUNT),
    getPageLabels: vi.fn(() => ranges),
    // Resolved label = "L<page>"; only the shape matters for the route contract.
    pageLabel: vi.fn((page: number) => `L${page}`),
    setPageLabels: vi.fn(() => true),
  };
}

/** A handle wrapping a stub _doc, as returned by the mocked openDocument. */
function makeHandle(doc: ReturnType<typeof makeDoc>) {
  return {
    id: 'h1',
    pageCount: PAGE_COUNT,
    isDirty: false,
    wasEncrypted: false,
    _doc: doc,
  };
}

function makeFile(name = 'doc.pdf'): File {
  const plain = new Uint8Array(new ArrayBuffer(FAKE_PDF.byteLength));
  plain.set(FAKE_PDF);
  return new File([plain], name, { type: 'application/pdf' });
}

function makeRequest(fields: { key: string; value: File | string }[]): Request {
  const fd = new FormData();
  for (const { key, value } of fields) fd.append(key, value);
  const req = new Request('http://localhost/api/pdf/page-labels', {
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

describe('POST /api/pdf/page-labels', () => {
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
    const res = await pageLabelsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'get' },
      ]),
    );
    expect(res.status).toBe(401);
  });

  it('rejects an unknown action with 400', async () => {
    const res = await pageLabelsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'delete' },
      ]),
    );
    expect(res.status).toBe(400);
  });

  it('get returns { ranges, labels, pageCount } as JSON', async () => {
    const res = await pageLabelsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'get' },
      ]),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: {
        ranges: typeof FAKE_RANGES;
        labels: string[];
        pageCount: number;
      };
    };
    expect(json.success).toBe(true);
    expect(json.data.ranges).toEqual(FAKE_RANGES);
    expect(json.data.pageCount).toBe(PAGE_COUNT);
    // One resolved label per page (1..pageCount).
    expect(json.data.labels).toHaveLength(PAGE_COUNT);
    expect(json.data.labels[0]).toBe('L1');
    expect(doc.pageLabel).toHaveBeenCalledTimes(PAGE_COUNT);
  });

  it('set applies the supplied ranges and returns the PDF binary', async () => {
    const ranges = [
      { startPage: 1, style: 'romanLower', prefix: '', startNumber: 1 },
      { startPage: 3, style: 'decimal', prefix: 'A-', startNumber: 1 },
    ];
    const res = await pageLabelsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
        { key: 'ranges', value: JSON.stringify(ranges) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(doc.setPageLabels).toHaveBeenCalledTimes(1);
    expect(doc.setPageLabels).toHaveBeenCalledWith(ranges);
  });

  it('set defaults an omitted prefix to "" and startNumber to 1', async () => {
    const res = await pageLabelsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
        { key: 'ranges', value: JSON.stringify([{ startPage: 2, style: 'decimal' }]) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(doc.setPageLabels).toHaveBeenCalledWith([
      { startPage: 2, style: 'decimal', prefix: '', startNumber: 1 },
    ]);
  });

  it('set with an empty array removes all labels', async () => {
    const res = await pageLabelsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
        { key: 'ranges', value: '[]' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(doc.setPageLabels).toHaveBeenCalledWith([]);
  });

  it('rejects a set with no ranges field with 400', async () => {
    const res = await pageLabelsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setPageLabels).not.toHaveBeenCalled();
    expect(vi.mocked(saveDocument)).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON ranges with 400', async () => {
    const res = await pageLabelsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
        { key: 'ranges', value: '{not json' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setPageLabels).not.toHaveBeenCalled();
  });

  it('rejects an unknown style with 400', async () => {
    const res = await pageLabelsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
        {
          key: 'ranges',
          value: JSON.stringify([{ startPage: 1, style: 'klingon' }]),
        },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setPageLabels).not.toHaveBeenCalled();
  });

  it('rejects a startPage out of range with 400', async () => {
    const res = await pageLabelsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
        {
          key: 'ranges',
          // pageCount is 6 → startPage 7 is out of range.
          value: JSON.stringify([{ startPage: 7, style: 'decimal' }]),
        },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setPageLabels).not.toHaveBeenCalled();
  });

  it('rejects a startNumber below 1 with 400', async () => {
    const res = await pageLabelsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
        {
          key: 'ranges',
          value: JSON.stringify([
            { startPage: 1, style: 'decimal', startNumber: 0 },
          ]),
        },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setPageLabels).not.toHaveBeenCalled();
  });

  it('maps a corrupted PDF to 422', async () => {
    const { PDFCorruptedError } = await import('@giga-pdf/pdf-engine');
    vi.mocked(openDocument).mockRejectedValueOnce(new PDFCorruptedError('corrupted'));
    const res = await pageLabelsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'get' },
      ]),
    );
    expect(res.status).toBe(422);
  });
});
