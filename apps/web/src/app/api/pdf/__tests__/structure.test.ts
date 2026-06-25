/**
 * Tests for POST /api/pdf/structure (chapter detection & bake).
 *
 * Strategy (mirrors links.test.ts):
 *   - Mock @giga-pdf/pdf-engine so the WASM engine never loads in jsdom. The
 *     mock `openDocument` returns a handle whose `_doc` is a stub GigaPdfDoc
 *     exposing the methods the route calls (pageCount / pageBlocks /
 *     setBookmarks). The route contract — status, headers, JSON shape,
 *     validation, the heading→chapter extraction, and which engine calls fire —
 *     is exercised end to end without real PDF bytes.
 *   - Mock @/lib/auth-helpers to control auth outcomes.
 *   - Mock @/lib/server-logger and 'server-only' to keep the route importable.
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

// 'server-only' guard — pulled in transitively via lib/content-disposition.
vi.mock('server-only', () => ({}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST as structurePOST } from '../structure/route';
import { openDocument, saveDocument } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const PAGE_COUNT = 4;

/** A minimal `heading` GigaBlock the extractor can read (level + run text). */
function headingBlock(level: number, text: string): unknown {
  return {
    id: 0,
    frame: null,
    rotation: { t: 'd0' },
    kind: {
      t: 'heading',
      v: {
        level,
        para: {
          style: {},
          style_ref: null,
          runs: [{ t: 'run', v: { text, style: {}, source_index: null } }],
        },
      },
    },
  };
}

/** A non-heading block (paragraph) — ignored by the extractor. */
function paragraphBlock(text: string): unknown {
  return {
    id: 1,
    frame: null,
    rotation: { t: 'd0' },
    kind: {
      t: 'paragraph',
      v: {
        style: {},
        style_ref: null,
        runs: [{ t: 'run', v: { text, style: {}, source_index: null } }],
      },
    },
  };
}

// Page 1: an H1 + body, Page 2: an H2, Page 3: nothing, Page 4: an H2.
// Smallest raw level is 1 → normalised depths become 0 / 1 / 1.
const BLOCKS_BY_PAGE: Record<number, unknown[]> = {
  1: [headingBlock(1, 'Introduction'), paragraphBlock('lorem ipsum')],
  2: [headingBlock(2, 'Background')],
  3: [paragraphBlock('no heading here')],
  4: [headingBlock(2, 'Conclusion')],
};

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
    pageBlocks: vi.fn((page: number) => BLOCKS_BY_PAGE[page] ?? []),
    setBookmarks: vi.fn(() => true),
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
  const req = new Request('http://localhost/api/pdf/structure', {
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

type DetectBody = {
  success: boolean;
  data: { chapters: Array<{ title: string; level: number; page: number }>; pageCount: number };
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/structure', () => {
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
    const res = await structurePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'detect' },
      ]),
    );
    expect(res.status).toBe(401);
  });

  it('rejects an unknown action with 400', async () => {
    const res = await structurePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'frobnicate' },
      ]),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a missing file with 400', async () => {
    const res = await structurePOST(makeRequest([{ key: 'action', value: 'detect' }]));
    expect(res.status).toBe(400);
  });

  // ── detect ─────────────────────────────────────────────────────────────────
  it('detect returns normalised chapters from the page headings', async () => {
    const res = await structurePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'detect' },
      ]),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as DetectBody;
    expect(json.success).toBe(true);
    expect(json.data.pageCount).toBe(PAGE_COUNT);
    // pageBlocks() is called once per page (1..pageCount).
    expect(doc.pageBlocks).toHaveBeenCalledTimes(PAGE_COUNT);
    // Headings only (paragraphs ignored), in reading order, levels normalised to
    // a 0-based depth (smallest raw level 1 → 0).
    expect(json.data.chapters).toEqual([
      { title: 'Introduction', level: 0, page: 1 },
      { title: 'Background', level: 1, page: 2 },
      { title: 'Conclusion', level: 1, page: 4 },
    ]);
  });

  it('detect returns an empty chapter list when no heading exists', async () => {
    doc.pageBlocks.mockImplementation(() => [paragraphBlock('body only')] as never);
    const res = await structurePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'detect' },
      ]),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as DetectBody;
    expect(json.data.chapters).toEqual([]);
    expect(doc.setBookmarks).not.toHaveBeenCalled();
  });

  // ── bake ───────────────────────────────────────────────────────────────────
  it('bake maps chapters to goto bookmarks and returns the PDF', async () => {
    const res = await structurePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'bake' },
        {
          key: 'chapters',
          value: JSON.stringify([
            { title: 'Introduction', level: 0, page: 1 },
            { title: 'Background', level: 1, page: 2 },
          ]),
        },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(doc.setBookmarks).toHaveBeenCalledWith([
      { title: 'Introduction', level: 0, action: { type: 'goto', dest: { fit: 'xyz', page: 1 } } },
      { title: 'Background', level: 1, action: { type: 'goto', dest: { fit: 'xyz', page: 2 } } },
    ]);
  });

  it('bake with an empty array clears the outline', async () => {
    const res = await structurePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'bake' },
        { key: 'chapters', value: '[]' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(doc.setBookmarks).toHaveBeenCalledWith([]);
  });

  it('bake rejects a missing chapters field with 400', async () => {
    const res = await structurePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'bake' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setBookmarks).not.toHaveBeenCalled();
  });

  it('bake rejects an out-of-range page with 400', async () => {
    const res = await structurePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'bake' },
        { key: 'chapters', value: JSON.stringify([{ title: 'x', level: 0, page: 99 }]) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setBookmarks).not.toHaveBeenCalled();
  });

  it('bake rejects an empty/blank title with 400', async () => {
    const res = await structurePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'bake' },
        { key: 'chapters', value: JSON.stringify([{ title: '  ', level: 0, page: 1 }]) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setBookmarks).not.toHaveBeenCalled();
  });

  it('bake maps an engine false (rejected write) to 422', async () => {
    doc.setBookmarks.mockReturnValueOnce(false);
    const res = await structurePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'bake' },
        { key: 'chapters', value: JSON.stringify([{ title: 'x', level: 0, page: 1 }]) },
      ]),
    );
    expect(res.status).toBe(422);
    expect(vi.mocked(saveDocument)).not.toHaveBeenCalled();
  });

  // ── error mapping ────────────────────────────────────────────────────────
  it('maps a corrupted PDF to 422', async () => {
    const { PDFCorruptedError } = await import('@giga-pdf/pdf-engine');
    vi.mocked(openDocument).mockRejectedValueOnce(new PDFCorruptedError('corrupted'));
    const res = await structurePOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'detect' },
      ]),
    );
    expect(res.status).toBe(422);
  });
});
