/**
 * Prepress colour + gradient bake route via the WASM engine.
 *
 * POST /api/pdf/color
 *
 * Bakes a press-ready fill, a gradient, coloured text, or a document output
 * intent onto a PDF — the writable counterpart of the editor's colour/gradient
 * properties sections. Covers the full prepress colour surface of `GigaPdfDoc`:
 * any authored colour space (RGB / CMYK / spot `Separation` / gray / ICC),
 * axial + radial gradients, overprint (trapping), and an embedded ICC output
 * intent.
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   page       — 1-based page number (required for every op except output-intent;
 *                read anyway, must be a positive integer)
 *   operation  — one of:
 *                  "fill"          addFilledRectangle(page, rect, color, opacity)
 *                  "polygon"       addFilledPolygon(page, points, color, opacity)
 *                  "text"          addTextColor(page, x, y, size, text, font, color, opts)
 *                  "gradient"      addGradient(page, spec)
 *                  "output-intent" addOutputIntent(profile, condition)
 *   payload    — JSON describing the operation (required for fill/polygon/text/
 *                gradient). Shapes:
 *                  fill     { rect: { x, y, w, h }, color: Color, opacity?: 0..1 }
 *                  polygon  { points: number[≥6, even], color: Color, opacity?: 0..1 }
 *                  text     { x, y, size, text, font, color: Color,
 *                             opacity?, rotation?, underline?, strikethrough? }
 *                  gradient GradientSpec { kind, coords, stops, rect, extend?, opacity? }
 *   overprint  — optional JSON { fill: boolean, stroke: boolean, mode?: number }
 *                applied via setOverprint() BEFORE a fill/polygon/text paint
 *                (prepress black-overprint / trapping). Ignored for gradient.
 *   iccProfile — ICC profile file (required for output-intent)
 *   condition  — output-condition identifier (required for output-intent,
 *                e.g. "Coated FOGRA39")
 *
 * The `Color` union (ISO 32000-1 §8.6) is JSON-encoded as:
 *   { space: "rgb",        rgb: 0xRRGGBB }
 *   { space: "cmyk",       c, m, y, k }              // 0..1 each
 *   { space: "gray",       gray }                    // 0..1
 *   { space: "separation", name, tint, cmyk: [c,m,y,k] }
 *   { space: "icc",        components: number[], profileBase64: string }
 *
 * Returns the modified PDF as application/pdf, or 400 on bad input / 422 when the
 * engine rejects the paint (page out of range, degenerate geometry, bad ICC).
 *
 * The engine is called directly here (rather than via @giga-pdf/pdf-engine)
 * because the prepress-colour + gradient surface is exposed by GigaPdfDoc;
 * @qrcommunication/gigapdf-lib is a server-external package whose `gigapdf.wasm`
 * is traced for `/api/pdf/**` (see next.config.ts).
 */

import { NextResponse } from 'next/server';
import {
  GigaPdfEngine,
  type GigaPdfDoc,
  type Box,
  type Color,
  type GradientSpec,
  type GradientStop,
} from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

type ColorOperation = 'fill' | 'polygon' | 'text' | 'gradient' | 'output-intent';

const VALID_OPERATIONS: readonly ColorOperation[] = [
  'fill',
  'polygon',
  'text',
  'gradient',
  'output-intent',
];

/**
 * The Rust→WASM engine, instantiated once and shared across requests. Mirrors
 * the singleton in @giga-pdf/pdf-engine — `loadDefault()` reads the self-
 * contained `gigapdf.wasm` from disk (no third-party PDF libraries).
 */
let enginePromise: Promise<GigaPdfEngine> | null = null;
function getEngine(): Promise<GigaPdfEngine> {
  enginePromise ??= GigaPdfEngine.loadDefault();
  return enginePromise;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** A normalised component in `[0, 1]` (CMYK / gray / tint / offset / opacity). */
function isUnit(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && v <= 1;
}

/** A packed `0xRRGGBB` integer. */
function isRgb(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff;
}

/** Decode a base64 string to bytes; `null` on an empty/invalid value. */
function decodeBase64(b64: string): Uint8Array | null {
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.byteLength > 0 ? new Uint8Array(buf) : null;
  } catch {
    return null;
  }
}

