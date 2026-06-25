/**
 * Tests for POST /api/pdf/presentation — page transitions, content scaling,
 * portfolio (/Collection) config, and figure alt-text (a11y).
 *
 * Strategy (mirrors pdfa.test.ts):
 *   - Mock @qrcommunication/gigapdf-lib so the WASM engine never loads in jsdom.
 *     The fake GigaPdfDoc returns real `%PDF` bytes, so the route contract —
 *     status, headers, body magic, and which engine method each action calls —
 *     is exercised end to end.
 *   - Use the REAL validatePdfFile / sanitizeContentDisposition (server-only is
 *     stubbed so they import in jsdom).
 *   - Mock @/lib/auth-helpers to control auth, and the logger to stay quiet.
 *   - Drive POST directly with a fake Request whose formData() resolves sync.
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

// ── Hoisted engine mocks (referenced by the vi.mock factory AND the tests) ────
const engine = vi.hoisted(() => ({
  pageCount: vi.fn(),
  setPageTransition: vi.fn(),
  clearPageTransition: vi.fn(),
  scalePageContent: vi.fn(),
  scalePageContentXY: vi.fn(),
  scalePageTo: vi.fn(),
  setUserUnit: vi.fn(),
  setCollection: vi.fn(),
  figureCount: vi.fn(),
  setFigureAlt: vi.fn(),
  saveCompressed: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
  loadDefault: vi.fn(),
}));

vi.mock('@qrcommunication/gigapdf-lib', () => ({
  GigaPdfEngine: { loadDefault: engine.loadDefault },
  // The route imports the const array for server-side style validation.
  PAGE_TRANSITION_STYLES: [
    'split',
    'blinds',
    'box',
    'wipe',
    'dissolve',
    'glitter',
    'fly',
    'push',
    'cover',
    'uncover',
    'fade',
    'replace',
  ],
}));

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: vi.fn(),
}));

vi.mock('@/lib/server-logger', () => ({
  serverLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// 'server-only' guard — pulled in by request-validation + content-disposition.
vi.mock('server-only', () => ({}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '../presentation/route';
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

function makeFile(name: string, content: Uint8Array, type = 'application/pdf'): File {
  const plain = new Uint8Array(new ArrayBuffer(content.byteLength));
  plain.set(content);
  return new File([plain], name, { type });
}

function makeRequest(fields: { key: string; value: File | string }[]): Request {
  const fd = new FormData();
  for (const { key, value } of fields) fd.append(key, value);
  const req = new Request('http://localhost/api/pdf/presentation', {
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    engine.pageCount.mockReturnValue(3);
    engine.setPageTransition.mockReturnValue(true);
    engine.clearPageTransition.mockReturnValue(true);
    engine.scalePageContent.mockReturnValue(true);
    engine.scalePageContentXY.mockReturnValue(true);
    engine.scalePageTo.mockReturnValue(1);
    engine.setUserUnit.mockReturnValue(true);
    engine.setCollection.mockReturnValue(true);
    engine.figureCount.mockReturnValue(0);
    engine.setFigureAlt.mockReturnValue(true);
    engine.saveCompressed.mockReturnValue(FAKE_PDF);
    engine.close.mockReturnValue(undefined);
    engine.open.mockReturnValue({
      pageCount: engine.pageCount,
      setPageTransition: engine.setPageTransition,
      clearPageTransition: engine.clearPageTransition,
      scalePageContent: engine.scalePageContent,
      scalePageContentXY: engine.scalePageContentXY,
      scalePageTo: engine.scalePageTo,
      setUserUnit: engine.setUserUnit,
      setCollection: engine.setCollection,
      figureCount: engine.figureCount,
      setFigureAlt: engine.setFigureAlt,
      saveCompressed: engine.saveCompressed,
      close: engine.close,
    });
    engine.loadDefault.mockResolvedValue({ open: engine.open });
  });

  // ── Auth & input guards ─────────────────────────────────────────────────────

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('a.pdf', FAKE_PDF) },
        { key: 'action', value: 'transition' },
      ]),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when no file is supplied', async () => {
    const res = await POST(makeRequest([{ key: 'action', value: 'scale' }]));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the file is empty', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('empty.pdf', new Uint8Array(0)) },
        { key: 'action', value: 'scale' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/empty/i);
  });

  it('returns 400 for an unknown action', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'flip' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/action must be one of/i);
  });

  // ── Transitions ─────────────────────────────────────────────────────────────

  it('transition set → 200, %PDF body, setPageTransition on every page, saveCompressed', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'transition' },
        { key: 'style', value: 'wipe' },
        { key: 'duration', value: '0.5' },
        { key: 'displayDuration', value: '5' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('X-Presentation-Action')).toBe('transition');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    // pageCount = 3 → set on pages 1, 2, 3 with only the supplied keys.
    expect(engine.setPageTransition).toHaveBeenCalledTimes(3);
    expect(engine.setPageTransition).toHaveBeenNthCalledWith(1, 1, {
      style: 'wipe',
      duration: 0.5,
      displayDuration: 5,
    });
    expect(engine.clearPageTransition).not.toHaveBeenCalled();
    expect(engine.saveCompressed).toHaveBeenCalledTimes(1);
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('transition clear → clearPageTransition on every page, no setPageTransition', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'transition' },
        { key: 'op', value: 'clear' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.clearPageTransition).toHaveBeenCalledTimes(3);
    expect(engine.setPageTransition).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid transition style', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'transition' },
        { key: 'style', value: 'swoosh' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/style must be one of/i);
  });

  it('honours an explicit pages list (only the listed pages)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'transition' },
        { key: 'style', value: 'fade' },
        { key: 'pages', value: JSON.stringify([2]) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.setPageTransition).toHaveBeenCalledTimes(1);
    expect(engine.setPageTransition).toHaveBeenCalledWith(2, { style: 'fade' });
  });

  it('returns 400 when pages is out of range', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'transition' },
        { key: 'style', value: 'fade' },
        { key: 'pages', value: JSON.stringify([9]) },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/pages must be a JSON array/i);
  });

  // ── Scale ───────────────────────────────────────────────────────────────────

  it('scale uniform → scalePageContent(page, factor) on every page', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'scale' },
        { key: 'mode', value: 'uniform' },
        { key: 'factor', value: '1.5' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.scalePageContent).toHaveBeenCalledTimes(3);
    expect(engine.scalePageContent).toHaveBeenNthCalledWith(1, 1, 1.5);
  });

  it('scale xy → scalePageContentXY(page, sx, sy)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'scale' },
        { key: 'mode', value: 'xy' },
        { key: 'sx', value: '2' },
        { key: 'sy', value: '0.5' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.scalePageContentXY).toHaveBeenCalledWith(1, 2, 0.5);
  });

  it('scale fit → scalePageTo(page, width, height)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'scale' },
        { key: 'mode', value: 'fit' },
        { key: 'width', value: '595' },
        { key: 'height', value: '842' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.scalePageTo).toHaveBeenCalledWith(1, 595, 842);
  });

  it('scale userUnit → setUserUnit(page, unit)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'scale' },
        { key: 'mode', value: 'userUnit' },
        { key: 'unit', value: '2' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.setUserUnit).toHaveBeenCalledWith(1, 2);
  });

  it('returns 400 for a non-positive scale factor', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'scale' },
        { key: 'mode', value: 'uniform' },
        { key: 'factor', value: '0' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/factor must be a positive number/i);
  });

  it('returns 400 for an unknown scale mode', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'scale' },
        { key: 'mode', value: 'warp' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/mode must be one of/i);
  });

  // ── Portfolio (collection) ──────────────────────────────────────────────────

  it('collection → setCollection with the parsed config', async () => {
    const config = { view: 'tile', schema: [{ key: 'dept', name: 'Department' }] };
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'collection' },
        { key: 'config', value: JSON.stringify(config) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.setCollection).toHaveBeenCalledWith({
      view: 'tile',
      schema: [{ key: 'dept', name: 'Department' }],
    });
  });

  it('returns 400 for an invalid collection view', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'collection' },
        { key: 'config', value: JSON.stringify({ view: 'carousel' }) },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/config\.view must be one of/i);
  });

  it('returns 400 when collection config is missing', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'collection' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(engine.setCollection).not.toHaveBeenCalled();
  });

  // ── Figure alt-text (a11y) ──────────────────────────────────────────────────

  it('figureAlt → setFigureAlt bounded by figureCount(), skipping blanks', async () => {
    engine.figureCount.mockReturnValue(2);
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'figureAlt' },
        { key: 'figureAlts', value: JSON.stringify(['Alpha', '', 'Gamma']) },
      ]),
    );
    expect(res.status).toBe(200);
    // figureCount = 2 → only indices 0 and 1 are eligible; index 1 is blank → skipped.
    expect(engine.setFigureAlt).toHaveBeenCalledTimes(1);
    expect(engine.setFigureAlt).toHaveBeenCalledWith(0, 'Alpha');
  });

  it('returns 400 when figureAlts is not a JSON array', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'figureAlt' },
        { key: 'figureAlts', value: '{"not":"an array"}' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/figureAlts must be a JSON array/i);
  });

  // ── Engine failure + download naming ────────────────────────────────────────

  it('returns 422 when the engine cannot process the PDF', async () => {
    engine.open.mockImplementation(() => {
      throw new Error('invalid xref table');
    });
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'action', value: 'scale' },
        { key: 'factor', value: '1.2' },
      ]),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/failed/i);
  });

  it('names the download <base>.presentation.pdf', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('report.pdf', FAKE_PDF) },
        { key: 'action', value: 'figureAlt' },
        { key: 'figureAlts', value: JSON.stringify([]) },
      ]),
    );
    expect(res.headers.get('Content-Disposition')).toContain('report.presentation.pdf');
  });
});
