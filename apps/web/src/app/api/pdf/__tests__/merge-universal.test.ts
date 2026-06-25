/**
 * Tests for POST /api/pdf/merge-universal, /api/pdf/image-to-pdf, /api/pdf/to-image.
 *
 * Strategy (mirrors src/app/api/office/__tests__/upload.test.ts):
 *   - Mock @giga-pdf/pdf-engine so the WASM engine never loads in the jsdom test
 *     environment (the engine's own behaviour is covered by the pdf-engine
 *     package's real-engine tests). The mocks return real `%PDF` / ZIP bytes so
 *     the route contract — status, headers, body magic — is exercised end to end.
 *   - Mock @/lib/auth-helpers to control auth outcomes.
 *   - Mock @/lib/server-logger and 'server-only' to keep the route importable.
 *   - Drive the POST handlers directly with a fake Request whose formData()
 *     resolves synchronously (jsdom cannot parse multipart streams).
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
if (!('arrayBuffer' in Blob.prototype)) {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value: function (this: Blob): Promise<ArrayBuffer> {
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
  // PDFEngineError carries a string `code` used by the route to map to 400.
  const PDFEngineError = class PDFEngineError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'PDFEngineError';
      this.code = code;
    }
  };
  const PDFCorruptedError = class PDFCorruptedError extends Error {
    constructor(message = 'corrupted') {
      super(message);
      this.name = 'PDFCorruptedError';
    }
  };

  return {
    mergeUniversal: vi.fn(),
    imageToPdf: vi.fn(),
    openDocument: vi.fn(),
    closeDocument: vi.fn(),
    renderPage: vi.fn(),
    parsePageRange: vi.fn(),
    PDFEngineError,
    PDFCorruptedError,
  };
});

// The merge-universal route loads the zero-dependency engine directly for the
// page-range path (`GigaPdfEngine.loadDefault().mergePdfs([{ pdf, pages }])`).
// The vi.fns live INSIDE the factory (no out-of-scope reference → no TDZ trap);
// tests retrieve them via `await GigaPdfEngine.loadDefault()`.
vi.mock('@qrcommunication/gigapdf-lib', () => {
  const open = vi.fn();
  const mergePdfs = vi.fn();
  return {
    GigaPdfEngine: {
      loadDefault: vi.fn(() => Promise.resolve({ open, mergePdfs })),
    },
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

import { POST as mergeUniversalPOST } from '../merge-universal/route';
import { POST as imageToPdfPOST } from '../image-to-pdf/route';
import { POST as toImagePOST } from '../to-image/route';
import {
  mergeUniversal,
  imageToPdf,
  openDocument,
  closeDocument,
  renderPage,
  parsePageRange,
  PDFEngineError,
  PDFCorruptedError,
} from '@giga-pdf/pdf-engine';
import { GigaPdfEngine } from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal real-ish PDF bytes (`%PDF-…%%EOF`) the route returns verbatim. */
const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

/**
 * A 1×1 RGB PNG (color type 2) — a real, decodable image payload. RGB on
 * purpose: the engine's RGBA path has a known SDK bug under correction. The
 * route's magic-byte validation only inspects the header, so this is exact.
 */
const PNG_1x1_RGB = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, // PNG magic
  0, 0, 0, 13, 73, 72, 68, 82, // IHDR length + type
  0, 0, 0, 1, // width: 1
  0, 0, 0, 1, // height: 1
  8, 2, // bit depth 8, color type 2 (RGB)
  0, 0, 0, // compression, filter, interlace
  144, 119, 83, 222, // IHDR CRC
  0, 0, 0, 12, 73, 68, 65, 84, // IDAT length + type
  8, 215, 99, 248, 207, 192, 0, 0, 0, 3, 0, 1,
  54, 174, 213, 252, // IDAT CRC
  0, 0, 0, 0, 73, 69, 78, 68, // IEND
  174, 66, 96, 130, // IEND CRC
]);

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

/** Creates a synthetic File with given bytes, name and MIME type. */
function makeFile(name: string, content: Uint8Array, type = 'application/octet-stream'): File {
  // Copy into a fresh ArrayBuffer so the BlobPart type is ArrayBuffer (not Like).
  const plain = new Uint8Array(new ArrayBuffer(content.byteLength));
  plain.set(content);
  return new File([plain], name, { type });
}

/**
 * Builds a fake Request whose formData() resolves with a pre-built FormData,
 * bypassing jsdom's missing multipart stream parser.
 */
function makeRequest(fields: { key: string; value: File | string }[]): Request {
  const fd = new FormData();
  for (const { key, value } of fields) fd.append(key, value);

  const req = new Request('http://localhost/api/pdf/test', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'text/plain' },
  });
  Object.defineProperty(req, 'formData', { value: () => Promise.resolve(fd) });
  return req;
}