/** Validate + normalise a JSON-encoded {@link Color}; `null` if malformed. */
function parseColor(raw: unknown): Color | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  switch (c.space) {
    case 'rgb':
      return isRgb(c.rgb) ? { space: 'rgb', rgb: c.rgb } : null;
    case 'cmyk':
      return isUnit(c.c) && isUnit(c.m) && isUnit(c.y) && isUnit(c.k)
        ? { space: 'cmyk', c: c.c, m: c.m, y: c.y, k: c.k }
        : null;
    case 'gray':
      return isUnit(c.gray) ? { space: 'gray', gray: c.gray } : null;
    case 'separation': {
      const { name, tint, cmyk } = c;
      if (typeof name !== 'string' || name.trim() === '' || !isUnit(tint)) return null;
      if (!Array.isArray(cmyk) || cmyk.length !== 4 || !cmyk.every(isUnit)) return null;
      return {
        space: 'separation',
        name,
        tint,
        cmyk: [cmyk[0], cmyk[1], cmyk[2], cmyk[3]] as [number, number, number, number],
      };
    }
    case 'icc': {
      const { components, profileBase64 } = c;
      if (!Array.isArray(components) || components.length === 0 || !components.every(isFiniteNumber)) {
        return null;
      }
      if (typeof profileBase64 !== 'string') return null;
      const profile = decodeBase64(profileBase64);
      if (!profile) return null;
      return { space: 'icc', components: components.map(Number), profile };
    }
    default:
      return null;
  }
}

/** Validate a `{ x, y, w, h }` rect with positive area; `null` if invalid. */
function parseBox(raw: unknown): Box | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (!isFiniteNumber(b.x) || !isFiniteNumber(b.y) || !isFiniteNumber(b.w) || !isFiniteNumber(b.h)) {
    return null;
  }
  if (b.w <= 0 || b.h <= 0) return null;
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

/** Validate a JSON-encoded {@link GradientSpec}; `null` if malformed. */
function parseGradient(raw: unknown): GradientSpec | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;
  const kind: 'linear' | 'radial' | null =
    g.kind === 'linear' ? 'linear' : g.kind === 'radial' ? 'radial' : null;
  if (kind === null) return null;

  const need = kind === 'linear' ? 4 : 6;
  const { coords } = g;
  if (!Array.isArray(coords) || coords.length !== need || !coords.every(isFiniteNumber)) return null;

  const { stops } = g;
  if (!Array.isArray(stops) || stops.length < 2) return null;
  const parsedStops: GradientStop[] = [];
  for (const s of stops) {
    if (typeof s !== 'object' || s === null) return null;
    const so = s as Record<string, unknown>;
    if (!isUnit(so.offset) || !isRgb(so.rgb)) return null;
    parsedStops.push({ offset: so.offset, rgb: so.rgb });
  }

  const rect = parseBox(g.rect);
  if (!rect) return null;

  const spec: GradientSpec = {
    kind,
    coords: coords.map(Number),
    stops: parsedStops,
    rect,
  };
  const ext = g.extend;
  if (
    Array.isArray(ext) &&
    ext.length === 2 &&
    typeof ext[0] === 'boolean' &&
    typeof ext[1] === 'boolean'
  ) {
    spec.extend = [ext[0], ext[1]];
  }
  if (isUnit(g.opacity)) spec.opacity = g.opacity;
  return spec;
}

/** Overprint modifier: `undefined` = absent (skip), `null` = malformed. */
function parseOverprint(
  raw: string | null,
): { fill: boolean; stroke: boolean; mode?: number } | null | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  const result: { fill: boolean; stroke: boolean; mode?: number } = {
    fill: o.fill === true,
    stroke: o.stroke === true,
  };
  if (isFiniteNumber(o.mode)) result.mode = o.mode;
  return result;
}

