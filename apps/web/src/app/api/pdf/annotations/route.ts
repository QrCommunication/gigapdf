/**
 * PDF Annotations route
 *
 * POST /api/pdf/annotations
 *
 * Two paradigms share this endpoint, discriminated by the `action` field:
 *
 * 1. Text-markup annotations (legacy, `action` ABSENT) — adds a highlight /
 *    underline / strikeout / note / link / squiggly annotation described by a
 *    JSON `AnnotationElement`. Unchanged contract; see `element` below.
 *
 * 2. Geometric annotations + appearance regeneration (`action` PRESENT) — adds a
 *    `/Circle`, `/Polygon`, `/PolyLine` or `/Caret` annotation to the page (or
 *    regenerates an annotation's `/AP` appearance), calling `GigaPdfDoc`
 *    (`handle._doc`) directly. When no explicit geometry is supplied the route
 *    places a default-sized shape centred on the page `/MediaBox` — the user then
 *    repositions it with the existing annotation move/select system (no free
 *    canvas drawing tool).
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   pageNumber — 1-based page number (required)
 *   action     — "circle" | "polygon" | "polyline" | "caret"
 *                | "regenerateAppearance"  (optional; omit for text-markup)
 *   element    — JSON AnnotationElement (required when `action` is ABSENT)
 *   params     — JSON geometry/colour options (geometric actions, optional)
 *
 * AnnotationElement schema (text-markup path, subset of @giga-pdf/types):
 * {
 *   annotationType: "highlight" | "underline" | "strikeout" | "strikethrough"
 *                   | "note" | "link" | "squiggly",
 *   bounds: { x, y, width, height },
 *   content?: string,
 *   style: { color: "#rrggbb", opacity: number },
 *   url?, targetPage?, targetPosition?      // link annotations
 * }
 *
 * params schema (geometric path — every field optional unless noted):
 *   circle / caret:
 *     { rect?: [x0, y0, x1, y1],            // PDF user space, bottom-left origin
 *       stroke?: "#rrggbb" | null,          // circle border (caret uses `color`)
 *       fill?:   "#rrggbb" | null,          // circle interior
 *       color?:  "#rrggbb",                 // caret colour
 *       lineWidth?: number }
 *   polygon / polyline:
 *     { points?: number[],                  // flat [x0,y0,x1,y1,…] (>= 3 points)
 *       stroke?: "#rrggbb" | null,          // polygon border (polyline: `color`)
 *       fill?:   "#rrggbb" | null,          // polygon interior
 *       color?:  "#rrggbb",                 // polyline colour
 *       lineWidth?: number }
 *   regenerateAppearance:
 *     { index: number }                     // 0-based annotation index (required)
 *
 * Returns the modified PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import {
  openDocument,
  saveDocument,
  addAnnotation,
} from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import type { AnnotationElement } from '@giga-pdf/types';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

// Geometric annotation actions handled by calling GigaPdfDoc directly. Absence
// of `action` keeps the legacy text-markup path (addAnnotation) intact.
const GEOMETRIC_ACTIONS = new Set([
  'circle',
  'polygon',
  'polyline',
  'caret',
  'regenerateAppearance',
]);

// Text-markup subtypes accepted by the legacy element path.
const TEXT_MARKUP_TYPES = [
  'highlight',
  'underline',
  'strikeout',
  'strikethrough',
  'note',
  'link',
  'squiggly',
];

// Default annotation colour (a readable blue) used when the caller supplies no
// stroke/fill/colour. Packed 0xRRGGBB, as the engine expects.
const DEFAULT_COLOR = 0x2563eb;
const DEFAULT_LINE_WIDTH = 1.5;
const MAX_LINE_WIDTH = 144; // 2 inches — well beyond any sane border.
// A polyline/polygon with thousands of vertices is pathological; cap the count
// so a malicious payload cannot exhaust the engine. 2000 vertices = 4000 floats.
const MAX_POINT_VALUES = 4000;

type ParseResult<T> = T | { error: string };

function isError<T>(v: ParseResult<T>): v is { error: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    Object.prototype.hasOwnProperty.call(v, 'error')
  );
}

/** Parse a `#rrggbb` string into a packed 0xRRGGBB integer. */
function parseHexColor(value: string): ParseResult<number> {
  const m = /^#([0-9a-fA-F]{6})$/.exec(value.trim());
  if (!m) return { error: `colour must be a "#rrggbb" hex string, got "${value}".` };
  return parseInt(m[1]!, 16);
}

/**
 * Resolve an optional colour field that may be omitted (→ `fallback`), an
 * explicit `null` (→ `null`, i.e. "omit this colour"), or a `#rrggbb` string.
 */
function resolveOptionalColor(
  raw: unknown,
  fallback: number | null,
  label: string,
): ParseResult<number | null> {
  if (raw === undefined) return fallback;
  if (raw === null) return null;
  if (typeof raw !== 'string') return { error: `${label} must be a "#rrggbb" string or null.` };
  return parseHexColor(raw);
}

