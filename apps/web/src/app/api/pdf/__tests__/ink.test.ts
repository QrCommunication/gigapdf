/**
 * Tests for POST /api/pdf/ink — bake a freehand ink (`/Ink`) annotation.
 *
 * Strategy (mirrors color.test.ts):
 *   - Mock @qrcommunication/gigapdf-lib so the WASM engine never loads in jsdom.
 *     The fake GigaPdfDoc records addInk + saveCompressed and returns real
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
  addInk: vi.fn(),
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

import { POST } from '../ink/route';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);
const POINTS = [10, 20, 30, 40, 50, 60];

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
  const req = new Request('http://localhost/api/pdf/ink', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'text/plain' },
  });
  Object.defineProperty(req, 'formData', { value: () => Promise.resolve(fd) });
  return req;
}

/** A valid PDF + page=1 + a 3-point polyline, plus optional overrides. */
function makeInkRequest(extra: { key: string; value: File | string }[] = []): Request {
  return makeRequest([
    { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
    { key: 'page', value: '1' },
    { key: 'points', value: JSON.stringify(POINTS) },
    ...extra,
  ]);
}

async function bodyStartsWithPdf(res: Response): Promise<boolean> {
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/ink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    engine.addInk.mockReturnValue(true);
    engine.saveCompressed.mockReturnValue(FAKE_PDF);
    engine.close.mockReturnValue(undefined);
    engine.open.mockReturnValue({
      addInk: engine.addInk,
      saveCompressed: engine.saveCompressed,
      close: engine.close,
    });
    engine.loadDefault.mockResolvedValue({ open: engine.open });
  });

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await POST(makeInkRequest());
    expect(res.status).toBe(401);
    expect(engine.open).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-positive page', async () => {
    const res = await POST(makeInkRequest([{ key: 'page', value: '0' }]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/page must be/i);
  });

  it('returns 400 when points are missing', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'page', value: '1' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/points/i);
  });

  it('returns 400 for an odd-length points array', async () => {
    const res = await POST(makeInkRequest([{ key: 'points', value: JSON.stringify([1, 2, 3]) }]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/at least two points/i);
  });

  it('returns 400 for a single point (too short)', async () => {
    const res = await POST(makeInkRequest([{ key: 'points', value: JSON.stringify([1, 2]) }]));
    expect(res.status).toBe(400);
  });

  it('returns 400 when points contain a non-finite value', async () => {
    const res = await POST(makeInkRequest([{ key: 'points', value: '[1, 2, null, 4]' }]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/finite numbers/i);
  });

  it('returns 400 for an out-of-range rgb', async () => {
    const res = await POST(makeInkRequest([{ key: 'rgb', value: String(0x1000000) }]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/rgb/i);
  });

  it('returns 400 for a non-positive lineWidth', async () => {
    const res = await POST(makeInkRequest([{ key: 'lineWidth', value: '0' }]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/lineWidth/i);
  });

  it('points only → 200, addInk(page, points, undefined, undefined) + saveCompressed + close', async () => {
    const res = await POST(makeInkRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(engine.addInk).toHaveBeenCalledWith(1, POINTS, undefined, undefined);
    expect(engine.saveCompressed).toHaveBeenCalledTimes(1);
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('forwards rgb + lineWidth when supplied', async () => {
    const res = await POST(
      makeInkRequest([
        { key: 'rgb', value: String(0xff0000) },
        { key: 'lineWidth', value: '3.5' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.addInk).toHaveBeenCalledWith(1, POINTS, 0xff0000, 3.5);
  });

  it('returns 422 and closes the doc when the engine rejects the stroke', async () => {
    engine.addInk.mockReturnValue(false);
    const res = await POST(makeInkRequest([{ key: 'page', value: '999' }]));
    expect(res.status).toBe(422);
    expect(engine.saveCompressed).not.toHaveBeenCalled();
    expect(engine.close).toHaveBeenCalledTimes(1);
  });
});
