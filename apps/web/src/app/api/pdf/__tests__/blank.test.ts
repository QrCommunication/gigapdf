/**
 * Tests for POST /api/pdf/blank — create a fresh, empty single-page PDF.
 *
 * Strategy (mirrors color.test.ts / page-boxes.test.ts):
 *   - Mock @qrcommunication/gigapdf-lib so the WASM engine never loads in jsdom.
 *     The fake engine records the htmlRender call (width/height/margin) and the
 *     fake GigaPdfDoc records pageCount/addPage/save/close, so the route
 *     contract — status, headers, body, which dimensions are rendered, and the
 *     0-page fallback — is exercised end to end.
 *   - Use the REAL sanitizeContentDisposition (server-only is stubbed so it
 *     imports in jsdom).
 *   - Mock @/lib/auth-helpers to control auth, and the logger to stay quiet.
 *   - Drive POST directly with a fake Request whose json() resolves to the body.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted engine mocks (referenced by the vi.mock factory AND the tests) ────
const engine = vi.hoisted(() => ({
  htmlRender: vi.fn(),
  open: vi.fn(),
  mergePdfs: vi.fn(),
  // doc methods
  pageCount: vi.fn(),
  addPage: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
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

// 'server-only' guard — pulled in by content-disposition.
vi.mock('server-only', () => ({}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '../blank/route';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

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

/** Build a JSON Request whose .json() resolves to `body` (or rejects if omitted). */
function makeRequest(body?: unknown): Request {
  const req = new Request('http://localhost/api/pdf/blank', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'application/json' },
  });
  Object.defineProperty(req, 'json', {
    value: () =>
      body === undefined
        ? Promise.reject(new SyntaxError('Unexpected end of JSON input'))
        : Promise.resolve(body),
  });
  return req;
}

async function bodyStartsWithPdf(res: Response): Promise<boolean> {
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/blank', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    engine.htmlRender.mockReturnValue(FAKE_PDF);
    engine.pageCount.mockReturnValue(1); // renderer yields a clean 1-page doc
    engine.save.mockReturnValue(FAKE_PDF);
    engine.close.mockReturnValue(undefined);
    engine.addPage.mockReturnValue(1);
    engine.mergePdfs.mockReturnValue(FAKE_PDF);
    engine.open.mockReturnValue({
      pageCount: engine.pageCount,
      addPage: engine.addPage,
      save: engine.save,
      close: engine.close,
    });
    engine.loadDefault.mockResolvedValue({
      htmlRender: engine.htmlRender,
      open: engine.open,
      mergePdfs: engine.mergePdfs,
    });
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await POST(makeRequest({ size: 'a4' }));
    expect(res.status).toBe(401);
    expect(engine.htmlRender).not.toHaveBeenCalled();
  });

  // ── Defaults + named sizes ──────────────────────────────────────────────────

  it('defaults to A4 portrait (595x842) for an empty/absent body', async () => {
    const res = await POST(makeRequest()); // .json() rejects → defaults
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('blank.pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(engine.htmlRender).toHaveBeenCalledWith(expect.any(String), [], 595, 842, 0);
  });

  it('defaults to A4 portrait for an empty JSON object', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(200);
    expect(engine.htmlRender).toHaveBeenCalledWith(expect.any(String), [], 595, 842, 0);
  });

  it('renders Letter portrait (612x792)', async () => {
    const res = await POST(makeRequest({ size: 'letter' }));
    expect(res.status).toBe(200);
    expect(engine.htmlRender).toHaveBeenCalledWith(expect.any(String), [], 612, 792, 0);
  });

  it('renders Legal portrait (612x1008)', async () => {
    const res = await POST(makeRequest({ size: 'legal' }));
    expect(res.status).toBe(200);
    expect(engine.htmlRender).toHaveBeenCalledWith(expect.any(String), [], 612, 1008, 0);
  });

  it('swaps dimensions for landscape orientation (A4 → 842x595)', async () => {
    const res = await POST(makeRequest({ size: 'a4', orientation: 'landscape' }));
    expect(res.status).toBe(200);
    expect(engine.htmlRender).toHaveBeenCalledWith(expect.any(String), [], 842, 595, 0);
  });

  it('swaps dimensions for Legal landscape (1008x612)', async () => {
    const res = await POST(makeRequest({ size: 'legal', orientation: 'landscape' }));
    expect(res.status).toBe(200);
    expect(engine.htmlRender).toHaveBeenCalledWith(expect.any(String), [], 1008, 612, 0);
  });

  // ── Explicit dimensions ─────────────────────────────────────────────────────

  it('honours explicit width/height in points (overrides size)', async () => {
    const res = await POST(makeRequest({ size: 'a4', width: 300, height: 400 }));
    expect(res.status).toBe(200);
    expect(engine.htmlRender).toHaveBeenCalledWith(expect.any(String), [], 300, 400, 0);
  });

  // ── Input guards (400) ──────────────────────────────────────────────────────

  it('returns 400 for an unknown size', async () => {
    const res = await POST(makeRequest({ size: 'a3' }));
    expect(res.status).toBe(400);
    expect(engine.htmlRender).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid orientation', async () => {
    const res = await POST(makeRequest({ orientation: 'diagonal' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when only width is provided (height missing)', async () => {
    const res = await POST(makeRequest({ width: 500 }));
    expect(res.status).toBe(400);
    expect(engine.htmlRender).not.toHaveBeenCalled();
  });

  it('returns 400 when dimensions are out of range', async () => {
    const res = await POST(makeRequest({ width: 10, height: 10 }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/points/i);
  });

  // ── Defensive 0-page fallback ───────────────────────────────────────────────

  it('adds a blank page when htmlRender yields a 0-page document', async () => {
    engine.pageCount.mockReturnValue(0); // renderer produced an empty skeleton
    const res = await POST(makeRequest({ size: 'a4' }));
    expect(res.status).toBe(200);
    expect(engine.addPage).toHaveBeenCalledWith(595, 842, 0);
    expect(engine.save).toHaveBeenCalled();
    expect(engine.close).toHaveBeenCalled();
    expect(await bodyStartsWithPdf(res)).toBe(true);
  });

  it('always returns a non-empty PDF body', async () => {
    const res = await POST(makeRequest({ size: 'a4' }));
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
