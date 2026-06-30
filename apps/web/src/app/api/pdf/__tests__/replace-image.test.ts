/**
 * Tests for POST /api/pdf/replace-image — in-place image XObject swap.
 *
 * Strategy (mirrors color.test.ts):
 *   - Mock @qrcommunication/gigapdf-lib so the WASM engine never loads in jsdom.
 *     The fake GigaPdfDoc records replaceImage + saveCompressed and returns real
 *     `%PDF` bytes, so the route contract — status, headers, body, the engine
 *     method run, and that doc.close() always fires — is exercised end to end.
 *   - Use the REAL validatePdfFile / sanitizeContentDisposition.
 *   - Mock @/lib/auth-helpers to control auth, and the logger to stay quiet.
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

// ── Hoisted engine mocks ──────────────────────────────────────────────────────
const engine = vi.hoisted(() => ({
  replaceImage: vi.fn(),
  saveCompressed: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
  loadDefault: vi.fn(),
}));

vi.mock('@qrcommunication/gigapdf-lib', () => ({
  GigaPdfEngine: { loadDefault: engine.loadDefault },
}));

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/server-logger', () => ({
  serverLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('server-only', () => ({}));

import { POST } from '../replace-image/route';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]); // PNG sig
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]); // "GIF89a"
const TIFF_BYTES = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]); // "II*\0" (little-endian)
const AVIF_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]); // ftyp…avif
const NOT_AN_IMAGE = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);

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
  // set (not append) so later override entries replace the base field — get()
  // returns the first appended value, which would otherwise mask the override.
  for (const { key, value } of fields) fd.set(key, value);
  const req = new Request('http://localhost/api/pdf/replace-image', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'text/plain' },
  });
  Object.defineProperty(req, 'formData', { value: () => Promise.resolve(fd) });
  return req;
}

/** A valid PDF + page=1 + imageIndex=0 + a PNG, plus optional overrides. */
function makeReplaceRequest(extra: { key: string; value: File | string }[] = []): Request {
  return makeRequest([
    { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
    { key: 'page', value: '1' },
    { key: 'imageIndex', value: '0' },
    { key: 'image', value: makeFile('logo.png', PNG_BYTES, 'image/png') },
    ...extra,
  ]);
}

async function bodyStartsWithPdf(res: Response): Promise<boolean> {
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/replace-image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    engine.replaceImage.mockReturnValue(true);
    engine.saveCompressed.mockReturnValue(FAKE_PDF);
    engine.close.mockReturnValue(undefined);
    engine.open.mockReturnValue({
      replaceImage: engine.replaceImage,
      saveCompressed: engine.saveCompressed,
      close: engine.close,
    });
    engine.loadDefault.mockResolvedValue({ open: engine.open });
  });

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await POST(makeReplaceRequest());
    expect(res.status).toBe(401);
    expect(engine.open).not.toHaveBeenCalled();
  });

  it('returns 400 when no file is supplied', async () => {
    const res = await POST(
      makeRequest([
        { key: 'page', value: '1' },
        { key: 'imageIndex', value: '0' },
        { key: 'image', value: makeFile('logo.png', PNG_BYTES, 'image/png') },
      ]),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-positive page', async () => {
    const res = await POST(makeReplaceRequest([{ key: 'page', value: '0' }]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/page must be/i);
  });

  it('returns 400 for a negative imageIndex', async () => {
    const res = await POST(makeReplaceRequest([{ key: 'imageIndex', value: '-1' }]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/imageIndex/i);
  });

  it('returns 400 when the image field is missing', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'page', value: '1' },
        { key: 'imageIndex', value: '0' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/image file is required/i);
  });

  it('returns 400 when the image is not a recognized raster', async () => {
    const res = await POST(
      makeReplaceRequest([{ key: 'image', value: makeFile('x.bin', NOT_AN_IMAGE, 'application/octet-stream') }]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/PNG, JPEG, WebP, GIF, TIFF or AVIF/i);
    expect(engine.open).not.toHaveBeenCalled();
  });

  it('PNG → 200 application/pdf, replaceImage(page, index, bytes) + saveCompressed + close', async () => {
    const res = await POST(makeReplaceRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(engine.replaceImage).toHaveBeenCalledTimes(1);
    const [pageArg, indexArg, bytesArg] = engine.replaceImage.mock.calls[0]!;
    expect(pageArg).toBe(1);
    expect(indexArg).toBe(0);
    expect(bytesArg).toBeInstanceOf(Uint8Array);
    expect(engine.saveCompressed).toHaveBeenCalledTimes(1);
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('accepts a JPEG bitmap', async () => {
    const res = await POST(
      makeReplaceRequest([{ key: 'image', value: makeFile('photo.jpg', JPEG_BYTES, 'image/jpeg') }]),
    );
    expect(res.status).toBe(200);
    expect(engine.replaceImage).toHaveBeenCalledTimes(1);
  });

  // `replaceImage` shares the addImage decode path → all 6 rasters since 0.109.
  it.each([
    ['GIF', GIF_BYTES, 'image/gif', 'pic.gif'],
    ['TIFF', TIFF_BYTES, 'image/tiff', 'pic.tiff'],
    ['AVIF', AVIF_BYTES, 'image/avif', 'pic.avif'],
  ])('accepts a %s bitmap at the gate', async (_label, bytes, type, name) => {
    const res = await POST(makeReplaceRequest([{ key: 'image', value: makeFile(name, bytes, type) }]));
    expect(res.status).toBe(200);
    expect(engine.replaceImage).toHaveBeenCalledTimes(1);
  });

  it('returns 422 and closes the doc when the engine rejects the swap', async () => {
    engine.replaceImage.mockReturnValue(false);
    const res = await POST(makeReplaceRequest([{ key: 'imageIndex', value: '99' }]));
    expect(res.status).toBe(422);
    expect(engine.saveCompressed).not.toHaveBeenCalled();
    expect(engine.close).toHaveBeenCalledTimes(1);
  });
});
