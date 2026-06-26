/**
 * PDF Insert SVG route
 *
 * POST /api/pdf/insert-svg
 * Rasterises / embeds an inline SVG graphic onto a PDF page through the
 * engine's `addSvg` ({@link GigaPdfDoc.addSvg} from `@qrcommunication/gigapdf-lib`).
 *
 * Form fields (multipart/form-data):
 *   file — PDF file (required)
 *   page — 1-based page number (required, 1..pageCount)
 *   svg  — SVG markup string (required; must begin with `<svg` or `<?xml`)
 *   x    — left edge in PDF points (required, finite)   ┐ origin BOTTOM-LEFT,
 *   y    — bottom edge in PDF points (required, finite) │ Y up (PDF user space)
 *   w    — width in PDF points (required, > 0)          │
 *   h    — height in PDF points (required, > 0)         ┘
 *
 * Returns the modified PDF as application/pdf binary, or 422 when the engine
 * declines the insertion (e.g. unparseable SVG).
 */

import { NextResponse } from 'next/server';
import { openDocument, saveDocument, PDFCorruptedError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

// Sanity bound for placement coordinates (points). PDF user space is comfortably
// below this; rejects NaN/Infinity and absurd values.
const MAX_COORD = 1_000_000;

// SVG markup can legitimately be large (inlined base64 images), but an
// unbounded string is a DoS vector — cap the payload.
const MAX_SVG_BYTES = 5_000_000;

// Accept only genuine SVG markup. A leading XML prolog (`<?xml …`) or the root
// `<svg` element; anything else (HTML, scripts, binary) is rejected up front.
const SVG_PREFIX = /^\s*(<\?xml[\s>]|<svg[\s>])/i;

/** Validate an untrusted value as a finite number within `[min, max]`. */
function isFiniteInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const svgRaw = formData.get('svg');
    if (typeof svgRaw !== 'string' || svgRaw.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'svg is required (inline SVG markup).' },
        { status: 400 },
      );
    }
    if (svgRaw.length > MAX_SVG_BYTES) {
      return NextResponse.json(
        { success: false, error: `svg must be at most ${MAX_SVG_BYTES} characters.` },
        { status: 400 },
      );
    }
    if (!SVG_PREFIX.test(svgRaw)) {
      return NextResponse.json(
        { success: false, error: 'svg must begin with "<svg" or an XML prolog.' },
        { status: 400 },
      );
    }

    // Placement (PDF points, origin bottom-left). w/h must be strictly positive.
    const x = Number(formData.get('x'));
    const y = Number(formData.get('y'));
    const w = Number(formData.get('w'));
    const h = Number(formData.get('h'));
    if (
      !isFiniteInRange(x, -MAX_COORD, MAX_COORD) ||
      !isFiniteInRange(y, -MAX_COORD, MAX_COORD)
    ) {
      return NextResponse.json(
        { success: false, error: 'x and y must be finite numbers (PDF points).' },
        { status: 400 },
      );
    }
    if (
      !isFiniteInRange(w, Number.MIN_VALUE, MAX_COORD) ||
      !isFiniteInRange(h, Number.MIN_VALUE, MAX_COORD)
    ) {
      return NextResponse.json(
        { success: false, error: 'w and h must be positive numbers (PDF points).' },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const handle = await openDocument(buffer);
    const doc = handle._doc;
    const pageCount = doc.pageCount();

    const page = Number(formData.get('page'));
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      return NextResponse.json(
        { success: false, error: `page must be an integer between 1 and ${pageCount}.` },
        { status: 400 },
      );
    }

    const ok = doc.addSvg(page, svgRaw, x, y, w, h);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: 'Could not insert the SVG (unparseable markup?).' },
        { status: 422 },
      );
    }

    const savedBytes = await saveDocument(handle);
    return new Response(Buffer.from(savedBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(savedBytes.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    serverLogger.error('api.pdf.insert-svg', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to insert SVG.' },
      { status: 500 },
    );
  }
}
