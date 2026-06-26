/**
 * PDF text-run restyle route (Word-like in-place text styling).
 *
 * POST /api/pdf/text-style
 *
 * Re-styles sub-ranges of an EXISTING parsed text run **in place** — the
 * by-character companion of the shape `setPathStyle` path. Calls
 * `GigaPdfDoc.setTextRunStyle(page, index, spans)` directly (`handle._doc`):
 * the original glyph codes (incl. `TJ` kerning) are sliced and re-emitted —
 * never re-encoded — so positioning is preserved (true vectorial restyle, not
 * a redact + re-draw overlay).
 *
 * Form fields (multipart/form-data):
 *   file  — PDF file (required)
 *   page  — 1-based page number of the run (required)
 *   index — engine text-run index on the page (from
 *           `GigaPdfDoc.textElements().index`, surfaced as `TextElement.index`)
 *           (required, integer >= 0)
 *   spans — JSON array of style spans (required, non-empty):
 *           [{ start, end, color?, sizePt?, bold?, italic?, underline?, strike? }]
 *             - start/end : UTF-16 indices into the run's decoded text
 *                           (`end >= start`; the engine clamps to the run length)
 *             - color     : [r, g, b] each in 0..=1 (text fill)
 *             - sizePt    : positive number — rescales the slice's font
 *             - bold/italic/underline/strike : booleans
 *
 * Returns the modified PDF as application/pdf binary, or:
 *   - 400 on invalid input (bad page/index/spans)
 *   - 422 when the engine cannot restyle (index is not a top-level text run —
 *     e.g. FORM-XObject text — mirroring `setTextRunStyle`'s `false` return)
 */

import { NextResponse } from 'next/server';
import { openDocument } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError, PDFPageOutOfRangeError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

// A run with thousands of spans is pathological; cap the count so a malicious
// payload cannot exhaust the engine.
const MAX_SPANS = 2000;
// A font scaled beyond this is never a legitimate restyle — reject early.
const MAX_SIZE_PT = 1600;

/** One validated style span passed verbatim to `setTextRunStyle`. */
interface StyleSpan {
  start: number;
  end: number;
  color?: [number, number, number];
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

type ParseResult<T> = T | { error: string };

function isError<T>(v: ParseResult<T>): v is { error: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    Object.prototype.hasOwnProperty.call(v, 'error')
  );
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validate a `[r, g, b]` colour with each component in `0..=1`. */
function parseColor(raw: unknown): ParseResult<[number, number, number]> {
  if (
    !Array.isArray(raw) ||
    raw.length !== 3 ||
    !raw.every((n) => isFiniteNumber(n) && n >= 0 && n <= 1)
  ) {
    return { error: 'span.color must be [r, g, b] with each value in 0..=1.' };
  }
  return [raw[0], raw[1], raw[2]] as [number, number, number];
}

/** Validate one span object from the request payload. */
function parseSpan(raw: unknown, i: number): ParseResult<StyleSpan> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: `spans[${i}] must be an object.` };
  }
  const o = raw as Record<string, unknown>;

  if (!Number.isInteger(o.start) || (o.start as number) < 0) {
    return { error: `spans[${i}].start must be an integer >= 0.` };
  }
  if (!Number.isInteger(o.end) || (o.end as number) < (o.start as number)) {
    return { error: `spans[${i}].end must be an integer >= start.` };
  }

  const span: StyleSpan = { start: o.start as number, end: o.end as number };

  if (o.color !== undefined) {
    const color = parseColor(o.color);
    if (isError(color)) return { error: `spans[${i}]: ${color.error}` };
    span.color = color;
  }
  if (o.sizePt !== undefined) {
    if (!isFiniteNumber(o.sizePt) || o.sizePt <= 0 || o.sizePt > MAX_SIZE_PT) {
      return { error: `spans[${i}].sizePt must be a number in (0, ${MAX_SIZE_PT}].` };
    }
    span.sizePt = o.sizePt;
  }
  for (const flag of ['bold', 'italic', 'underline', 'strike'] as const) {
    if (o[flag] !== undefined) {
      if (typeof o[flag] !== 'boolean') {
        return { error: `spans[${i}].${flag} must be a boolean.` };
      }
      span[flag] = o[flag] as boolean;
    }
  }
  return span;
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

    const pageRaw = formData.get('page');
    const page = Number(pageRaw);
    if (!pageRaw || !Number.isInteger(page) || page < 1) {
      return NextResponse.json(
        { success: false, error: 'page must be a positive integer.' },
        { status: 400 },
      );
    }

    const indexRaw = formData.get('index');
    const index = Number(indexRaw);
    if (indexRaw === null || !Number.isInteger(index) || index < 0) {
      return NextResponse.json(
        { success: false, error: 'index must be an integer >= 0.' },
        { status: 400 },
      );
    }

    const spansRaw = formData.get('spans');
    if (typeof spansRaw !== 'string' || spansRaw.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: spans (JSON array).' },
        { status: 400 },
      );
    }
    let spansJson: unknown;
    try {
      spansJson = JSON.parse(spansRaw);
    } catch {
      return NextResponse.json(
        { success: false, error: 'spans must be valid JSON.' },
        { status: 400 },
      );
    }
    if (!Array.isArray(spansJson) || spansJson.length === 0) {
      return NextResponse.json(
        { success: false, error: 'spans must be a non-empty array.' },
        { status: 400 },
      );
    }
    if (spansJson.length > MAX_SPANS) {
      return NextResponse.json(
        { success: false, error: `spans must contain at most ${MAX_SPANS} entries.` },
        { status: 400 },
      );
    }
    const spans: StyleSpan[] = [];
    for (let i = 0; i < spansJson.length; i++) {
      const parsed = parseSpan(spansJson[i], i);
      if (isError(parsed)) {
        return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
      }
      spans.push(parsed);
    }

    const arrayBuffer = await file.arrayBuffer();
    const handle = await openDocument(Buffer.from(arrayBuffer));
    const doc = handle._doc;

    const pageCount = doc.pageCount();
    if (page > pageCount) {
      return NextResponse.json(
        {
          success: false,
          error: `page ${page} is out of range (document has ${pageCount} pages).`,
        },
        { status: 400 },
      );
    }

    const ok = doc.setTextRunStyle(page, index, spans);
    if (!ok) {
      // false = `index` does not resolve to a top-level, restyleable text run
      // (e.g. it addresses FORM-XObject text the stream edit can't reach).
      return NextResponse.json(
        {
          success: false,
          error: 'Could not restyle this text run (not a top-level editable run).',
        },
        { status: 422 },
      );
    }

    return pdfResponse(doc.saveCompressed(), file.name);
  } catch (error: unknown) {
    if (error instanceof PDFPageOutOfRangeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    serverLogger.error('api.pdf.text-style', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to restyle text run.' },
      { status: 500 },
    );
  }
}