/** Magic-byte check: does the response body begin with `%PDF`? */
async function bodyStartsWithPdf(res: Response): Promise<boolean> {
  const buf = new Uint8Array(await res.arrayBuffer());
  return (
    buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 // %PDF
  );
}

// ── /api/pdf/merge-universal ──────────────────────────────────────────────────

describe('POST /api/pdf/merge-universal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    vi.mocked(mergeUniversal).mockResolvedValue(FAKE_PDF);
  });

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await mergeUniversalPOST(makeRequest([
      { key: 'files', value: makeFile('a.pdf', FAKE_PDF, 'application/pdf') },
    ]));
    expect(res.status).toBe(401);
  });

  it('merges [1 PDF + 1 PNG RGB] → 200, application/pdf, body starts with %PDF', async () => {
    const res = await mergeUniversalPOST(makeRequest([
      { key: 'files', value: makeFile('doc.pdf', FAKE_PDF, 'application/pdf') },
      { key: 'files', value: makeFile('pic.png', PNG_1x1_RGB, 'image/png') },
    ]));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
  });

  it('passes inputs to mergeUniversal in order, with filename + mimeType', async () => {
    await mergeUniversalPOST(makeRequest([
      { key: 'files', value: makeFile('first.pdf', FAKE_PDF, 'application/pdf') },
      { key: 'files', value: makeFile('second.png', PNG_1x1_RGB, 'image/png') },
    ]));
    const arg = vi.mocked(mergeUniversal).mock.calls[0]![0];
    expect(arg).toHaveLength(2);
    expect(arg[0]!.filename).toBe('first.pdf');
    expect(arg[1]!.filename).toBe('second.png');
    expect(arg[0]!.bytes).toBeInstanceOf(Uint8Array);
  });

  it('accepts a single file (it is simply converted)', async () => {
    const res = await mergeUniversalPOST(makeRequest([
      { key: 'files', value: makeFile('only.pdf', FAKE_PDF, 'application/pdf') },
    ]));
    expect(res.status).toBe(200);
  });

  it('returns 400 when no file is supplied', async () => {
    const res = await mergeUniversalPOST(makeRequest([{ key: 'outputName', value: 'x.pdf' }]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/at least one file/i);
  });

  it('returns 400 when a file is empty', async () => {
    const res = await mergeUniversalPOST(makeRequest([
      { key: 'files', value: makeFile('empty.pdf', new Uint8Array(0), 'application/pdf') },
    ]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/empty/i);
  });

  it('returns 400 with the engine message when a file cannot be converted', async () => {
    vi.mocked(mergeUniversal).mockRejectedValue(
      new (PDFEngineError as unknown as new (m: string, c: string) => Error)(
        'mergeUniversal could not convert 1 file(s): bad.xyz (unrecognized file type)',
        'MERGE_UNIVERSAL_CONVERT_FAILED',
      ),
    );
    const res = await mergeUniversalPOST(makeRequest([
      { key: 'files', value: makeFile('bad.xyz', new Uint8Array([1, 2, 3, 4]), 'application/octet-stream') },
    ]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/could not convert/i);
  });

  it('returns 500 on an unexpected engine error', async () => {
    vi.mocked(mergeUniversal).mockRejectedValue(new Error('boom'));
    const res = await mergeUniversalPOST(makeRequest([
      { key: 'files', value: makeFile('a.pdf', FAKE_PDF, 'application/pdf') },
    ]));
    expect(res.status).toBe(500);
  });

  it('uses outputName in the Content-Disposition header', async () => {
    const res = await mergeUniversalPOST(makeRequest([
      { key: 'files', value: makeFile('a.pdf', FAKE_PDF, 'application/pdf') },
      { key: 'outputName', value: 'combined.pdf' },
    ]));
    expect(res.headers.get('Content-Disposition')).toContain('combined.pdf');
  });
});

// ── /api/pdf/merge-universal — page ranges (issue #93) ────────────────────────

describe('POST /api/pdf/merge-universal — page ranges', () => {
  // The engine vi.fns live inside the lib mock; `loadDefault()` resolves to a
  // fresh wrapper each call but always closes over the SAME `open` / `mergePdfs`
  // — so the handle obtained test-side is the very one the route invokes.
  let engine: {
    open: ReturnType<typeof vi.fn>;
    mergePdfs: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    // Per-file conversion returns a PDF; the engine assembles the parts.
    vi.mocked(mergeUniversal).mockResolvedValue(FAKE_PDF);
    vi.mocked(parsePageRange).mockReturnValue([{ start: 1, end: 2 }]);

    engine = (await GigaPdfEngine.loadDefault()) as unknown as typeof engine;
    engine.open.mockReturnValue({ pageCount: () => 5, close: vi.fn() });
    engine.mergePdfs.mockReturnValue(FAKE_PDF);
  });

  it('assembles via mergePdfs([{ pdf, pages }]) when a range is supplied', async () => {
    const res = await mergeUniversalPOST(makeRequest([
      { key: 'files', value: makeFile('a.pdf', FAKE_PDF, 'application/pdf') },
      { key: 'ranges', value: '1-2' },
      { key: 'files', value: makeFile('b.pdf', FAKE_PDF, 'application/pdf') },
      { key: 'ranges', value: '' },
    ]));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);

    // Each file converted in isolation, then assembled once.
    expect(vi.mocked(mergeUniversal)).toHaveBeenCalledTimes(2);
    expect(engine.mergePdfs).toHaveBeenCalledTimes(1);

    const parts = engine.mergePdfs.mock.calls[0]![0] as Array<
      Uint8Array | { pdf: Uint8Array; pages: number[] }
    >;
    expect(parts).toHaveLength(2);
    // File with a range → MergePart { pdf, pages }; empty range → raw bytes.
    expect(parts[0]).toMatchObject({ pages: [1, 2] });
    expect((parts[0] as { pdf: Uint8Array }).pdf).toBeInstanceOf(Uint8Array);
    expect(parts[1]).toBeInstanceOf(Uint8Array);
  });

  it('honours a range on a single file (extract through mergePdfs)', async () => {
    const res = await mergeUniversalPOST(makeRequest([
      { key: 'files', value: makeFile('only.pdf', FAKE_PDF, 'application/pdf') },
      { key: 'ranges', value: '1-2' },
    ]));

    expect(res.status).toBe(200);
    expect(engine.mergePdfs).toHaveBeenCalledTimes(1);
    const parts = engine.mergePdfs.mock.calls[0]![0] as Array<unknown>;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ pages: [1, 2] });
  });

  it('returns 400 with a precise message for an invalid range', async () => {
    vi.mocked(parsePageRange).mockImplementation(() => {
      throw new Error('Invalid page range: "9" (document has 5 pages)');
    });

    const res = await mergeUniversalPOST(makeRequest([
      { key: 'files', value: makeFile('doc.pdf', FAKE_PDF, 'application/pdf') },
      { key: 'ranges', value: '9' },
    ]));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/invalid page range/i);
    expect(body.error).toMatch(/doc\.pdf/);
    expect(engine.mergePdfs).not.toHaveBeenCalled();
  });

  it('falls back to the legacy bulk path when NO range field is sent', async () => {
    const res = await mergeUniversalPOST(makeRequest([
      { key: 'files', value: makeFile('a.pdf', FAKE_PDF, 'application/pdf') },
      { key: 'files', value: makeFile('b.pdf', FAKE_PDF, 'application/pdf') },
    ]));

    expect(res.status).toBe(200);
    expect(engine.mergePdfs).not.toHaveBeenCalled();
    // One bulk call with both inputs — not the per-file conversion of the range path.
    expect(vi.mocked(mergeUniversal)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mergeUniversal).mock.calls[0]![0]).toHaveLength(2);
  });

  it('treats all-blank ranges as the legacy bulk path', async () => {
    const res = await mergeUniversalPOST(makeRequest([
      { key: 'files', value: makeFile('a.pdf', FAKE_PDF, 'application/pdf') },
      { key: 'ranges', value: '' },
      { key: 'files', value: makeFile('b.pdf', FAKE_PDF, 'application/pdf') },
      { key: 'ranges', value: '   ' },
    ]));

    expect(res.status).toBe(200);
    expect(engine.mergePdfs).not.toHaveBeenCalled();
  });
});

