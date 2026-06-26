/**
 * Tests for POST /api/pdf/annotations.
 *
 * Two paradigms share the route, both exercised here:
 *   - Legacy text-markup path (`action` ABSENT): addAnnotation(element).
 *   - Geometric path (`action` PRESENT): GigaPdfDoc add* methods called directly
 *     (circle / polygon / polyline / caret) + regenerateAppearance.
 *
 * Strategy (mirrors page-labels.test.ts):
 *   - Mock @giga-pdf/pdf-engine so the WASM engine never loads in jsdom. The mock
 *     `openDocument` returns a handle whose `_doc` is a stub GigaPdfDoc exposing
 *     the methods the route calls (pageCount / pageInfo / add*Annotation /
 *     regenerateAppearance). The route contract — status, headers, validation,
 *     which engine calls fire with which args, default centred geometry, colour
 *     parsing — is exercised without real PDF bytes.
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
    saveDocument: vi.fn(),
    addAnnotation: vi.fn(),
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

import { POST as annotationsPOST } from '../annotations/route';
import { openDocument, saveDocument, addAnnotation } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const PAGE_COUNT = 6;
// Centred default rect for an US-Letter MediaBox [0,0,612,792]:
//   bw = min(180, 612*0.3=183.6) = 180 ; bh = min(120, 792*0.2=158.4) = 120
//   cx = 306, cy = 396 → [216, 336, 396, 456]
const DEFAULT_RECT = [216, 336, 396, 456] as const;
const DEFAULT_COLOR = 0x2563eb;
const DEFAULT_LINE_WIDTH = 1.5;

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
    pageInfo: vi.fn((_page: number) => ({
      width: 612,
      height: 792,
      rotation: 0,
      mediaBox: [0, 0, 612, 792] as [number, number, number, number],
    })),
    addCircleAnnotation: vi.fn(() => true),
    addPolygonAnnotation: vi.fn(() => true),
    addPolylineAnnotation: vi.fn(() => true),
    addCaretAnnotation: vi.fn(() => true),
    regenerateAppearance: vi.fn(() => true),
    // Native list/remove paths. annotations(page) returns one stub annotation
    // for page 1 only, so `list` walks all pages and surfaces page-scoped indices.
    annotations: vi.fn((page: number) =>
      page === 1
        ? [
            {
              index: 0,
              subtype: 'Highlight',
              x0: 0,
              y0: 0,
              x1: 10,
              y1: 10,
              contents: 'hello',
              author: 'alice',
              subject: '',
              created: '',
              modified: '',
              name: '',
              opacity: 1,
              color: [],
              quadPoints: [],
              inkList: [],
              linkUri: '',
              linkPage: 0,
            },
          ]
        : [],
    ),
    removeAnnotation: vi.fn(() => true),
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
  const req = new Request('http://localhost/api/pdf/annotations', {
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

describe('POST /api/pdf/annotations', () => {
  let doc: ReturnType<typeof makeDoc>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    doc = makeDoc();
    vi.mocked(openDocument).mockResolvedValue(makeHandle(doc) as never);
    vi.mocked(saveDocument).mockResolvedValue(Buffer.from(FAKE_PDF) as never);
    vi.mocked(addAnnotation).mockResolvedValue(undefined as never);
  });

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
        { key: 'action', value: 'circle' },
      ]),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a missing/invalid pageNumber with 400', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'circle' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.addCircleAnnotation).not.toHaveBeenCalled();
  });

  // ── Legacy text-markup path (action absent) ──────────────────────────────────

  it('legacy: adds a text-markup annotation via addAnnotation and returns the PDF', async () => {
    const element = {
      annotationType: 'highlight',
      bounds: { x: 10, y: 10, width: 100, height: 20 },
      style: { color: '#ffff00', opacity: 0.5 },
    };
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '2' },
        { key: 'element', value: JSON.stringify(element) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(vi.mocked(addAnnotation)).toHaveBeenCalledTimes(1);
    expect(doc.addCircleAnnotation).not.toHaveBeenCalled();
  });

  it('legacy: rejects a missing element with 400', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(addAnnotation)).not.toHaveBeenCalled();
  });

  it('legacy: rejects an unknown annotationType with 400', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
        { key: 'element', value: JSON.stringify({ annotationType: 'sparkle', style: {} }) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(addAnnotation)).not.toHaveBeenCalled();
  });

  // ── Geometric path ───────────────────────────────────────────────────────────

  it('circle: with no params places a centred default rect with default colour', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
        { key: 'action', value: 'circle' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(doc.addCircleAnnotation).toHaveBeenCalledTimes(1);
    expect(doc.addCircleAnnotation).toHaveBeenCalledWith(
      1,
      DEFAULT_RECT[0],
      DEFAULT_RECT[1],
      DEFAULT_RECT[2],
      DEFAULT_RECT[3],
      DEFAULT_COLOR, // stroke defaults to a visible colour
      null, // fill omitted
      DEFAULT_LINE_WIDTH,
    );
  });

  it('circle: parses explicit rect, stroke/fill hex colours and lineWidth', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '3' },
        { key: 'action', value: 'circle' },
        {
          key: 'params',
          value: JSON.stringify({
            rect: [10, 20, 110, 90],
            stroke: '#ff0000',
            fill: '#00ff00',
            lineWidth: 2,
          }),
        },
      ]),
    );
    expect(res.status).toBe(200);
    expect(doc.addCircleAnnotation).toHaveBeenCalledWith(
      3,
      10,
      20,
      110,
      90,
      0xff0000,
      0x00ff00,
      2,
    );
  });

  it('polygon: with no params places a centred default triangle', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
        { key: 'action', value: 'polygon' },
      ]),
    );
    expect(res.status).toBe(200);
    const [x0, y0, x1, y1] = DEFAULT_RECT;
    const cx = (x0 + x1) / 2;
    expect(doc.addPolygonAnnotation).toHaveBeenCalledWith(
      1,
      [cx, y1, x1, y0, x0, y0],
      DEFAULT_COLOR,
      null,
      DEFAULT_LINE_WIDTH,
    );
  });

  it('polyline: parses explicit points and colour', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
        { key: 'action', value: 'polyline' },
        { key: 'params', value: JSON.stringify({ points: [0, 0, 10, 10, 20, 0], color: '#0000ff' }) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(doc.addPolylineAnnotation).toHaveBeenCalledWith(
      1,
      [0, 0, 10, 10, 20, 0],
      0x0000ff,
      DEFAULT_LINE_WIDTH,
    );
  });

  it('polygon: rejects too few points with 400', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
        { key: 'action', value: 'polygon' },
        { key: 'params', value: JSON.stringify({ points: [0, 0, 1, 1] }) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.addPolygonAnnotation).not.toHaveBeenCalled();
  });

  it('caret: with no params places a centred default rect with default colour', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
        { key: 'action', value: 'caret' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(doc.addCaretAnnotation).toHaveBeenCalledWith(
      1,
      DEFAULT_RECT[0],
      DEFAULT_RECT[1],
      DEFAULT_RECT[2],
      DEFAULT_RECT[3],
      DEFAULT_COLOR,
    );
  });

  it('rejects an invalid hex colour with 400', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
        { key: 'action', value: 'caret' },
        { key: 'params', value: JSON.stringify({ color: 'red' }) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.addCaretAnnotation).not.toHaveBeenCalled();
  });

  it('regenerateAppearance: calls regenerateAppearance(page, index) and returns the PDF', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '4' },
        { key: 'action', value: 'regenerateAppearance' },
        { key: 'params', value: JSON.stringify({ index: 2 }) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(doc.regenerateAppearance).toHaveBeenCalledWith(4, 2);
  });

  it('regenerateAppearance: rejects a missing index with 400', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
        { key: 'action', value: 'regenerateAppearance' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.regenerateAppearance).not.toHaveBeenCalled();
  });

  it('regenerateAppearance: maps an engine false (bad index/subtype) to 400', async () => {
    doc.regenerateAppearance.mockReturnValueOnce(false);
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
        { key: 'action', value: 'regenerateAppearance' },
        { key: 'params', value: JSON.stringify({ index: 99 }) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(saveDocument)).not.toHaveBeenCalled();
  });

  it('rejects an unknown action with 400', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
        { key: 'action', value: 'triangle' },
      ]),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a pageNumber beyond the page count with 400', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        // pageCount is 6 → 7 is out of range.
        { key: 'pageNumber', value: '7' },
        { key: 'action', value: 'circle' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.addCircleAnnotation).not.toHaveBeenCalled();
  });

  it('rejects invalid params JSON with 400', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
        { key: 'action', value: 'circle' },
        { key: 'params', value: '{not json' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.addCircleAnnotation).not.toHaveBeenCalled();
  });

  it('maps a corrupted PDF to 422', async () => {
    const { PDFCorruptedError } = await import('@giga-pdf/pdf-engine');
    vi.mocked(openDocument).mockRejectedValueOnce(new PDFCorruptedError('corrupted'));
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'pageNumber', value: '1' },
        { key: 'action', value: 'circle' },
      ]),
    );
    expect(res.status).toBe(422);
  });

  // ── Inventory (action="list") ────────────────────────────────────────────────

  it('list: walks every page and returns annotations with per-page index (no pageNumber)', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'list' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    const body = (await res.json()) as {
      success: boolean;
      annotations: Array<{ page: number; index: number; subtype: string }>;
    };
    expect(body.success).toBe(true);
    expect(body.annotations).toEqual([
      { page: 1, index: 0, subtype: 'Highlight', contents: 'hello', author: 'alice' },
    ]);
    // annotations(page) was probed for every page.
    expect(doc.annotations).toHaveBeenCalledTimes(PAGE_COUNT);
  });

  // ── Native removal (action="remove") ─────────────────────────────────────────

  it('remove: calls removeAnnotation(page, index) and returns the PDF', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'remove' },
        { key: 'page', value: '2' },
        { key: 'index', value: '1' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(doc.removeAnnotation).toHaveBeenCalledWith(2, 1);
  });

  it('remove: rejects a missing page with 400', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'remove' },
        { key: 'index', value: '0' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.removeAnnotation).not.toHaveBeenCalled();
  });

  it('remove: rejects a missing index with 400', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'remove' },
        { key: 'page', value: '1' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.removeAnnotation).not.toHaveBeenCalled();
  });

  it('remove: maps an engine false (no annotation at index) to 422', async () => {
    doc.removeAnnotation.mockReturnValueOnce(false);
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'remove' },
        { key: 'page', value: '1' },
        { key: 'index', value: '99' },
      ]),
    );
    expect(res.status).toBe(422);
    expect(vi.mocked(saveDocument)).not.toHaveBeenCalled();
  });

  it('remove: rejects a page beyond the page count with 400', async () => {
    const res = await annotationsPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'remove' },
        { key: 'page', value: '7' }, // pageCount is 6
        { key: 'index', value: '0' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.removeAnnotation).not.toHaveBeenCalled();
  });
});
