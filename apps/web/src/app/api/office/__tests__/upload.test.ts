/**
 * Tests for POST /api/office/upload
 *
 * Strategy:
 *   - Mock @giga-pdf/pdf-engine to avoid running the WASM engine in unit tests
 *   - Mock @/lib/auth-helpers to control auth outcomes
 *   - Mock @/lib/server-logger to silence structured logs
 *   - Directly invoke the POST handler (Next.js App Router style)
 *   - Provide fake Request objects with a stub formData() to avoid multipart
 *     stream parsing issues in the jsdom/Node test environment
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── jsdom polyfill: File.prototype.arrayBuffer ────────────────────────────────
// jsdom (used by Vitest in jsdom environment) does not implement
// File.prototype.arrayBuffer / Blob.prototype.arrayBuffer.
// We polyfill it here so the route handler can call file.arrayBuffer()
// without hitting a TypeError that the outer catch turns into 500.
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

// ── Mocks (must be declared before imports) ───────────────────────────────────

vi.mock('@giga-pdf/pdf-engine', () => {
  const PDFEngineError = class PDFEngineError extends Error {
    code: string;
    constructor(message: string, code = 'PDF_ENGINE_ERROR') {
      super(message);
      this.name = 'PDFEngineError';
      this.code = code;
    }
  };
  const OfficeConversionError = class OfficeConversionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'OfficeConversionError';
    }
  };

  return {
    convertOfficeToPdf: vi.fn(),
    rtfToPdf: vi.fn(),
    OfficeConversionError,
    PDFEngineError,
  };
});

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/server-logger', () => ({
  serverLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// 'server-only' guard — prevent import crash in test environment
vi.mock('server-only', () => ({}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '../upload/route';
import {
  convertOfficeToPdf,
  rtfToPdf,
  OfficeConversionError,
  PDFEngineError,
} from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Valid ZIP magic bytes (PK\x03\x04) — OOXML (docx/xlsx/pptx) and ODF (odt/ods/odp). */
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

/** Valid OLE2 compound-file magic bytes — legacy Office 97-2003 (doc/xls/ppt). */
const OLE2_MAGIC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Valid RTF magic bytes (`{\rtf`). */
const RTF_MAGIC = new Uint8Array([0x7b, 0x5c, 0x72, 0x74, 0x66]);

/** Minimal fake PDF bytes for mock return values. */
const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

/** Authenticated session mock (default used in most tests). */
const mockAuthOk = {
  ok: true as const,
  context: { userId: 'user-123', email: 'test@example.com', role: 'user' },
};