// ── /api/pdf/image-to-pdf ─────────────────────────────────────────────────────

describe('POST /api/pdf/image-to-pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    vi.mocked(imageToPdf).mockResolvedValue(FAKE_PDF);
    vi.mocked(mergeUniversal).mockResolvedValue(FAKE_PDF);
  });

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await imageToPdfPOST(makeRequest([
      { key: 'files', value: makeFile('a.png', PNG_1x1_RGB, 'image/png') },
    ]));
    expect(res.status).toBe(401);
  });

  it('converts a single PNG → 200, application/pdf, body starts with %PDF', async () => {
    const res = await imageToPdfPOST(makeRequest([
      { key: 'files', value: makeFile('pic.png', PNG_1x1_RGB, 'image/png') },
    ]));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(vi.mocked(imageToPdf)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mergeUniversal)).not.toHaveBeenCalled();
  });

  it('routes multiple images through mergeUniversal (multi-page)', async () => {
    const res = await imageToPdfPOST(makeRequest([
      { key: 'files', value: makeFile('a.png', PNG_1x1_RGB, 'image/png') },
      { key: 'files', value: makeFile('b.png', PNG_1x1_RGB, 'image/png') },
    ]));
    expect(res.status).toBe(200);
    expect(vi.mocked(mergeUniversal)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(imageToPdf)).not.toHaveBeenCalled();
  });

  it('returns 400 when no file is supplied', async () => {
    const res = await imageToPdfPOST(makeRequest([]));
    expect(res.status).toBe(400);
  });

  it('returns 415 when the file is not a supported image (bad ext + bad magic)', async () => {
    const res = await imageToPdfPOST(makeRequest([
      { key: 'files', value: makeFile('notes.txt', new Uint8Array([0x68, 0x69]), 'text/plain') },
    ]));
    expect(res.status).toBe(415);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/not a supported image/i);
  });

  it('accepts an image by magic bytes even with no extension', async () => {
    const res = await imageToPdfPOST(makeRequest([
      { key: 'files', value: makeFile('nodot', PNG_1x1_RGB, 'image/png') },
    ]));
    expect(res.status).toBe(200);
  });

  it('returns 415 when the engine rejects the image bytes', async () => {
    vi.mocked(imageToPdf).mockRejectedValue(
      new (PDFEngineError as unknown as new (m: string, c: string) => Error)(
        'could not convert image to PDF',
        'PDF_IMAGE_CONVERT_FAILED',
      ),
    );
    const res = await imageToPdfPOST(makeRequest([
      { key: 'files', value: makeFile('pic.png', PNG_1x1_RGB, 'image/png') },
    ]));
    expect(res.status).toBe(415);
  });
});

