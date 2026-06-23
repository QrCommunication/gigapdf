/**
 * Tests for POST /api/convert/image
 *
 * Strategy (mirrors /api/office/upload):
 *   - Mock @giga-pdf/pdf-engine to avoid running the WASM engine in unit tests
 *   - Mock @/lib/auth-helpers to control auth outcomes
 *   - Mock @/lib/server-logger to silence structured logs
 *   - Directly invoke the POST handler (Next.js App Router style)
 *   - Provide fake Request objects with a stub formData() to avoid multipart
 *     stream parsing issues in the jsdom/Node test environment
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── jsdom polyfill: File/Blob.prototype.arrayBuffer ───────────────────────────
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
  return {
    imageToPdf: vi.fn(),
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

vi.mock('server-only', () => ({}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '../image/route';
import { imageToPdf, PDFEngineError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // \x89PNG
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff]); // SOI
const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

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

function makeRequest(file: File | null): Request {
  const fd = new FormData();
  if (file) fd.append('file', file);
  const req = new Request('http://localhost/api/convert/image', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'text/plain' },
  });
  Object.defineProperty(req, 'formData', { value: () => Promise.resolve(fd) });
  return req;
}

function makeFile(name: string, content: Uint8Array): File {
  // Copy into a fresh ArrayBuffer so BlobPart narrows to ArrayBuffer (not …Like).
  const plain = new Uint8Array(new ArrayBuffer(content.byteLength));
  plain.set(content);
  return new File([plain], name, { type: 'application/octet-stream' });
}

/** A valid image file: requested magic bytes + zero padding. */
function makeValidImage(name: string, magic: Uint8Array, extra = 100): File {
  const buf = new Uint8Array(magic.length + extra);
  buf.set(magic, 0);
  return makeFile(name, buf);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
  vi.mocked(imageToPdf).mockResolvedValue(FAKE_PDF);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/convert/image', () => {
  it('returns 401 when unauthenticated (engine never called)', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await POST(makeRequest(makeValidImage('a.png', PNG_MAGIC)));
    expect(res.status).toBe(401);
    expect(imageToPdf).not.toHaveBeenCalled();
  });

  it('returns 400 when no file is provided', async () => {
    const res = await POST(makeRequest(null));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unsupported extension', async () => {
    const res = await POST(makeRequest(makeValidImage('vector.svg', PNG_MAGIC)));
    expect(res.status).toBe(400);
    expect(imageToPdf).not.toHaveBeenCalled();
  });

  it('returns 400 when the magic bytes do not match an image', async () => {
    // .png extension but bytes are not a PNG (no valid image magic).
    const notAnImage = makeFile('fake.png', new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]));
    const res = await POST(makeRequest(notAnImage));
    expect(res.status).toBe(400);
    expect(imageToPdf).not.toHaveBeenCalled();
  });

  it('converts a valid PNG and returns application/pdf', async () => {
    const res = await POST(makeRequest(makeValidImage('photo.png', PNG_MAGIC)));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('photo.pdf');
    expect(imageToPdf).toHaveBeenCalledTimes(1);
  });

  it('converts a valid JPEG (case-insensitive extension)', async () => {
    const res = await POST(makeRequest(makeValidImage('scan.JPEG', JPEG_MAGIC)));
    expect(res.status).toBe(200);
    expect(imageToPdf).toHaveBeenCalledTimes(1);
  });

  it('maps a PDFEngineError (bad image) to 422', async () => {
    vi.mocked(imageToPdf).mockRejectedValue(
      new PDFEngineError('bad image', 'PDF_IMAGE_CONVERT_FAILED'),
    );
    const res = await POST(makeRequest(makeValidImage('corrupt.png', PNG_MAGIC)));
    expect(res.status).toBe(422);
  });
});