/** Resolve a required colour field (never null) — used for polyline/caret `rgb`. */
function resolveColor(raw: unknown, fallback: number, label: string): ParseResult<number> {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string') return { error: `${label} must be a "#rrggbb" string.` };
  return parseHexColor(raw);
}

/** Resolve an optional line width (positive, capped). */
function resolveLineWidth(raw: unknown): ParseResult<number> {
  if (raw === undefined) return DEFAULT_LINE_WIDTH;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > MAX_LINE_WIDTH) {
    return { error: `lineWidth must be a number in (0, ${MAX_LINE_WIDTH}].` };
  }
  return raw;
}

/** Validate a `[x0, y0, x1, y1]` rect of finite numbers. */
function parseRect(raw: unknown): ParseResult<[number, number, number, number]> {
  if (
    !Array.isArray(raw) ||
    raw.length !== 4 ||
    !raw.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    return { error: 'rect must be an array of 4 finite numbers [x0, y0, x1, y1].' };
  }
  return [raw[0], raw[1], raw[2], raw[3]] as [number, number, number, number];
}

/** Validate a flat `[x0, y0, x1, y1, …]` points array (>= 3 points, even length). */
function parsePoints(raw: unknown): ParseResult<number[]> {
  if (!Array.isArray(raw)) return { error: 'points must be an array of numbers.' };
  if (raw.length < 6) return { error: 'points must contain at least 3 vertices (6 numbers).' };
  if (raw.length % 2 !== 0) return { error: 'points must contain an even number of values.' };
  if (raw.length > MAX_POINT_VALUES) {
    return { error: `points must contain at most ${MAX_POINT_VALUES} values.` };
  }
  if (!raw.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return { error: 'points must contain only finite numbers.' };
  }
  return raw as number[];
}

/**
 * A default annotation rect centred on `mediaBox`, sized as a fraction of the
 * page but capped so it stays a movable handle the user can grab and reposition.
 */
function defaultRect(
  mediaBox: [number, number, number, number],
): [number, number, number, number] {
  const [mx0, my0, mx1, my1] = mediaBox;
  const pageW = Math.abs(mx1 - mx0);
  const pageH = Math.abs(my1 - my0);
  const bw = Math.min(180, pageW * 0.3);
  const bh = Math.min(120, pageH * 0.2);
  const cx = Math.min(mx0, mx1) + pageW / 2;
  const cy = Math.min(my0, my1) + pageH / 2;
  return [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2];
}

