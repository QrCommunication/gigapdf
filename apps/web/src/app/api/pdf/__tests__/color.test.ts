/**
 * Tests for POST /api/pdf/color — bake prepress colours + gradients.
 *
 * Strategy (mirrors page-boxes.test.ts / pdfa.test.ts):
 *   - Mock @qrcommunication/gigapdf-lib so the WASM engine never loads in jsdom.
 *     The fake GigaPdfDoc records every prepress call and returns real `%PDF`
 *     bytes from save(), so the route contract — status, headers, body, which
 *     engine method runs per operation, and that doc.close() always fires — is
 *     exercised end to end. Color/GradientSpec/Box are TYPE-only imports in the
 *     route (erased at runtime), so the mock needs only GigaPdfEngine.
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
  addFilledRectangle: vi.fn(),
  addFilledPolygon: vi.fn(),
  addTextColor: vi.fn(),
  addGradient: vi.fn(),
  addOutputIntent: vi.fn(),
  setOverprint: vi.fn(),
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

import { POST } from '../color/route';
import { requireSession } from '@/lib/auth-helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PDF = new Uint8Array(
  Array.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n%%EOF', (c) => c.charCodeAt(0) & 0xff),
);

const ICC_BYTES = new Uint8Array([0x00, 0x00, 0x02, 0x0c, 0x49, 0x43, 0x43]); // arbitrary

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
  const req = new Request('http://localhost/api/pdf/color', {
    method: 'POST',
    body: 'dummy',
    headers: { 'Content-Type': 'text/plain' },
  });
  Object.defineProperty(req, 'formData', { value: () => Promise.resolve(fd) });
  return req;
}

/** A request with a valid PDF file + page=1 plus the given extra fields. */
function makeColorRequest(extra: { key: string; value: File | string }[]): Request {
  return makeRequest([
    { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
    { key: 'page', value: '1' },
    ...extra,
  ]);
}

async function bodyStartsWithPdf(res: Response): Promise<boolean> {
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/pdf/color', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(mockAuthOk);
    engine.addFilledRectangle.mockReturnValue(true);
    engine.addFilledPolygon.mockReturnValue(true);
    engine.addTextColor.mockReturnValue(true);
    engine.addGradient.mockReturnValue(true);
    engine.addOutputIntent.mockReturnValue(true);
    engine.setOverprint.mockReturnValue(true);
    engine.save.mockReturnValue(FAKE_PDF);
    engine.close.mockReturnValue(undefined);
    engine.open.mockReturnValue({
      addFilledRectangle: engine.addFilledRectangle,
      addFilledPolygon: engine.addFilledPolygon,
      addTextColor: engine.addTextColor,
      addGradient: engine.addGradient,
      addOutputIntent: engine.addOutputIntent,
      setOverprint: engine.setOverprint,
      save: engine.save,
      close: engine.close,
    });
    engine.loadDefault.mockResolvedValue({ open: engine.open });
  });

  // ── Auth + input guards ─────────────────────────────────────────────────────

  it('returns 401 when the session is invalid', async () => {
    vi.mocked(requireSession).mockResolvedValue(mockAuthFail);
    const res = await POST(makeColorRequest([{ key: 'operation', value: 'fill' }]));
    expect(res.status).toBe(401);
    expect(engine.open).not.toHaveBeenCalled();
  });

  it('returns 400 when no file is supplied', async () => {
    const res = await POST(makeRequest([{ key: 'operation', value: 'fill' }]));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the file is empty', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('empty.pdf', new Uint8Array(0)) },
        { key: 'page', value: '1' },
        { key: 'operation', value: 'fill' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/empty/i);
  });

  it('returns 400 for a non-positive / non-integer page', async () => {
    const res = await POST(
      makeRequest([
        { key: 'file', value: makeFile('doc.pdf', FAKE_PDF) },
        { key: 'page', value: '0' },
        { key: 'operation', value: 'fill' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/page must be/i);
  });

  it('returns 400 for an unknown operation', async () => {
    const res = await POST(makeColorRequest([{ key: 'operation', value: 'paint' }]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/operation must be one of/i);
  });

  // ── fill (addFilledRectangle) ───────────────────────────────────────────────

  it('fill (cmyk) → 200 application/pdf, addFilledRectangle(page, rect, color, opacity) + save', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'fill' },
        {
          key: 'payload',
          value: JSON.stringify({
            rect: { x: 40, y: 700, w: 200, h: 40 },
            color: { space: 'cmyk', c: 0.1, m: 0.8, y: 0.9, k: 0 },
            opacity: 0.5,
          }),
        },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('X-PDF-Color-Operation')).toBe('fill');
    expect(await bodyStartsWithPdf(res)).toBe(true);
    expect(engine.addFilledRectangle).toHaveBeenCalledWith(
      1,
      { x: 40, y: 700, w: 200, h: 40 },
      { space: 'cmyk', c: 0.1, m: 0.8, y: 0.9, k: 0 },
      0.5,
    );
    expect(engine.setOverprint).not.toHaveBeenCalled();
    expect(engine.save).toHaveBeenCalledTimes(1);
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  it('fill defaults opacity to 1 when omitted', async () => {
    await POST(
      makeColorRequest([
        { key: 'operation', value: 'fill' },
        {
          key: 'payload',
          value: JSON.stringify({
            rect: { x: 0, y: 0, w: 10, h: 10 },
            color: { space: 'rgb', rgb: 0xff0000 },
          }),
        },
      ]),
    );
    expect(engine.addFilledRectangle).toHaveBeenCalledWith(
      1,
      { x: 0, y: 0, w: 10, h: 10 },
      { space: 'rgb', rgb: 0xff0000 },
      1,
    );
  });

  it('fill with a spot Separation colour passes the tint + cmyk approximation through', async () => {
    await POST(
      makeColorRequest([
        { key: 'operation', value: 'fill' },
        {
          key: 'payload',
          value: JSON.stringify({
            rect: { x: 0, y: 0, w: 10, h: 10 },
            color: { space: 'separation', name: 'PANTONE 286 C', tint: 1, cmyk: [1, 0.66, 0, 0.02] },
          }),
        },
      ]),
    );
    expect(engine.addFilledRectangle).toHaveBeenCalledWith(
      1,
      expect.anything(),
      { space: 'separation', name: 'PANTONE 286 C', tint: 1, cmyk: [1, 0.66, 0, 0.02] },
      1,
    );
  });

  it('fill with an icc colour decodes profileBase64 into a Uint8Array profile', async () => {
    const profileBase64 = Buffer.from(ICC_BYTES).toString('base64');
    await POST(
      makeColorRequest([
        { key: 'operation', value: 'fill' },
        {
          key: 'payload',
          value: JSON.stringify({
            rect: { x: 0, y: 0, w: 10, h: 10 },
            color: { space: 'icc', components: [0.2, 0.4, 0.6], profileBase64 },
          }),
        },
      ]),
    );
    const call = engine.addFilledRectangle.mock.calls[0];
    const passedColor = call?.[2] as { space: string; components: number[]; profile: Uint8Array };
    expect(passedColor.space).toBe('icc');
    expect(passedColor.components).toEqual([0.2, 0.4, 0.6]);
    expect(passedColor.profile).toBeInstanceOf(Uint8Array);
    expect(Array.from(passedColor.profile)).toEqual(Array.from(ICC_BYTES));
  });

  it('fill applies setOverprint(page, fill, stroke, mode) BEFORE the paint', async () => {
    await POST(
      makeColorRequest([
        { key: 'operation', value: 'fill' },
        {
          key: 'payload',
          value: JSON.stringify({
            rect: { x: 0, y: 0, w: 10, h: 10 },
            color: { space: 'gray', gray: 0 },
          }),
        },
        { key: 'overprint', value: JSON.stringify({ fill: true, stroke: false, mode: 1 }) },
      ]),
    );
    expect(engine.setOverprint).toHaveBeenCalledWith(1, true, false, 1);
    const overprintOrder = engine.setOverprint.mock.invocationCallOrder[0]!;
    const fillOrder = engine.addFilledRectangle.mock.invocationCallOrder[0]!;
    expect(overprintOrder).toBeLessThan(fillOrder);
  });

  it('returns 400 for a degenerate fill rect (w <= 0)', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'fill' },
        {
          key: 'payload',
          value: JSON.stringify({
            rect: { x: 0, y: 0, w: 0, h: 10 },
            color: { space: 'rgb', rgb: 0 },
          }),
        },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/rect must be/i);
    expect(engine.addFilledRectangle).not.toHaveBeenCalled();
  });

  it('returns 400 for an out-of-range cmyk component', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'fill' },
        {
          key: 'payload',
          value: JSON.stringify({
            rect: { x: 0, y: 0, w: 10, h: 10 },
            color: { space: 'cmyk', c: 1.5, m: 0, y: 0, k: 0 },
          }),
        },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/color must be a valid Color/i);
  });

  it('returns 422 when the engine rejects the fill (page out of range)', async () => {
    engine.addFilledRectangle.mockReturnValue(false);
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'fill' },
        {
          key: 'payload',
          value: JSON.stringify({
            rect: { x: 0, y: 0, w: 10, h: 10 },
            color: { space: 'rgb', rgb: 0 },
          }),
        },
      ]),
    );
    expect(res.status).toBe(422);
    expect(engine.save).not.toHaveBeenCalled();
    expect(engine.close).toHaveBeenCalledTimes(1);
  });

  // ── gradient (addGradient) ──────────────────────────────────────────────────

  it('gradient (linear) → 200, addGradient(page, spec); never calls setOverprint', async () => {
    const spec = {
      kind: 'linear',
      coords: [50, 50, 250, 50],
      stops: [
        { offset: 0, rgb: 0xff0000 },
        { offset: 1, rgb: 0x0000ff },
      ],
      rect: { x: 50, y: 40, w: 200, h: 60 },
    };
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'gradient' },
        { key: 'payload', value: JSON.stringify(spec) },
        { key: 'overprint', value: JSON.stringify({ fill: true, stroke: true }) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-PDF-Color-Operation')).toBe('gradient');
    expect(engine.addGradient).toHaveBeenCalledWith(1, spec);
    expect(engine.setOverprint).not.toHaveBeenCalled();
  });

  it('gradient (radial) accepts 6-element coords + extend/opacity', async () => {
    const spec = {
      kind: 'radial',
      coords: [150, 150, 0, 150, 150, 120],
      stops: [
        { offset: 0, rgb: 0xffffff },
        { offset: 0.5, rgb: 0x808080 },
        { offset: 1, rgb: 0x000000 },
      ],
      rect: { x: 30, y: 30, w: 240, h: 240 },
      extend: [true, true],
      opacity: 0.8,
    };
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'gradient' },
        { key: 'payload', value: JSON.stringify(spec) },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.addGradient).toHaveBeenCalledWith(1, spec);
  });

  it('returns 400 for a gradient with fewer than two stops', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'gradient' },
        {
          key: 'payload',
          value: JSON.stringify({
            kind: 'linear',
            coords: [0, 0, 100, 0],
            stops: [{ offset: 0, rgb: 0xff0000 }],
            rect: { x: 0, y: 0, w: 100, h: 20 },
          }),
        },
      ]),
    );
    expect(res.status).toBe(400);
    expect(engine.addGradient).not.toHaveBeenCalled();
  });

  it('returns 400 for a linear gradient whose coords are not length 4', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'gradient' },
        {
          key: 'payload',
          value: JSON.stringify({
            kind: 'linear',
            coords: [0, 0, 100, 0, 200, 0],
            stops: [
              { offset: 0, rgb: 0 },
              { offset: 1, rgb: 0xffffff },
            ],
            rect: { x: 0, y: 0, w: 100, h: 20 },
          }),
        },
      ]),
    );
    expect(res.status).toBe(400);
    expect(engine.addGradient).not.toHaveBeenCalled();
  });

  // ── polygon (addFilledPolygon) ──────────────────────────────────────────────

  it('polygon → 200, addFilledPolygon(page, points, color, opacity)', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'polygon' },
        {
          key: 'payload',
          value: JSON.stringify({
            points: [0, 0, 100, 0, 50, 100],
            color: { space: 'cmyk', c: 0, m: 0, y: 1, k: 0 },
          }),
        },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.addFilledPolygon).toHaveBeenCalledWith(
      1,
      [0, 0, 100, 0, 50, 100],
      { space: 'cmyk', c: 0, m: 0, y: 1, k: 0 },
      1,
    );
  });

  it('returns 400 for polygon points with fewer than 3 vertices', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'polygon' },
        {
          key: 'payload',
          value: JSON.stringify({ points: [0, 0, 100, 0], color: { space: 'rgb', rgb: 0 } }),
        },
      ]),
    );
    expect(res.status).toBe(400);
    expect(engine.addFilledPolygon).not.toHaveBeenCalled();
  });

  // ── text (addTextColor) ─────────────────────────────────────────────────────

  it('text → 200, addTextColor(page, x, y, size, text, font, color, opts)', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'text' },
        {
          key: 'payload',
          value: JSON.stringify({
            x: 72,
            y: 700,
            size: 18,
            text: 'CONFIDENTIEL',
            font: 'Helvetica',
            color: { space: 'separation', name: 'Red', tint: 1, cmyk: [0, 1, 1, 0] },
            opacity: 0.9,
            rotation: 45,
            underline: true,
          }),
        },
      ]),
    );
    expect(res.status).toBe(200);
    expect(engine.addTextColor).toHaveBeenCalledWith(
      1,
      72,
      700,
      18,
      'CONFIDENTIEL',
      'Helvetica',
      { space: 'separation', name: 'Red', tint: 1, cmyk: [0, 1, 1, 0] },
      { opacity: 0.9, rotation: 45, underline: true },
    );
  });

  it('returns 400 for text missing a base-14 font', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'text' },
        {
          key: 'payload',
          value: JSON.stringify({
            x: 0,
            y: 0,
            size: 12,
            text: 'hi',
            font: '',
            color: { space: 'rgb', rgb: 0 },
          }),
        },
      ]),
    );
    expect(res.status).toBe(400);
    expect(engine.addTextColor).not.toHaveBeenCalled();
  });

  // ── output-intent (addOutputIntent) ─────────────────────────────────────────

  it('output-intent → 200, addOutputIntent(profile, condition)', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'output-intent' },
        { key: 'iccProfile', value: makeFile('FOGRA39.icc', ICC_BYTES, 'application/octet-stream') },
        { key: 'condition', value: 'Coated FOGRA39' },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-PDF-Color-Operation')).toBe('output-intent');
    const call = engine.addOutputIntent.mock.calls[0];
    expect(call?.[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(call?.[0] as Uint8Array)).toEqual(Array.from(ICC_BYTES));
    expect(call?.[1]).toBe('Coated FOGRA39');
    expect(engine.setOverprint).not.toHaveBeenCalled();
  });

  it('returns 400 for output-intent without an iccProfile file', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'output-intent' },
        { key: 'condition', value: 'Coated FOGRA39' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/iccProfile/i);
    expect(engine.addOutputIntent).not.toHaveBeenCalled();
  });

  it('returns 400 for output-intent without a condition', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'output-intent' },
        { key: 'iccProfile', value: makeFile('FOGRA39.icc', ICC_BYTES, 'application/octet-stream') },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/condition/i);
  });

  // ── payload + engine error surfaces ─────────────────────────────────────────

  it('returns 400 for a malformed payload JSON', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'fill' },
        { key: 'payload', value: '{ not json' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/valid JSON/i);
  });

  it('returns 400 for a malformed overprint JSON', async () => {
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'fill' },
        {
          key: 'payload',
          value: JSON.stringify({
            rect: { x: 0, y: 0, w: 10, h: 10 },
            color: { space: 'rgb', rgb: 0 },
          }),
        },
        { key: 'overprint', value: '{ bad' },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/overprint must be/i);
  });

  it('returns 422 when the engine cannot open the PDF', async () => {
    engine.open.mockImplementation(() => {
      throw new Error('invalid xref table');
    });
    const res = await POST(
      makeColorRequest([
        { key: 'operation', value: 'fill' },
        {
          key: 'payload',
          value: JSON.stringify({
            rect: { x: 0, y: 0, w: 10, h: 10 },
            color: { space: 'rgb', rgb: 0 },
          }),
        },
      ]),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/failed to apply/i);
  });
});
