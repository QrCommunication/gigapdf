/**
 * Tests for POST /api/office/export
 *
 * Strategy:
 *   - global.fetch is mocked to simulate the Python backend (document download)
 *   - @giga-pdf/pdf-engine is mocked to simulate the conversion engine
 *   - @/lib/auth-helpers is mocked to control authentication
 *   - server-only imports are hoisted before vi.mock() calls
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Stub 'server-only' so it doesn't throw in a jsdom / Node test environment
vi.mock('server-only', () => ({}));

// Auth helpers — default to authenticated; individual tests override as needed
vi.mock('@/lib/auth-helpers', () => ({
  requireSession: vi.fn().mockResolvedValue({
    ok: true,
    context: { userId: 'user-123', email: 'test@example.com', role: 'user' },
  }),
}));

// Server logger — silence output in tests
vi.mock('@/lib/server-logger', () => ({
  serverLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Content-Disposition helper — use real implementation (pure function, no I/O)
vi.mock('@/lib/content-disposition', async () => {
  const real = await vi.importActual<typeof import('@/lib/content-disposition')>(
    '@/lib/content-disposition',
  );
  return real;
});

// pdf-engine barrel — all pdf-engine exports used by the route
const mockConvertPdfToOffice = vi.fn();
const mockConvertPdfToXlsx = vi.fn();

class OfficeConversionErrorMock extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'OfficeConversionError';
  }
}

vi.mock('@giga-pdf/pdf-engine', () => ({
  convertPdfToOffice: mockConvertPdfToOffice,
  convertPdfToXlsx: mockConvertPdfToXlsx,
  OfficeConversionError: OfficeConversionErrorMock,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal Uint8Array mimicking an Office ZIP blob. */
function fakeOfficeBytes(): Uint8Array {
  // Office files start with PK\x03\x04 (ZIP magic)
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
}

/** Build a minimal Uint8Array mimicking a PDF blob. */
function fakePdfBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 fake content');
}

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/office/export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-jwt-token',
    },
    body: JSON.stringify(body),
  });
}

/** Mock global.fetch to return a successful Python response with PDF bytes. */
function mockPythonSuccess(pdfBytes: Uint8Array = fakePdfBytes()): void {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    }),
  );
}

/** Mock global.fetch to return a 404 from Python. */
function mockPython404(): void {
  global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
}

/** Mock global.fetch to simulate an AbortError (timeout). */
function mockPythonTimeout(): void {
  global.fetch = vi.fn().mockImplementation(() => {
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    return Promise.reject(err);
  });
}

// ─── Import route AFTER mocks are registered ─────────────────────────────────

