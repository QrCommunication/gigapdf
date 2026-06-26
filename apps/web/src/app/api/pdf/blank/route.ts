/**
 * Blank PDF route — create a fresh, empty single-page PDF to start editing from
 * scratch (the "New blank document" entry point of the GED). The generated PDF
 * is returned as binary so the caller can store it through the normal document
 * upload flow and open it in the editor like any other PDF.
 *
 * POST /api/pdf/blank   (application/json)
 * Body (all optional):
 *   size        — "a4" | "letter" | "legal"          (default "a4")
 *   orientation — "portrait" | "landscape"            (default "portrait")
 *   width       — page width in POINTS  (overrides size; requires `height`)
 *   height      — page height in POINTS (overrides size; requires `width`)
 *
 * An empty/absent body is valid and yields an A4 portrait page. Explicit
 * `width`/`height` (in points) override the named size + orientation; both must
 * be supplied together and fall within [72, 14400] points.
 *
 * Returns the generated PDF as application/pdf binary (one blank page at the
 * requested dimensions).
 *
 * Errors:
 *   400 — invalid size/orientation, or out-of-range/partial width/height
 *   401 — no valid session
 *   500 — unexpected engine failure (no stack trace exposed)
 */

import { NextResponse } from 'next/server';
// The zero-dependency engine renders a blank page from empty HTML (its native
// primitive for synthesizing pages). It is server-only here, externalised via
// `serverExternalPackages` and its wasm traced through `/api/pdf/**`.
import { GigaPdfEngine } from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';

/**
 * Named page sizes in POINTS (1/72 inch), portrait orientation. ISO A4 plus the
 * two US sizes the GED dialog offers.
 */
const PAGE_SIZES = {
  a4: { width: 595, height: 842 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
} as const;
type PageSizeName = keyof typeof PAGE_SIZES;
const SIZE_NAMES = new Set<string>(Object.keys(PAGE_SIZES));

/** Page-size bounds in points: 1 inch min, PDF user-space max (200 inches). */
const MIN_DIMENSION_PT = 72;
const MAX_DIMENSION_PT = 14400;

/**
 * Memoised engine handle. Mirrors the other `/api/pdf/*` routes: one wasm
 * instance is reused across requests in this long-lived server module.
 */
let enginePromise: Promise<GigaPdfEngine> | null = null;
function getEngine(): Promise<GigaPdfEngine> {
  enginePromise ??= GigaPdfEngine.loadDefault();
  return enginePromise;
}

/** A completely empty document — renders to a single blank page. */
const EMPTY_HTML =
  '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

/**
 * Resolve the request body into concrete page dimensions in points. Explicit
 * `width`/`height` (both required, in range) take precedence over the named
 * `size` + `orientation`. Returns a precise, client-safe error string instead
 * of throwing so the caller can answer 400.
 */
function resolveDimensions(
  body: Record<string, unknown>,
): { width: number; height: number } | { error: string } {
  const { size, orientation, width, height } = body;

  const hasWidth = width !== undefined && width !== null;
  const hasHeight = height !== undefined && height !== null;

  // Explicit dimensions override the named size — both must be supplied.
  if (hasWidth || hasHeight) {
    if (!hasWidth || !hasHeight) {
      return { error: 'Both "width" and "height" must be provided together (in points).' };
    }
    if (
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      return { error: '"width" and "height" must be finite numbers (points).' };
    }
    if (
      width < MIN_DIMENSION_PT ||
      height < MIN_DIMENSION_PT ||
      width > MAX_DIMENSION_PT ||
      height > MAX_DIMENSION_PT
    ) {
      return {
        error: `"width" and "height" must be between ${MIN_DIMENSION_PT} and ${MAX_DIMENSION_PT} points.`,
      };
    }
    return { width, height };
  }

  // Named size + orientation path.
  const sizeName = size ?? 'a4';
  if (typeof sizeName !== 'string' || !SIZE_NAMES.has(sizeName)) {
    return { error: `"size" must be one of: ${[...SIZE_NAMES].join(', ')}.` };
  }
  const orient = orientation ?? 'portrait';
  if (orient !== 'portrait' && orient !== 'landscape') {
    return { error: '"orientation" must be "portrait" or "landscape".' };
  }

  const base = PAGE_SIZES[sizeName as PageSizeName];
  return orient === 'landscape'
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

/**
 * Produce a single blank page of the requested size. Primary path: render an
 * empty HTML body, which emits exactly one (blank) page — margin is irrelevant
 * with no content, so 0 keeps the MediaBox equal to the full requested page.
 * Defensive fallbacks guarantee a non-empty, editable result.
 */
function generateBlankPdf(engine: GigaPdfEngine, width: number, height: number): Uint8Array {
  try {
    const bytes = engine.htmlRender(EMPTY_HTML, [], width, height, 0);
    const doc = engine.open(bytes);
    try {
      // If the renderer ever yields a 0-page skeleton, add one blank page at the
      // requested size so the result is always editable.
      if (doc.pageCount() >= 1) return bytes;
      doc.addPage(width, height, 0);
      return doc.save();
    } finally {
      doc.close();
    }
  } catch (htmlErr) {
    // Fallback: assemble an empty container, then add a single blank page.
    serverLogger.warn('[api/pdf/blank] htmlRender path failed, using mergePdfs fallback', {
      error: htmlErr instanceof Error ? htmlErr.message : String(htmlErr),
    });
    const empty = engine.mergePdfs([]);
    const doc = engine.open(empty);
    try {
      doc.addPage(width, height, 0);
      return doc.save();
    } finally {
      doc.close();
    }
  }
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  // Body is optional: an empty/absent/invalid JSON body defaults to A4 portrait.
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }

  const resolved = resolveDimensions(body);
  if ('error' in resolved) {
    return NextResponse.json({ success: false, error: resolved.error }, { status: 400 });
  }

  try {
    const engine = await getEngine();
    const pdfBytes = generateBlankPdf(engine, resolved.width, resolved.height);

    serverLogger.info('[api/pdf/blank] Blank PDF created', {
      userId: authResult.context.userId,
      width: resolved.width,
      height: resolved.height,
      outputBytes: pdfBytes.byteLength,
    });

    // Buffer.from is required: Next.js rejects Uint8Array<ArrayBufferLike> as BodyInit.
    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition('blank.pdf'),
        'Content-Length': String(pdfBytes.byteLength),
      },
    });
  } catch (error: unknown) {
    serverLogger.error('[api/pdf/blank] Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to create a blank PDF.' },
      { status: 500 },
    );
  }
}