// ── /api/pdf/to-image ─────────────────────────────────────────────────────────

describe('POST /api/pdf/to-image', () => {
  /** A 2-page document handle stub. */
  const handle = { pageCount: 2 } as unknown as Parameters<typeof closeDocument>[0];
  /** A tiny valid PNG the renderer returns per page (Buffer, as the real API does). */
  const PNG_BUF = Buffer.from(PNG_1x1_RGB);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    vi.mocked(openDocument).mockResolvedValue(handle as never);
    vi.mocked(renderPage).mockResolvedValue(PNG_BUF as never);
    vi.mocked(closeDocument).mockReturnValue(undefined);
  });

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await toImagePOST(makeRequest([
      { key: 'file', value: makeFile('doc.pdf', FAKE_PDF, 'application/pdf') },
    ]));
    expect(res.status).toBe(401);
  });

  it('rasterises every page → 200 application/zip with a non-empty body', async () => {
    const res = await toImagePOST(makeRequest([
      { key: 'file', value: makeFile('doc.pdf', FAKE_PDF, 'application/pdf') },
    ]));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    // One renderPage call per page (pageCount = 2).
    expect(vi.mocked(renderPage)).toHaveBeenCalledTimes(2);
    const buf = new Uint8Array(await res.arrayBuffer());
    // ZIP local-file header magic: PK\x03\x04
    expect([buf[0], buf[1], buf[2], buf[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // Always closes the document handle.
    expect(vi.mocked(closeDocument)).toHaveBeenCalledWith(handle);
  });

  it('passes the requested scale through to renderPage', async () => {
    await toImagePOST(makeRequest([
      { key: 'file', value: makeFile('doc.pdf', FAKE_PDF, 'application/pdf') },
      { key: 'scale', value: '3' },
    ]));
    const opts = vi.mocked(renderPage).mock.calls[0]![2];
    expect(opts).toMatchObject({ scale: 3, format: 'png' });
  });

  it('returns 400 when no PDF is supplied', async () => {
    const res = await toImagePOST(makeRequest([]));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-positive scale', async () => {
    const res = await toImagePOST(makeRequest([
      { key: 'file', value: makeFile('doc.pdf', FAKE_PDF, 'application/pdf') },
      { key: 'scale', value: '0' },
    ]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/scale/i);
  });

  it('returns 422 when the PDF is corrupted', async () => {
    vi.mocked(openDocument).mockRejectedValue(
      new (PDFCorruptedError as unknown as new () => Error)(),
    );
    const res = await toImagePOST(makeRequest([
      { key: 'file', value: makeFile('doc.pdf', FAKE_PDF, 'application/pdf') },
    ]));
    expect(res.status).toBe(422);
  });
});