// Dynamic import is required because vi.mock() is hoisted before static imports,
// but the route module itself reads the mocked modules at import time for some
// dependencies. We use a lazy import inside beforeEach to get a fresh handle.
let POST: (request: NextRequest) => Promise<Response>;

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('POST /api/office/export', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset auth to authenticated by default before every test
    const { requireSession } = await import('@/lib/auth-helpers');
    vi.mocked(requireSession).mockResolvedValue({
      ok: true,
      context: { userId: 'user-123', email: 'test@example.com', role: 'user' },
    });
    // Re-import route to pick up fresh mocks
    const mod = await import('../route');
    POST = mod.POST;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  it('returns 401 when session is missing', async () => {
    const { requireSession } = await import('@/lib/auth-helpers');
    vi.mocked(requireSession).mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({ success: false, error: 'Authentication required.' }),
        { status: 401 },
      ),
    });

    const req = buildRequest({ documentId: 'doc-1', format: 'docx' });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  // ── Body validation ────────────────────────────────────────────────────────

  it('returns 400 when body is missing documentId', async () => {
    mockPythonSuccess();
    const req = buildRequest({ format: 'docx' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Invalid request body');
  });

  it('returns 400 when format is invalid', async () => {
    mockPythonSuccess();
    const req = buildRequest({ documentId: 'doc-1', format: 'pdf' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('returns 400 when body is not valid JSON', async () => {
    const req = new NextRequest('http://localhost/api/office/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json',
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('valid JSON');
  });

  // ── Python backend errors ──────────────────────────────────────────────────

  it('returns 404 when Python backend responds 404', async () => {
    mockPython404();

    const req = buildRequest({ documentId: 'missing-doc', format: 'docx' });
    const res = await POST(req);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('missing-doc');
  });

  it('returns 504 when Python backend times out', async () => {
    mockPythonTimeout();

    const req = buildRequest({ documentId: 'doc-1', format: 'docx' });
    const res = await POST(req);

    expect(res.status).toBe(504);
    const json = await res.json();
    expect(json.error).toContain('timed out');
  });

  // ── Successful conversions ─────────────────────────────────────────────────

  it('returns 200 with docx Content-Type for format=docx', async () => {
    mockPythonSuccess();
    mockConvertPdfToOffice.mockResolvedValue(fakeOfficeBytes());

    const req = buildRequest({ documentId: 'abcdef12-rest', format: 'docx' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(res.headers.get('Content-Disposition')).toContain('.docx');
    expect(mockConvertPdfToOffice).toHaveBeenCalledWith(expect.any(Uint8Array), 'docx');
  });

  it('returns 200 with pptx Content-Type for format=pptx', async () => {
    mockPythonSuccess();
    mockConvertPdfToOffice.mockResolvedValue(fakeOfficeBytes());

    const req = buildRequest({ documentId: 'abcdef12-rest', format: 'pptx' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(res.headers.get('Content-Disposition')).toContain('.pptx');
    expect(mockConvertPdfToOffice).toHaveBeenCalledWith(expect.any(Uint8Array), 'pptx');
  });

  it('returns 200 with xlsx Content-Type for format=xlsx', async () => {
    mockPythonSuccess();
    mockConvertPdfToXlsx.mockResolvedValue(fakeOfficeBytes());

    const req = buildRequest({ documentId: 'abcdef12-rest', format: 'xlsx' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers.get('Content-Disposition')).toContain('.xlsx');
    expect(mockConvertPdfToXlsx).toHaveBeenCalledWith(expect.any(Uint8Array));
  });

  it('returns 200 with odt Content-Type for format=odt', async () => {
    mockPythonSuccess();
    mockConvertPdfToOffice.mockResolvedValue(fakeOfficeBytes());

    const req = buildRequest({ documentId: 'abcdef12-rest', format: 'odt' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.oasis.opendocument.text');
    expect(res.headers.get('Content-Disposition')).toContain('.odt');
    expect(mockConvertPdfToOffice).toHaveBeenCalledWith(expect.any(Uint8Array), 'odt');
  });

  it('returns 200 with odp Content-Type for format=odp', async () => {
    mockPythonSuccess();
    mockConvertPdfToOffice.mockResolvedValue(fakeOfficeBytes());

    const req = buildRequest({ documentId: 'abcdef12-rest', format: 'odp' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.oasis.opendocument.presentation',
    );
    expect(res.headers.get('Content-Disposition')).toContain('.odp');
    expect(mockConvertPdfToOffice).toHaveBeenCalledWith(expect.any(Uint8Array), 'odp');
  });

  it('uses first 8 chars of documentId in the filename', async () => {
    mockPythonSuccess();
    mockConvertPdfToOffice.mockResolvedValue(fakeOfficeBytes());

    const req = buildRequest({ documentId: '1234567890abcdef', format: 'docx' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toContain('12345678'); // first 8 chars
    expect(disposition).not.toContain('1234567890'); // not all 16 chars
  });

  // ── Conversion errors ──────────────────────────────────────────────────────

  it('returns 422 when OfficeConversionError is thrown', async () => {
    mockPythonSuccess();
    mockConvertPdfToOffice.mockRejectedValue(
      new OfficeConversionErrorMock('conversion failed'),
    );

    const req = buildRequest({ documentId: 'doc-1', format: 'pptx' });
    const res = await POST(req);

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toContain('PPTX');
  });

  it('returns 500 on unexpected convertPdfToXlsx error', async () => {
    mockPythonSuccess();
    mockConvertPdfToXlsx.mockRejectedValue(new Error('Out of memory during xlsx generation'));

    const req = buildRequest({ documentId: 'doc-1', format: 'xlsx' });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('unexpected error');
  });
});
