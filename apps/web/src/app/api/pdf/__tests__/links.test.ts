/**
 * Tests for POST /api/pdf/links (links, open-action & bookmarks).
 *
 * Strategy (mirrors page-labels.test.ts):
 *   - Mock @giga-pdf/pdf-engine so the WASM engine never loads in jsdom. The
 *     mock `openDocument` returns a handle whose `_doc` is a stub GigaPdfDoc
 *     exposing the methods the route calls (pageCount / links / outline /
 *     namedDests / addLink / removeLink / setBookmarks / setOpenAction). The
 *     route contract — status, headers, JSON shape, validation, which engine
 *     calls fire and with what arguments — is exercised end to end without real
 *     PDF bytes.
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

import { POST as linksPOST } from '../links/route';
import { openDocument, saveDocument } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const PAGE_COUNT = 6;

const FAKE_LINKS = [
  { index: 0, x0: 10, y0: 20, x1: 110, y1: 36, kind: 'uri' as const, uri: 'https://a.example' },
  { index: 1, x0: 12, y0: 60, x1: 90, y1: 76, kind: 'page' as const, page: 4 },
];
const FAKE_OUTLINE = [
  { level: 0, title: 'Intro', page: 1 },
  { level: 1, title: 'Details', page: 2 },
];
const FAKE_NAMED_DESTS = [{ name: 'chapter1', page: 1 }];

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
    // links() is called once per page (1..pageCount); only page 1 returns links.
    links: vi.fn((page: number) => (page === 1 ? FAKE_LINKS : [])),
    outline: vi.fn(() => FAKE_OUTLINE),
    namedDests: vi.fn(() => FAKE_NAMED_DESTS),
    addLink: vi.fn(() => true),
    removeLink: vi.fn(() => true),
    setBookmarks: vi.fn(() => true),
    setOpenAction: vi.fn(() => true),
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
  const req = new Request('http://localhost/api/pdf/links', {
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

describe('POST /api/pdf/links', () => {
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
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'get' },
      ]),
    );
    expect(res.status).toBe(401);
  });

  it('rejects an unknown action with 400', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'frobnicate' },
      ]),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a missing file with 400', async () => {
    const res = await linksPOST(
      makeRequest([{ key: 'action', value: 'get' }]),
    );
    expect(res.status).toBe(400);
  });

  // ── get ──────────────────────────────────────────────────────────────────
  it('get returns { links, outline, namedDests, pageCount }', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'get' },
      ]),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: {
        links: Array<{ index: number; page: number; kind: string }>;
        outline: typeof FAKE_OUTLINE;
        namedDests: typeof FAKE_NAMED_DESTS;
        pageCount: number;
      };
    };
    expect(json.success).toBe(true);
    expect(json.data.pageCount).toBe(PAGE_COUNT);
    expect(json.data.outline).toEqual(FAKE_OUTLINE);
    expect(json.data.namedDests).toEqual(FAKE_NAMED_DESTS);
    // links() called once per page; only page 1 contributed two links, each
    // augmented with its 1-based page number.
    expect(doc.links).toHaveBeenCalledTimes(PAGE_COUNT);
    expect(json.data.links).toHaveLength(2);
    expect(json.data.links[0]).toMatchObject({ index: 0, page: 1, kind: 'uri' });
  });

  // ── addLink ──────────────────────────────────────────────────────────────
  it('addLink with a uri builds a /URI action and returns the PDF', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'addLink' },
        { key: 'page', value: '2' },
        { key: 'rect', value: JSON.stringify({ x: 72, y: 700, w: 120, h: 16 }) },
        { key: 'uri', value: 'https://example.com' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(doc.addLink).toHaveBeenCalledWith(
      2,
      { x: 72, y: 700, w: 120, h: 16 },
      { type: 'uri', uri: 'https://example.com' },
    );
  });

  it('addLink with internalPage builds a goto/xyz destination', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'addLink' },
        { key: 'page', value: '1' },
        { key: 'rect', value: JSON.stringify({ x: 0, y: 0, w: 50, h: 10 }) },
        { key: 'internalPage', value: '5' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(doc.addLink).toHaveBeenCalledWith(
      1,
      { x: 0, y: 0, w: 50, h: 10 },
      { type: 'goto', dest: { fit: 'xyz', page: 5 } },
    );
  });

  it('addLink rejects a non-http/mailto/tel uri with 400', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'addLink' },
        { key: 'page', value: '1' },
        { key: 'rect', value: JSON.stringify({ x: 0, y: 0, w: 50, h: 10 }) },
        { key: 'uri', value: 'javascript:alert(1)' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.addLink).not.toHaveBeenCalled();
  });

  it('addLink rejects supplying both uri and internalPage with 400', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'addLink' },
        { key: 'page', value: '1' },
        { key: 'rect', value: JSON.stringify({ x: 0, y: 0, w: 50, h: 10 }) },
        { key: 'uri', value: 'https://example.com' },
        { key: 'internalPage', value: '2' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.addLink).not.toHaveBeenCalled();
  });

  it('addLink rejects a page out of range with 400', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'addLink' },
        { key: 'page', value: '99' },
        { key: 'rect', value: JSON.stringify({ x: 0, y: 0, w: 50, h: 10 }) },
        { key: 'uri', value: 'https://example.com' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.addLink).not.toHaveBeenCalled();
  });

  it('addLink rejects a degenerate rect (w <= 0) with 400', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'addLink' },
        { key: 'page', value: '1' },
        { key: 'rect', value: JSON.stringify({ x: 0, y: 0, w: 0, h: 10 }) },
        { key: 'uri', value: 'https://example.com' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.addLink).not.toHaveBeenCalled();
  });

  it('addLink maps an engine false (rejected action) to 422', async () => {
    doc.addLink.mockReturnValueOnce(false);
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'addLink' },
        { key: 'page', value: '1' },
        { key: 'rect', value: JSON.stringify({ x: 0, y: 0, w: 50, h: 10 }) },
        { key: 'uri', value: 'https://example.com' },
      ]),
    );
    expect(res.status).toBe(422);
    expect(vi.mocked(saveDocument)).not.toHaveBeenCalled();
  });

  // ── removeLink ───────────────────────────────────────────────────────────
  it('removeLink removes by index and returns the PDF', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'removeLink' },
        { key: 'page', value: '1' },
        { key: 'linkIndex', value: '0' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(doc.removeLink).toHaveBeenCalledWith(1, 0);
  });

  it('removeLink maps a missing link (engine false) to 404', async () => {
    doc.removeLink.mockReturnValueOnce(false);
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'removeLink' },
        { key: 'page', value: '1' },
        { key: 'linkIndex', value: '9' },
      ]),
    );
    expect(res.status).toBe(404);
    expect(vi.mocked(saveDocument)).not.toHaveBeenCalled();
  });

  it('removeLink rejects a negative index with 400', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'removeLink' },
        { key: 'page', value: '1' },
        { key: 'linkIndex', value: '-1' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.removeLink).not.toHaveBeenCalled();
  });

  // ── setBookmarks ─────────────────────────────────────────────────────────
  it('setBookmarks maps page → goto action and returns the PDF', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setBookmarks' },
        {
          key: 'bookmarks',
          value: JSON.stringify([
            { title: 'Chapter 1', level: 0, page: 1 },
            { title: 'Section 1.1', level: 1, page: 2 },
            { title: 'No dest', level: 0 },
          ]),
        },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(doc.setBookmarks).toHaveBeenCalledWith([
      { title: 'Chapter 1', level: 0, action: { type: 'goto', dest: { fit: 'xyz', page: 1 } } },
      { title: 'Section 1.1', level: 1, action: { type: 'goto', dest: { fit: 'xyz', page: 2 } } },
      { title: 'No dest', level: 0 },
    ]);
  });

  it('setBookmarks with an empty array clears the outline', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setBookmarks' },
        { key: 'bookmarks', value: '[]' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(doc.setBookmarks).toHaveBeenCalledWith([]);
  });

  it('setBookmarks rejects an entry with a non-string title with 400', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setBookmarks' },
        { key: 'bookmarks', value: JSON.stringify([{ title: 42, level: 0 }]) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setBookmarks).not.toHaveBeenCalled();
  });

  it('setBookmarks rejects a page out of range with 400', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setBookmarks' },
        { key: 'bookmarks', value: JSON.stringify([{ title: 'x', level: 0, page: 99 }]) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setBookmarks).not.toHaveBeenCalled();
  });

  it('setBookmarks rejects a missing bookmarks field with 400', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setBookmarks' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setBookmarks).not.toHaveBeenCalled();
  });

  // ── setOpenAction ────────────────────────────────────────────────────────
  it('setOpenAction accepts a goto/xyz action and returns the PDF', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setOpenAction' },
        {
          key: 'action_payload',
          value: JSON.stringify({
            type: 'goto',
            dest: { fit: 'xyz', page: 3, top: 720, zoom: 1.5 },
          }),
        },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(doc.setOpenAction).toHaveBeenCalledWith({
      type: 'goto',
      dest: { fit: 'xyz', page: 3, top: 720, zoom: 1.5 },
    });
  });

  it('setOpenAction accepts a named navigation action', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setOpenAction' },
        { key: 'action_payload', value: JSON.stringify({ type: 'named', action: 'firstPage' }) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(doc.setOpenAction).toHaveBeenCalledWith({ type: 'named', action: 'firstPage' });
  });

  it('setOpenAction rejects a javascript action with 400', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setOpenAction' },
        { key: 'action_payload', value: JSON.stringify({ type: 'javascript', js: 'app.alert(1)' }) },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setOpenAction).not.toHaveBeenCalled();
  });

  it('setOpenAction rejects a goto with an out-of-range page with 400', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setOpenAction' },
        {
          key: 'action_payload',
          value: JSON.stringify({ type: 'goto', dest: { fit: 'xyz', page: 99 } }),
        },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setOpenAction).not.toHaveBeenCalled();
  });

  it('setOpenAction rejects a missing action_payload field with 400', async () => {
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'setOpenAction' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setOpenAction).not.toHaveBeenCalled();
  });

  // ── error mapping ────────────────────────────────────────────────────────
  it('maps a corrupted PDF to 422', async () => {
    const { PDFCorruptedError } = await import('@giga-pdf/pdf-engine');
    vi.mocked(openDocument).mockRejectedValueOnce(new PDFCorruptedError('corrupted'));
    const res = await linksPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'get' },
      ]),
    );
    expect(res.status).toBe(422);
  });
});
