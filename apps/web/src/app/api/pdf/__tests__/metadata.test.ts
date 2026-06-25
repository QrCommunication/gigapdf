/**
 * Tests for POST /api/pdf/metadata (get/set: Info, XMP, display preferences).
 *
 * Strategy (mirrors merge-universal.test.ts / office/upload.test.ts):
 *   - Mock @giga-pdf/pdf-engine so the WASM engine never loads in jsdom. The
 *     mock `openDocument` returns a handle whose `_doc` is a stub GigaPdfDoc
 *     exposing the SDK methods the route calls (getXmp/setXmp/
 *     setViewerPreferences/setPageLayout/setPageMode). The route contract —
 *     status, headers, JSON shape, which engine calls fire — is exercised end
 *     to end without real PDF bytes.
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
    getMetadata: vi.fn(),
    setMetadata: vi.fn(),
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

import { POST as metadataPOST } from '../metadata/route';
import {
  openDocument,
  saveDocument,
  getMetadata,
  setMetadata,
} from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const FAKE_METADATA = {
  title: 'My title',
  author: 'Ada',
  subject: null,
  keywords: ['a', 'b'],
  creator: 'GigaPDF',
  producer: 'GigaPDF',
  creationDate: null,
  modificationDate: null,
  pageCount: 3,
  pdfVersion: '1.7',
  isEncrypted: false,
  permissions: {
    print: true,
    modify: true,
    copy: true,
    annotate: true,
    fillForms: true,
    extract: true,
    assemble: true,
    printHighQuality: true,
  },
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

/** A stub GigaPdfDoc with vi.fn() spies for every SDK method the route calls. */
function makeDoc(xmp: Uint8Array | null = null) {
  return {
    getXmp: vi.fn(() => xmp),
    setXmp: vi.fn(() => true),
    setViewerPreferences: vi.fn(() => true),
    setPageLayout: vi.fn(() => true),
    setPageMode: vi.fn(() => true),
  };
}

/** A handle wrapping a stub _doc, as returned by the mocked openDocument. */
function makeHandle(doc: ReturnType<typeof makeDoc>) {
  return {
    id: 'h1',
    pageCount: 3,
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
  const req = new Request('http://localhost/api/pdf/metadata', {
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

describe('POST /api/pdf/metadata', () => {
  let doc: ReturnType<typeof makeDoc>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    doc = makeDoc(new TextEncoder().encode('<x:xmpmeta>hello</x:xmpmeta>'));
    vi.mocked(openDocument).mockResolvedValue(makeHandle(doc) as never);
    vi.mocked(saveDocument).mockResolvedValue(Buffer.from(FAKE_PDF) as never);
    vi.mocked(getMetadata).mockReturnValue(FAKE_METADATA as never);
  });

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await metadataPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'get' },
      ]),
    );
    expect(res.status).toBe(401);
  });

  it('rejects an unknown action with 400', async () => {
    const res = await metadataPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'delete' },
      ]),
    );
    expect(res.status).toBe(400);
  });

  it('get returns { metadata, xmp } as JSON with the decoded XMP packet', async () => {
    const res = await metadataPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'get' },
      ]),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: { metadata: { title: string }; xmp: string | null };
    };
    expect(json.success).toBe(true);
    expect(json.data.metadata.title).toBe('My title');
    expect(json.data.xmp).toBe('<x:xmpmeta>hello</x:xmpmeta>');
  });

  it('get returns xmp = null when the document has no XMP packet', async () => {
    doc = makeDoc(null);
    vi.mocked(openDocument).mockResolvedValue(makeHandle(doc) as never);
    const res = await metadataPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'get' },
      ]),
    );
    const json = (await res.json()) as { data: { xmp: string | null } };
    expect(json.data.xmp).toBeNull();
  });

  it('set with Info metadata applies it and returns the PDF binary', async () => {
    const res = await metadataPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
        { key: 'metadata', value: JSON.stringify({ title: 'New', keywords: ['x'] }) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(vi.mocked(setMetadata)).toHaveBeenCalledTimes(1);
  });

  it('set applies display preferences, page layout/mode and raw XMP', async () => {
    const res = await metadataPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
        {
          key: 'viewerPreferences',
          // `bogus` must be dropped; `hideToolbar` + `direction` kept.
          value: JSON.stringify({ hideToolbar: true, bogus: 1, direction: 'R2L' }),
        },
        { key: 'pageLayout', value: 'OneColumn' },
        { key: 'pageMode', value: 'UseThumbs' },
        { key: 'xmp', value: '<x:xmpmeta>edited</x:xmpmeta>' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await bodyStartsWithPdf(res)).toBe(true);

    expect(doc.setViewerPreferences).toHaveBeenCalledTimes(1);
    expect(doc.setViewerPreferences).toHaveBeenCalledWith({
      hideToolbar: true,
      direction: 'R2L',
    });
    expect(doc.setPageLayout).toHaveBeenCalledWith('OneColumn');
    expect(doc.setPageMode).toHaveBeenCalledWith('UseThumbs');
    expect(doc.setXmp).toHaveBeenCalledWith('<x:xmpmeta>edited</x:xmpmeta>');
    // No Info field supplied → setMetadata must not be called.
    expect(vi.mocked(setMetadata)).not.toHaveBeenCalled();
  });

  it('rejects an unknown pageLayout with 400', async () => {
    const res = await metadataPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
        { key: 'pageLayout', value: 'NotALayout' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setPageLayout).not.toHaveBeenCalled();
  });

  it('rejects an unknown pageMode with 400', async () => {
    const res = await metadataPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
        { key: 'pageMode', value: 'NotAMode' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(doc.setPageMode).not.toHaveBeenCalled();
  });

  it('rejects a set with no operation with 400', async () => {
    const res = await metadataPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(vi.mocked(saveDocument)).not.toHaveBeenCalled();
  });

  it('ignores an empty viewerPreferences object (no engine call, needs another op)', async () => {
    const res = await metadataPOST(
      makeRequest([
        { key: 'file', value: makeFile() },
        { key: 'action', value: 'set' },
        { key: 'viewerPreferences', value: JSON.stringify({ unknown: 'x' }) },
      ]),
    );
    // Only unknown keys → sanitised to {} → not a real operation → 400.
    expect(res.status).toBe(400);
    expect(doc.setViewerPreferences).not.toHaveBeenCalled();
  });
});