/** Build a binary PDF response from saved bytes. */
function pdfResponse(savedBytes: Uint8Array, fileName: string): Response {
  // Buffer.from is required: Next.js' stricter BodyInit rejects a generic
  // Uint8Array<ArrayBufferLike> as returned by the engine.
  return new Response(Buffer.from(savedBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': sanitizeContentDisposition(fileName),
      'Content-Length': String(savedBytes.byteLength),
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const pageNumberRaw = formData.get('pageNumber');
    const pageNumber = Number(pageNumberRaw);
    if (!pageNumberRaw || !Number.isInteger(pageNumber) || pageNumber < 1) {
      return NextResponse.json(
        { success: false, error: 'pageNumber must be a positive integer.' },
        { status: 400 },
      );
    }

    const action = formData.get('action');

    // ── Geometric annotations + appearance regeneration (GigaPdfDoc direct) ────
    if (typeof action === 'string' && action.length > 0) {
      if (!GEOMETRIC_ACTIONS.has(action)) {
        return NextResponse.json(
          {
            success: false,
            error: `action must be one of: ${[...GEOMETRIC_ACTIONS].join(', ')}.`,
          },
          { status: 400 },
        );
      }

      // `params` is optional JSON; default to {} (route fills sensible defaults).
      const paramsRaw = formData.get('params');
      let params: Record<string, unknown> = {};
      if (typeof paramsRaw === 'string' && paramsRaw.length > 0) {
        try {
          const parsed = JSON.parse(paramsRaw);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return NextResponse.json(
              { success: false, error: 'params must be a JSON object.' },
              { status: 400 },
            );
          }
          params = parsed as Record<string, unknown>;
        } catch {
          return NextResponse.json(
            { success: false, error: 'params must be valid JSON.' },
            { status: 400 },
          );
        }
      }

      const arrayBuffer = await file.arrayBuffer();
      const handle = await openDocument(Buffer.from(arrayBuffer));
      const doc = handle._doc;
      const pageCount = doc.pageCount();
      if (pageNumber > pageCount) {
        return NextResponse.json(
          {
            success: false,
            error: `pageNumber ${pageNumber} is out of range (document has ${pageCount} pages).`,
          },
          { status: 400 },
        );
      }

      const lineWidth = resolveLineWidth(params.lineWidth);
      if (isError(lineWidth)) {
        return NextResponse.json({ success: false, error: lineWidth.error }, { status: 400 });
      }

      let ok = false;

      if (action === 'regenerateAppearance') {
        const index = params.index;
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
          return NextResponse.json(
            { success: false, error: 'params.index must be an integer >= 0.' },
            { status: 400 },
          );
        }
        ok = doc.regenerateAppearance(pageNumber, index);
        if (!ok) {
          // false = bad index, or a subtype whose appearance can't be rebuilt.
          return NextResponse.json(
            {
              success: false,
              error: 'Could not regenerate appearance (bad index or unsupported subtype).',
            },
            { status: 400 },
          );
        }
      } else if (action === 'circle' || action === 'caret') {
        const rect =
          params.rect === undefined
            ? defaultRect(doc.pageInfo(pageNumber).mediaBox)
            : parseRect(params.rect);
        if (isError(rect)) {
          return NextResponse.json({ success: false, error: rect.error }, { status: 400 });
        }
        const [x0, y0, x1, y1] = rect;

        if (action === 'circle') {
          // Default to a visible border when neither stroke nor fill is supplied.
          const noColorGiven = params.stroke === undefined && params.fill === undefined;
          const stroke = resolveOptionalColor(
            params.stroke,
            noColorGiven ? DEFAULT_COLOR : null,
            'stroke',
          );
          if (isError(stroke)) {
            return NextResponse.json({ success: false, error: stroke.error }, { status: 400 });
          }
          const fill = resolveOptionalColor(params.fill, null, 'fill');
          if (isError(fill)) {
            return NextResponse.json({ success: false, error: fill.error }, { status: 400 });
          }
          ok = doc.addCircleAnnotation(pageNumber, x0, y0, x1, y1, stroke, fill, lineWidth);
        } else {
          const rgb = resolveColor(params.color, DEFAULT_COLOR, 'color');
          if (isError(rgb)) {
            return NextResponse.json({ success: false, error: rgb.error }, { status: 400 });
          }
          ok = doc.addCaretAnnotation(pageNumber, x0, y0, x1, y1, rgb);
        }
      } else {
        // action === 'polygon' || action === 'polyline'
        let points: ParseResult<number[]>;
        if (params.points === undefined) {
          const [x0, y0, x1, y1] = defaultRect(doc.pageInfo(pageNumber).mediaBox);
          const cx = (x0 + x1) / 2;
          points =
            action === 'polygon'
              ? // A centred triangle.
                [cx, y1, x1, y0, x0, y0]
              : // An open three-point "peak".
                [x0, y0, cx, y1, x1, y0];
        } else {
          points = parsePoints(params.points);
        }
        if (isError(points)) {
          return NextResponse.json({ success: false, error: points.error }, { status: 400 });
        }

        if (action === 'polygon') {
          const noColorGiven = params.stroke === undefined && params.fill === undefined;
          const stroke = resolveOptionalColor(
            params.stroke,
            noColorGiven ? DEFAULT_COLOR : null,
            'stroke',
          );
          if (isError(stroke)) {
            return NextResponse.json({ success: false, error: stroke.error }, { status: 400 });
          }
          const fill = resolveOptionalColor(params.fill, null, 'fill');
          if (isError(fill)) {
            return NextResponse.json({ success: false, error: fill.error }, { status: 400 });
          }
          ok = doc.addPolygonAnnotation(pageNumber, points, stroke, fill, lineWidth);
        } else {
          const rgb = resolveColor(params.color, DEFAULT_COLOR, 'color');
          if (isError(rgb)) {
            return NextResponse.json({ success: false, error: rgb.error }, { status: 400 });
          }
          ok = doc.addPolylineAnnotation(pageNumber, points, rgb, lineWidth);
        }
      }

      if (!ok) {
        return NextResponse.json(
          { success: false, error: `Engine could not apply the ${action} annotation.` },
          { status: 422 },
        );
      }

      const savedBytes = await saveDocument(handle);
      return pdfResponse(savedBytes, file.name);
    }

    // ── Legacy text-markup path (`action` absent) — addAnnotation(element) ──────
    const elementRaw = formData.get('element') as string | null;
    if (!elementRaw) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: element (JSON AnnotationElement).' },
        { status: 400 },
      );
    }

    let element: AnnotationElement;
    try {
      element = JSON.parse(elementRaw) as AnnotationElement;
    } catch {
      return NextResponse.json(
        { success: false, error: 'element must be valid JSON.' },
        { status: 400 },
      );
    }

    if (!TEXT_MARKUP_TYPES.includes(element.annotationType)) {
      return NextResponse.json(
        {
          success: false,
          error: `element.annotationType must be one of: ${TEXT_MARKUP_TYPES.join(', ')}.`,
        },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const handle = await openDocument(Buffer.from(arrayBuffer));

    await addAnnotation(handle, pageNumber, element);

    const savedBytes = await saveDocument(handle);
    return pdfResponse(savedBytes, file.name);
  } catch (error: unknown) {
    if (error instanceof PDFPageOutOfRangeError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    serverLogger.error('api.pdf.annotations', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to add annotation.' },
      { status: 500 },
    );
  }
}