/** Unauthenticated session mock. */
const mockAuthFail = {
  ok: false as const,
  response: new Response(JSON.stringify({ success: false, error: 'Authentication required.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  }),
};

/**
 * Builds a fake Request whose formData() resolves synchronously.
 *
 * jsdom does not support multipart/form-data streaming, so constructing a real
 * Request with a FormData body causes formData() to hang indefinitely.
 * We bypass this by providing a pre-populated FormData via a stub.
 */
function makeRequest(file: File | null): Request {
  const fd = new FormData();
  if (file) fd.append('file', file);

  // Create a minimal Request-like object and override formData() with a stub.
  // The route only calls request.formData() — no other Request method is used.
  const req = new Request('http://localhost/api/office/upload', {
    method: 'POST',
    // Provide a dummy body so the Request is valid; the real formData() is overridden.
    body: 'dummy',
    // Headers must not be multipart (we are overriding formData directly).
    headers: { 'Content-Type': 'text/plain' },
  });

  // Stub formData to return our pre-built FormData without stream parsing.
  Object.defineProperty(req, 'formData', {
    value: () => Promise.resolve(fd),
  });

  return req;
}

/** Creates a synthetic File with given content and name. */
function makeFile(name: string, content: Uint8Array): File {
  // TypeScript's BlobPart union requires ArrayBuffer (not ArrayBufferLike).
  // Copying into a fresh ArrayBuffer narrows the type appropriately.
  const plain = new Uint8Array(new ArrayBuffer(content.byteLength));
  plain.set(content);
  return new File([plain], name, { type: 'application/octet-stream' });
}

/** Creates a valid modern Office/ODF file: ZIP magic bytes + zero padding. */
function makeValidOfficeFile(name: string, extraBytes = 100): File {
  const buf = new Uint8Array(4 + extraBytes);
  buf.set(ZIP_MAGIC, 0);
  return makeFile(name, buf);
}

/** Creates a valid legacy Office 97-2003 file: OLE2 magic bytes + zero padding. */
function makeValidLegacyOfficeFile(name: string, extraBytes = 100): File {
  const buf = new Uint8Array(OLE2_MAGIC.length + extraBytes);
  buf.set(OLE2_MAGIC, 0);
  return makeFile(name, buf);
}

/** Creates a valid RTF file: `{\rtf` magic bytes + a tiny body. */
function makeValidRtfFile(name: string, extraBytes = 32): File {
  const buf = new Uint8Array(RTF_MAGIC.length + extraBytes);
  buf.set(RTF_MAGIC, 0);
  return makeFile(name, buf);
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('POST /api/office/upload', () => {
  beforeEach(() => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    vi.mocked(convertOfficeToPdf).mockResolvedValue(FAKE_PDF);
    vi.mocked(rtfToPdf).mockResolvedValue(FAKE_PDF);
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const req = makeRequest(makeValidOfficeFile('test.docx'));
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  // ── Missing file ──────────────────────────────────────────────────────────

  it('returns 400 when no file is provided', async () => {
    const req = makeRequest(null);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/missing required field: file/i);
  });

  // ── Extension validation ──────────────────────────────────────────────────

  it('returns 400 for .pdf extension', async () => {
    const file = makeFile('doc.pdf', ZIP_MAGIC);
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/unsupported file extension/i);
  });

  it('returns 400 for .txt extension', async () => {
    const file = makeFile('doc.txt', ZIP_MAGIC);
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  it('returns 400 for extension-less filename', async () => {
    const file = makeFile('nodotname', ZIP_MAGIC);
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  it('returns 200 with application/pdf for a .rtf file with RTF magic bytes', async () => {
    const file = makeValidRtfFile('letter.rtf');
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    const body = await res.arrayBuffer();
    expect(new Uint8Array(body)).toEqual(FAKE_PDF);
  });

  it('routes RTF through rtfToPdf (NOT convertOfficeToPdf)', async () => {
    const file = makeValidRtfFile('notes.rtf');
    await POST(makeRequest(file));
    expect(vi.mocked(rtfToPdf)).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(vi.mocked(convertOfficeToPdf)).not.toHaveBeenCalled();
  });

  it('accepts .RTF (uppercase extension)', async () => {
    const file = makeValidRtfFile('MEMO.RTF');
    const res = await POST(makeRequest(file));
    expect(res.status).toBe(200);
  });

  it('returns 400 for a .rtf that lacks the {\\rtf magic bytes', async () => {
    const file = makeFile('fake.rtf', OLE2_MAGIC);
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid magic bytes/i);
  });

  it('returns 422 when rtfToPdf rejects with a PDFEngineError', async () => {
    vi.mocked(rtfToPdf).mockRejectedValue(
      new PDFEngineError('unrecognized RTF', 'PDF_RTF_CONVERT_FAILED'),
    );
    const file = makeValidRtfFile('broken.rtf');
    const res = await POST(makeRequest(file));
    expect(res.status).toBe(422);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/convert/i);
  });

  it('accepts .DOCX (uppercase extension)', async () => {
    const file = makeValidOfficeFile('REPORT.DOCX');
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  // ── Magic bytes validation ────────────────────────────────────────────────

  it('returns 400 when magic bytes are not ZIP (PK\\x03\\x04)', async () => {
    // Valid extension but wrong content (e.g. raw HTML disguised as docx)
    const invalidContent = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]); // <html
    const file = makeFile('test.docx', invalidContent);
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid magic bytes/i);
  });

  it('returns 400 when buffer is too short to contain magic bytes', async () => {
    const file = makeFile('test.xlsx', new Uint8Array([0x50, 0x4b])); // only 2 bytes
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  it('returns 400 when a legacy .doc carries ZIP magic instead of OLE2 (family mismatch)', async () => {
    // ZIP bytes are valid for docx but NOT for .doc — per-family validation
    const file = makeValidOfficeFile('report.doc');
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid magic bytes/i);
  });

  it('returns 400 when an .odt carries OLE2 magic instead of ZIP (family mismatch)', async () => {
    const file = makeValidLegacyOfficeFile('notes.odt');
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid magic bytes/i);
  });

  it('returns 400 when a .doc buffer matches only a ZIP-length prefix of OLE2 magic', async () => {
    // First 4 bytes of OLE2 only — must still be rejected (full 8-byte check)
    const file = makeFile('short.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]));
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  // ── Size validation ───────────────────────────────────────────────────────

  it('returns 413 when file exceeds 250 MB', async () => {
    // Mock the reported size (250 MB + 1) instead of allocating it: the route
    // rejects on file.size before reading the body, so a tiny file with an
    // overridden size getter exercises the same 413 path without the OOM.
    const file = makeFile('huge.docx', ZIP_MAGIC);
    Object.defineProperty(file, 'size', { value: 250 * 1024 * 1024 + 1, configurable: true });
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(413);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/too large/i);
  });

  it('accepts a file exactly at the 250 MB limit', async () => {
    // Override size to exactly the limit (≤ MAX_FILE_SIZE passes); the tiny
    // ZIP-magic body still satisfies the magic-bytes check + mocked conversion.
    const file = makeFile('at-limit.pptx', ZIP_MAGIC);
    Object.defineProperty(file, 'size', { value: 250 * 1024 * 1024, configurable: true });
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  // ── Successful conversion ─────────────────────────────────────────────────

  it('returns 200 with application/pdf on successful .docx conversion', async () => {
    const file = makeValidOfficeFile('report.docx');
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    const body = await res.arrayBuffer();
    expect(new Uint8Array(body)).toEqual(FAKE_PDF);
  });

  it('returns 200 with application/pdf on successful .xlsx conversion', async () => {
    const file = makeValidOfficeFile('spreadsheet.xlsx');
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });

  it('returns 200 with application/pdf on successful .pptx conversion', async () => {
    const file = makeValidOfficeFile('slides.pptx');
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });

  it('sets Content-Disposition to attachment with base filename + .pdf', async () => {
    const file = makeValidOfficeFile('My Document.docx');
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const contentDisposition = res.headers.get('Content-Disposition') ?? '';
    expect(contentDisposition).toContain('attachment');
    expect(contentDisposition).toContain('My Document.pdf');
  });

  it('passes correct format to convertOfficeToPdf for .docx', async () => {
    const file = makeValidOfficeFile('test.docx');
    await POST(makeRequest(file));
    expect(vi.mocked(convertOfficeToPdf)).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'docx',
    );
  });

  it('passes correct format to convertOfficeToPdf for .xlsx', async () => {
    const file = makeValidOfficeFile('test.xlsx');
    await POST(makeRequest(file));
    expect(vi.mocked(convertOfficeToPdf)).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'xlsx',
    );
  });

  it('passes correct format to convertOfficeToPdf for .pptx', async () => {
    const file = makeValidOfficeFile('test.pptx');
    await POST(makeRequest(file));
    expect(vi.mocked(convertOfficeToPdf)).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'pptx',
    );
  });

  // ── Legacy Office 97-2003 (OLE2) formats ──────────────────────────────────

  it('returns 200 with application/pdf for a .doc file with OLE2 magic bytes', async () => {
    const file = makeValidLegacyOfficeFile('contract.doc');
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(vi.mocked(convertOfficeToPdf)).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'doc',
    );
  });

  it('accepts .xls and passes "xls" to convertOfficeToPdf', async () => {
    const file = makeValidLegacyOfficeFile('ledger.xls');
    const res = await POST(makeRequest(file));
    expect(res.status).toBe(200);
    expect(vi.mocked(convertOfficeToPdf)).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'xls',
    );
  });

  it('accepts .ppt and passes "ppt" to convertOfficeToPdf', async () => {
    const file = makeValidLegacyOfficeFile('deck.ppt');
    const res = await POST(makeRequest(file));
    expect(res.status).toBe(200);
    expect(vi.mocked(convertOfficeToPdf)).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'ppt',
    );
  });

  it('accepts .DOC (uppercase legacy extension)', async () => {
    const file = makeValidLegacyOfficeFile('MEMO.DOC');
    const res = await POST(makeRequest(file));
    expect(res.status).toBe(200);
  });

  // ── OpenDocument (ODF) formats ────────────────────────────────────────────

  it('returns 200 with application/pdf for an .odt file with ZIP magic bytes', async () => {
    const file = makeValidOfficeFile('letter.odt');
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(vi.mocked(convertOfficeToPdf)).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'odt',
    );
  });

  it('accepts .ods and passes "ods" to convertOfficeToPdf', async () => {
    const file = makeValidOfficeFile('budget.ods');
    const res = await POST(makeRequest(file));
    expect(res.status).toBe(200);
    expect(vi.mocked(convertOfficeToPdf)).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'ods',
    );
  });

  it('accepts .odp and passes "odp" to convertOfficeToPdf', async () => {
    const file = makeValidOfficeFile('slides.odp');
    const res = await POST(makeRequest(file));
    expect(res.status).toBe(200);
    expect(vi.mocked(convertOfficeToPdf)).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'odp',
    );
  });

  // ── Conversion errors ─────────────────────────────────────────────────────

  it('returns 422 when OfficeConversionError is thrown', async () => {
    vi.mocked(convertOfficeToPdf).mockRejectedValue(
      new OfficeConversionError('conversion failed'),
    );
    const file = makeValidOfficeFile('corrupt.docx');
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/convert/i);
  });

  // ── Unhandled errors ──────────────────────────────────────────────────────

  it('returns 500 on unexpected errors', async () => {
    vi.mocked(convertOfficeToPdf).mockRejectedValue(new Error('Unexpected internal failure'));
    const file = makeValidOfficeFile('test.docx');
    const req = makeRequest(file);
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });
});
