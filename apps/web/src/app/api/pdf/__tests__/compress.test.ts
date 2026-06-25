/**
 * Tests for POST /api/pdf/compress — default recompression pipeline plus the
 * optimize (object/xref streams) and linearize (Fast Web View) serializers and
 * the PDF version selector (issues #84 saveOptimized / #93 toLinearized).
 *
 * Strategy (mirrors merge-universal.test.ts):
 *   - Mock @giga-pdf/pdf-engine so the WASM engine never loads under jsdom. The
 *     open handle exposes a `_doc` stub with saveOptimized/saveLinearized so the
 *     route contract — which serializer is used, with which options — is
 *     exercised without the real engine.
 *   - Mock @/lib/auth-helpers, @/lib/server-logger and 'server-only' to keep the
 *     route importable; the real validatePdfFile / sanitizeContentDisposition run.
 *   - Drive POST directly with a fake Request whose formData() resolves sync.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── jsdom polyfill: File.prototype.arrayBuffer / Blob.prototype.arrayBuffer ───
for (const proto of [File.prototype, Blob.prototype]) {
  if (!('arrayBuffer' in proto)) {
    Object.defineProperty(proto, 'arrayBuffer', {
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
}

// ── Mocks (declared before route imports) ─────────────────────────────────────

vi.mock('@giga-pdf/pdf-engine', () => {
  const PDFEncryptedError = class PDFEncryptedError extends Error {
    constructor(message = 'encrypted') {
      super(message);
      this.name = 'PDFEncryptedError';
    }
  };
  const PDFCorruptedError = class PDFCorruptedError extends Error {
    constructor(message = 'corrupted') {
      super(message);
      this.name = 'PDFCorruptedError';
    }
  };
  const PDFParseError = class PDFParseError extends Error {
    constructor(message = 'parse') {
      super(message);
      this.name = 'PDFParseError';
    }
  };

  return {
    openDocument: vi.fn(),
    closeDocument: vi.fn(),
    saveDocument: vi.fn(),
    optimizeAndSave: vi.fn(),
    PDFEncryptedError,
    PDFCorruptedError,
    PDFParseError,
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

import { POST as compressPOST } from '../compress/route';
import {
  openDocument,
  closeDocument,
  saveDocument,
  optimizeAndSave,
  PDFEncryptedError,
} from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const saveOptimized = vi.fn();
const saveLinearized = vi.fn();

/** Open-document handle stub exposing the live `_doc` serializers. */
const handle = {
  pageCount: 1,
  _doc: { saveOptimized, saveLinearized },
} as unknown as Awaited<ReturnType<typeof openDocument>>;

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

function makeFile(name: string, content: Uint8Array, type = 'application/pdf'): File {
  const plain = new Uint8Array(new ArrayBuffer(content.byteLength));
  plain.set(content);
  return new File([plain], name, { type });
}

function makeRequest(fields: { key: string; value: File | string }[]): Request {
  const fd = new FormData();
  for (const { key, value } of fields) fd.append(key, value);
  const req = new Request('http://localhost/api/pdf/compress', {
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

const pdfFile = () => makeFile('doc.pdf', FAKE_PDF);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/compress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    vi.mocked(openDocument).mockResolvedValue(handle);
    vi.mocked(closeDocument).mockReturnValue(undefined);
    vi.mocked(saveDocument).mockResolvedValue(FAKE_PDF as never);
    vi.mocked(optimizeAndSave).mockResolvedValue({
      bytes: FAKE_PDF,
      optimized: true,
      inputBytes: FAKE_PDF.byteLength,
      outputBytes: FAKE_PDF.byteLength,
    } as never);
    saveOptimized.mockReturnValue(FAKE_PDF);
    saveLinearized.mockReturnValue(FAKE_PDF);
  });

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await compressPOST(makeRequest([{ key: 'file', value: pdfFile() }]));
    expect(res.status).toBe(401);
  });

  it('returns 400 when no file is supplied', async () => {
    const res = await compressPOST(makeRequest([]));
    expect(res.status).toBe(400);
  });

  it('default (no options) runs the recompression pipeline, not the serializers', async () => {
    const res = await compressPOST(makeRequest([{ key: 'file', value: pdfFile() }]));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(vi.mocked(saveDocument)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(optimizeAndSave)).toHaveBeenCalledTimes(1);
    expect(saveOptimized).not.toHaveBeenCalled();
    expect(saveLinearized).not.toHaveBeenCalled();
  });

  it('optimize=true → saveOptimized with object/xref streams + version 1.7, closes the handle', async () => {
    const res = await compressPOST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'optimize', value: 'true' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(saveOptimized).toHaveBeenCalledWith({
      objectStreams: true,
      xrefStreams: true,
      version: '1.7',
    });
    // The compact serializer replaces the default pipeline.
    expect(vi.mocked(saveDocument)).not.toHaveBeenCalled();
    expect(vi.mocked(optimizeAndSave)).not.toHaveBeenCalled();
    expect(saveLinearized).not.toHaveBeenCalled();
    expect(vi.mocked(closeDocument)).toHaveBeenCalledWith(handle);
  });

  it('linearize=true → saveLinearized (Fast Web View), closes the handle', async () => {
    const res = await compressPOST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'linearize', value: 'true' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(saveLinearized).toHaveBeenCalledWith('1.7');
    expect(saveOptimized).not.toHaveBeenCalled();
    expect(vi.mocked(closeDocument)).toHaveBeenCalledWith(handle);
  });

  it('linearize takes precedence when both optimize and linearize are set', async () => {
    await compressPOST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'optimize', value: 'true' },
        { key: 'linearize', value: 'true' },
      ]),
    );
    expect(saveLinearized).toHaveBeenCalledTimes(1);
    expect(saveOptimized).not.toHaveBeenCalled();
  });

  it('passes version 2.0 through to the optimized serializer', async () => {
    await compressPOST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'optimize', value: 'true' },
        { key: 'version', value: '2.0' },
      ]),
    );
    expect(saveOptimized).toHaveBeenCalledWith(
      expect.objectContaining({ version: '2.0' }),
    );
  });

  it('exposes original/compressed size headers on the optimized path', async () => {
    const res = await compressPOST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'optimize', value: 'true' },
      ]),
    );
    expect(Number(res.headers.get('X-Original-Size'))).toBe(FAKE_PDF.byteLength);
    expect(Number(res.headers.get('X-Compressed-Size'))).toBe(FAKE_PDF.byteLength);
  });

  it('returns 422 when the PDF is encrypted', async () => {
    vi.mocked(openDocument).mockRejectedValue(
      new (PDFEncryptedError as unknown as new () => Error)(),
    );
    const res = await compressPOST(
      makeRequest([
        { key: 'file', value: pdfFile() },
        { key: 'optimize', value: 'true' },
      ]),
    );
    expect(res.status).toBe(422);
  });
});