function bad(error: string): Response {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

function engineRejected(error: string): Response {
  return NextResponse.json({ success: false, error }, { status: 422 });
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const pageRaw = formData.get('page');
    const page = Number(pageRaw);
    if (!pageRaw || !Number.isInteger(page) || page < 1) {
      return bad('page must be a positive integer.');
    }

    const operationRaw = formData.get('operation');
    if (typeof operationRaw !== 'string' || !VALID_OPERATIONS.includes(operationRaw as ColorOperation)) {
      return bad(`operation must be one of: ${VALID_OPERATIONS.join(', ')}.`);
    }
    const op = operationRaw as ColorOperation;

    // Overprint modifier (prepress trapping) — only meaningful for opaque paints.
    const overprint = parseOverprint(formData.get('overprint') as string | null);
    if (overprint === null) {
      return bad('overprint must be valid JSON { fill: boolean, stroke: boolean, mode?: number }.');
    }

    // ── Per-operation payload validation (before touching the engine) ──────────
    let color: Color | null = null;
    let points: number[] = [];
    let gradient: GradientSpec | null = null;
    let rect: Box | null = null;
    let fillOpacity = 1;
    let textArgs: {
      x: number;
      y: number;
      size: number;
      text: string;
      font: string;
      opts: { opacity?: number; rotation?: number; underline?: boolean; strikethrough?: boolean };
    } | null = null;
    let iccProfile: Uint8Array | null = null;
    let condition = '';

    if (op === 'output-intent') {
      const profileEntry = formData.get('iccProfile');
      if (!(profileEntry instanceof File) || profileEntry.size === 0) {
        return bad('iccProfile file is required for the output-intent operation.');
      }
      iccProfile = new Uint8Array(await profileEntry.arrayBuffer());
      const conditionRaw = formData.get('condition');
      condition = typeof conditionRaw === 'string' ? conditionRaw.trim() : '';
      if (condition === '') return bad('condition is required for the output-intent operation.');
    } else {
      const payloadRaw = formData.get('payload');
      if (typeof payloadRaw !== 'string' || payloadRaw.trim() === '') {
        return bad('Missing required field: payload (JSON).');
      }
      let payload: unknown;
      try {
        payload = JSON.parse(payloadRaw);
      } catch {
        return bad('payload must be valid JSON.');
      }
      const p = payload as Record<string, unknown>;

      if (op === 'fill') {
        rect = parseBox(p.rect);
        if (!rect) return bad('payload.rect must be { x, y, w, h } with w, h > 0.');
        color = parseColor(p.color);
        if (!color) {
          return bad('payload.color must be a valid Color (rgb/cmyk/gray/separation/icc).');
        }
        if (isUnit(p.opacity)) fillOpacity = p.opacity;
      } else if (op === 'polygon') {
        const pts = p.points;
        if (!Array.isArray(pts) || pts.length < 6 || pts.length % 2 !== 0 || !pts.every(isFiniteNumber)) {
          return bad('payload.points must be a flat [x0, y0, …] array of at least 3 vertices.');
        }
        points = pts.map(Number);
        color = parseColor(p.color);
        if (!color) return bad('payload.color must be a valid Color.');
        if (isUnit(p.opacity)) fillOpacity = p.opacity;
      } else if (op === 'text') {
        if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.size) || p.size <= 0) {
          return bad('payload.x, payload.y and payload.size (> 0) are required numbers.');
        }
        if (typeof p.text !== 'string' || p.text === '') return bad('payload.text is required.');
        if (typeof p.font !== 'string' || p.font.trim() === '') {
          return bad('payload.font (a base-14 family) is required.');
        }
        color = parseColor(p.color);
        if (!color) return bad('payload.color must be a valid Color.');
        const opts: { opacity?: number; rotation?: number; underline?: boolean; strikethrough?: boolean } = {};
        if (isUnit(p.opacity)) opts.opacity = p.opacity;
        if (isFiniteNumber(p.rotation)) opts.rotation = p.rotation;
        if (typeof p.underline === 'boolean') opts.underline = p.underline;
        if (typeof p.strikethrough === 'boolean') opts.strikethrough = p.strikethrough;
        textArgs = { x: p.x, y: p.y, size: p.size, text: p.text, font: p.font, opts };
      } else {
        // op === 'gradient'
        gradient = parseGradient(payload);
        if (!gradient) {
          return bad('payload must be a valid GradientSpec { kind, coords, stops, rect, extend?, opacity? }.');
        }
      }
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const giga = await getEngine();
    let doc: GigaPdfDoc | null = null;
    try {
      doc = giga.open(bytes);

      if (op === 'output-intent') {
        if (!doc.addOutputIntent(iccProfile as Uint8Array, condition)) {
          return engineRejected('The ICC profile could not be embedded as an output intent.');
        }
      } else {
        // setOverprint affects the content drawn AFTER it — apply before the paint.
        if (overprint && op !== 'gradient') {
          doc.setOverprint(page, overprint.fill, overprint.stroke, overprint.mode);
        }

        let painted = false;
        if (op === 'fill') {
          painted = doc.addFilledRectangle(page, rect as Box, color as Color, fillOpacity);
        } else if (op === 'polygon') {
          painted = doc.addFilledPolygon(page, points, color as Color, fillOpacity);
        } else if (op === 'text') {
          const a = textArgs as NonNullable<typeof textArgs>;
          painted = doc.addTextColor(page, a.x, a.y, a.size, a.text, a.font, color as Color, a.opts);
        } else {
          painted = doc.addGradient(page, gradient as GradientSpec);
        }

        if (!painted) {
          return engineRejected('The page does not exist or the colour parameters were rejected.');
        }
      }

      const result = doc.save();
      return new Response(Buffer.from(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': sanitizeContentDisposition(file.name),
          'Content-Length': String(result.byteLength),
          'X-PDF-Color-Operation': op,
        },
      });
    } catch (engineError: unknown) {
      // The input is a validated, non-empty PDF, so an engine failure means a
      // corrupt/unsupported source or a paint the document cannot accept — a
      // client-correctable 422, not a server fault.
      serverLogger.warn('api.pdf.color.engine', { error: engineError, op });
      return engineRejected(
        'Failed to apply the colour/gradient. The PDF may be corrupted or the parameters are unsupported.',
      );
    } finally {
      doc?.close();
    }
  } catch (error: unknown) {
    serverLogger.error('api.pdf.color', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to apply colour/gradient.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
