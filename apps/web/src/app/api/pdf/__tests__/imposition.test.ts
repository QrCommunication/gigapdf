/**
 * Tests for POST /api/pdf/imposition — N-up / placePage / document-JavaScript /
 * optional-content (layers) over the WASM engine.
 *
 * Strategy (mirrors page-boxes.test.ts):
 *   - Mock @qrcommunication/gigapdf-lib so the WASM engine never loads in jsdom.
 *     The fake GigaPdfDoc exposes every method the route may call and returns
 *     real `%PDF` bytes from save(), so the route contract — status, headers,
 *     body, which engine method runs per action, and validation — is exercised
 *     end to end.
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
  nUp: vi.fn(),
  placePage: vi.fn(),
  documentJavascripts: vi.fn(),
  addDocumentJavascript: vi.fn(),
  removeDocumentJavascript: vi.fn(),
  layers: vi.fn(),
  addLayer: vi.fn(),
  beginOptionalContent: vi.fn(),
  endOptionalContent: vi.fn(),
  save: vi.fn(),
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

// 'server-only' guard — pulled in by request-validation + content-disposition.
vi.mock('server-only', () => ({}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '../imposition/route';
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
  const req = new Request('http://localhost/api/pdf/imposition', {
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

const file = () => makeFile('doc.pdf', FAKE_PDF);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/imposition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    engine.nUp.mockReturnValue(2);
    engine.placePage.mockReturnValue(true);
    engine.documentJavascripts.mockReturnValue([{ name: 'AFInit', script: 'app.alert(1)' }]);
    engine.addDocumentJavascript.mockReturnValue(true);
    engine.removeDocumentJavascript.mockReturnValue(true);
    engine.layers.mockReturnValue([{ id: 3, name: 'Annotations', visible: true, locked: false, order: 0 }]);
    engine.addLayer.mockReturnValue(7);
    engine.beginOptionalContent.mockReturnValue('OC0');
    engine.endOptionalContent.mockReturnValue(true);
    engine.save.mockReturnValue(FAKE_PDF);
    engine.close.mockReturnValue(undefined);
    engine.open.mockReturnValue({
      nUp: engine.nUp,
      placePage: engine.placePage,
      documentJavascripts: engine.documentJavascripts,
      addDocumentJavascript: engine.addDocumentJavascript,
      removeDocumentJavascript: engine.removeDocumentJavascript,
      layers: engine.layers,
      addLayer: engine.addLayer,
      beginOptionalContent: engine.beginOptionalContent,
      endOptionalContent: engine.endOptionalContent,
      save: engine.save,
      close: engine.close,
    });
    engine.loadDefault.mockResolvedValue({ open: engine.open });
  });

  // ── Auth & top-level validation ──────────────────────────────────────────────

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await POST(makeRequest([{ key: 'file', value: file() }, { key: 'action', value: 'jsList' }]));
    expect(res.status).toBe(401);
    expect(engine.open).not.toHaveBeenCalled();
  });

  it('returns 400 for an unknown action', async () => {
    const res = await POST(makeRequest([{ key: 'file', value: file() }, { key: 'action', value: 'frobnicate' }]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/action must be one of/i);
  });

  it('returns 400 when no file is supplied', async () => {
    const res = await POST(makeRequest([{ key: 'action', value: 'jsList' }]));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the file is empty', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('empty.pdf', new Uint8Array(0)) },
        { key: 'action', value: 'jsList' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/empty/i);
  });

  // ── Read-only JSON actions ───────────────────────────────────────────────────

  it('jsList → 200 JSON with the scripts', async () => {
    const res = await POST(makeRequest([{ key: 'file', value: file() }, { key: 'action', value: 'jsList' }]));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = (await res.json()) as { success: boolean; scripts: { name: string; script: string }[] };
    expect(body.success).toBe(true);
    expect(body.scripts).toEqual([{ name: 'AFInit', script: 'app.alert(1)' }]);
    expect(engine.documentJavascripts).toHaveBeenCalledTimes(1);
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('ocgLayers → 200 JSON with the layers', async () => {
    const res = await POST(makeRequest([{ key: 'file', value: file() }, { key: 'action', value: 'ocgLayers' }]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; layers: unknown[] };
    expect(body.success).toBe(true);
    expect(body.layers).toEqual([{ id: 3, name: 'Annotations', visible: true, locked: false, order: 0 }]);
    expect(engine.layers).toHaveBeenCalledTimes(1);
  });

  // ── N-up ─────────────────────────────────────────────────────────────────────

  it('nup → 200 application/pdf, nUp(cols, rows, opts) + save() + sheets header', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'nup' },
        { key: 'cols', value: '2' },
        { key: 'rows', value: '2' },
        { key: 'sheetWidth', value: '595.276' },
        { key: 'sheetHeight', value: '841.89' },
        { key: 'margin', value: '10' },
        { key: 'gutter', value: '8' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(engine.nUp).toHaveBeenCalledWith(2, 2, {
      sheetWidth: 595.276,
      sheetHeight: 841.89,
      margin: 10,
      gutter: 8,
    });
    expect(res.headers.get('X-Imposition-Action')).toBe('nup');
    expect(res.headers.get('X-Imposition-Sheets')).toBe('2');
    expect(engine.save).toHaveBeenCalledTimes(1);
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('nup returns 400 when cols/rows are missing', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'nup' },
        { key: 'cols', value: '2' },
        // rows omitted
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/cols and rows/i);
    expect(engine.nUp).not.toHaveBeenCalled();
  });

  it('nup returns 400 for a non-positive sheetWidth', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'nup' },
        { key: 'cols', value: '2' },
        { key: 'rows', value: '1' },
        { key: 'sheetWidth', value: '0' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/sheetWidth/i);
  });

  it('nup returns 422 when the engine reports an error (negative)', async () => {
    engine.nUp.mockReturnValue(-1);
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'nup' },
        { key: 'cols', value: '2' },
        { key: 'rows', value: '2' },
      ]),
    );
    expect(res.status).toBe(422);
    expect(engine.save).not.toHaveBeenCalled();
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  // ── placePage ────────────────────────────────────────────────────────────────

  it('placePage → 200 application/pdf, placePage(target, source, x, y, sx, sy)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'placePage' },
        { key: 'target', value: '1' },
        { key: 'source', value: '2' },
        { key: 'x', value: '10' },
        { key: 'y', value: '20' },
        { key: 'scaleX', value: '0.5' },
        { key: 'scaleY', value: '0.5' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(engine.placePage).toHaveBeenCalledWith(1, 2, 10, 20, 0.5, 0.5);
    expect(engine.save).toHaveBeenCalledTimes(1);
  });

  it('placePage returns 400 when a coordinate is missing', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'placePage' },
        { key: 'target', value: '1' },
        { key: 'source', value: '2' },
        { key: 'x', value: '10' },
        // y / scaleX / scaleY omitted
      ]),
    );
    expect(res.status).toBe(400);
    expect(engine.placePage).not.toHaveBeenCalled();
  });

  it('placePage returns 400 for a non-positive scale', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'placePage' },
        { key: 'target', value: '1' },
        { key: 'source', value: '1' },
        { key: 'x', value: '0' },
        { key: 'y', value: '0' },
        { key: 'scaleX', value: '0' },
        { key: 'scaleY', value: '1' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/scaleX and scaleY/i);
  });

  it('placePage returns 422 when the engine rejects', async () => {
    engine.placePage.mockReturnValue(false);
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'placePage' },
        { key: 'target', value: '9' },
        { key: 'source', value: '9' },
        { key: 'x', value: '0' },
        { key: 'y', value: '0' },
        { key: 'scaleX', value: '1' },
        { key: 'scaleY', value: '1' },
      ]),
    );
    expect(res.status).toBe(422);
    expect(engine.save).not.toHaveBeenCalled();
  });

  // ── Document JavaScript ──────────────────────────────────────────────────────

  it('jsAdd → 200 application/pdf, addDocumentJavascript(name, script)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'jsAdd' },
        { key: 'name', value: 'AFInit' },
        { key: 'script', value: 'app.alert(1)' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(engine.addDocumentJavascript).toHaveBeenCalledWith('AFInit', 'app.alert(1)');
    expect(res.headers.get('X-Imposition-Action')).toBe('jsAdd');
  });

  it('jsAdd returns 400 when the name is empty', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'jsAdd' },
        { key: 'name', value: '  ' },
        { key: 'script', value: 'x' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(engine.addDocumentJavascript).not.toHaveBeenCalled();
  });

  it('jsAdd returns 422 when the engine refuses', async () => {
    engine.addDocumentJavascript.mockReturnValue(false);
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'jsAdd' },
        { key: 'name', value: 'AFInit' },
        { key: 'script', value: 'x' },
      ]),
    );
    expect(res.status).toBe(422);
  });

  it('jsRemove → 200 application/pdf, removeDocumentJavascript(name)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'jsRemove' },
        { key: 'name', value: 'AFInit' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.removeDocumentJavascript).toHaveBeenCalledWith('AFInit');
  });

  it('jsRemove returns 404 when no script had that name', async () => {
    engine.removeDocumentJavascript.mockReturnValue(false);
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'jsRemove' },
        { key: 'name', value: 'Ghost' },
      ]),
    );
    expect(res.status).toBe(404);
    expect(engine.save).not.toHaveBeenCalled();
  });

  // ── Optional content (layers) ────────────────────────────────────────────────

  it('ocgBegin with layerName → addLayer + beginOptionalContent + OCG headers', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'ocgBegin' },
        { key: 'page', value: '1' },
        { key: 'layerName', value: 'Annotations' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(engine.addLayer).toHaveBeenCalledWith('Annotations');
    expect(engine.beginOptionalContent).toHaveBeenCalledWith(1, 7); // addLayer returned 7
    expect(res.headers.get('X-OCG-Id')).toBe('7');
    expect(res.headers.get('X-OCG-Property')).toBe('OC0');
  });

  it('ocgBegin with an existing ocg id does not create a layer', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'ocgBegin' },
        { key: 'page', value: '2' },
        { key: 'ocg', value: '3' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.addLayer).not.toHaveBeenCalled();
    expect(engine.beginOptionalContent).toHaveBeenCalledWith(2, 3);
    expect(res.headers.get('X-OCG-Id')).toBe('3');
  });

  it('ocgBegin returns 400 when page is missing', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'ocgBegin' },
        { key: 'layerName', value: 'X' },
      ]),
    );
    expect(res.status).toBe(400);
    expect(engine.beginOptionalContent).not.toHaveBeenCalled();
  });

  it('ocgBegin returns 400 when neither ocg nor layerName is given', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'ocgBegin' },
        { key: 'page', value: '1' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/ocg id or a layerName/i);
  });

  it('ocgBegin returns 422 when beginOptionalContent fails (empty property)', async () => {
    engine.beginOptionalContent.mockReturnValue('');
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'ocgBegin' },
        { key: 'page', value: '1' },
        { key: 'ocg', value: '3' },
      ]),
    );
    expect(res.status).toBe(422);
    expect(engine.save).not.toHaveBeenCalled();
  });

  it('ocgEnd → 200 application/pdf, endOptionalContent(page)', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'ocgEnd' },
        { key: 'page', value: '4' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.endOptionalContent).toHaveBeenCalledWith(4);
  });

  it('ocgEnd returns 422 when there is no open sequence', async () => {
    engine.endOptionalContent.mockReturnValue(false);
    const res = await POST(
      makeRequest([
        { key: 'file', value: file() },
        { key: 'action', value: 'ocgEnd' },
        { key: 'page', value: '1' },
      ]),
    );
    expect(res.status).toBe(422);
  });

  // ── Engine failure ───────────────────────────────────────────────────────────

  it('returns 422 when the engine cannot open the PDF', async () => {
    engine.open.mockImplementation(() => {
      throw new Error('invalid xref table');
    });
    const res = await POST(makeRequest([{ key: 'file', value: file() }, { key: 'action', value: 'jsList' }]));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/operation failed/i);
  });
});
