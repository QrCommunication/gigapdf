/**
 * PDF freehand ink annotation route via the WASM engine.
 *
 * POST /api/pdf/ink
 *
 * Bakes a freehand ink (`/Ink`) annotation from a single polyline onto a PDF
 * page — the writable counterpart of the editor's pencil/draw tool. The points
 * are the captured stroke already lowered to PDF user space (origin bottom-left,
 * Y-up) by the canvas, so they map 1:1 onto `GigaPdfDoc.addInk`.
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   page       — 1-based page number (required, positive integer)
 *   points     — JSON flat number array `[x0, y0, x1, y1, …]` in PDF user space
 *                (required, even length, ≥ 2 points / 4 numbers, all finite)
 *   rgb        — optional packed `0xRRGGBB` stroke colour (default black)
 *   lineWidth  — optional stroke width in user-space units (default 2, > 0)
 *
 * Returns the modified PDF as application/pdf, 400 on bad input, 422 when the
 * engine rejects the stroke (e.g. page out of range).
 *
 * The engine is called directly here (rather than via @giga-pdf/pdf-engine)
 * because `addInk` is exposed by GigaPdfDoc; @qrcommunication/gigapdf-lib is a
 * server-external package whose `gigapdf.wasm` is traced for `/api/pdf/**`
 * (see next.config.ts).
 */

import { NextResponse } from 'next/server';
import { GigaPdfEngine, type GigaPdfDoc } from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

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

/** Generous upper bound on a single stroke (anti-DoS on the JSON parse). */
const MAX_POINTS = 100_000; // 50k vertices

function bad(error: string): Response {
  return NextResponse.json({ success: false, error }, { status: 400 });
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

    const pointsRaw = formData.get('points');
    if (typeof pointsRaw !== 'string' || pointsRaw.trim() === '') {
      return bad('Missing required field: points (JSON number[]).');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(pointsRaw);
    } catch {
      return bad('points must be valid JSON.');
    }
    if (!Array.isArray(parsed) || parsed.length < 4 || parsed.length % 2 !== 0) {
      return bad('points must be a flat [x0, y0, x1, y1, …] array with at least two points.');
    }
    if (parsed.length > MAX_POINTS) {
      return bad(`points exceeds the ${MAX_POINTS / 2} vertex limit.`);
    }
    if (!parsed.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return bad('points must contain only finite numbers.');
    }
    const points = parsed as number[];

    // Optional stroke colour (packed 0xRRGGBB) and width.
    let rgb: number | undefined;
    const rgbRaw = formData.get('rgb');
    if (rgbRaw !== null && String(rgbRaw).trim() !== '') {
      const n = Number(rgbRaw);
      if (!Number.isInteger(n) || n < 0 || n > 0xffffff) {
        return bad('rgb must be an integer in [0, 0xFFFFFF].');
      }
      rgb = n;
    }

    let lineWidth: number | undefined;
    const lineWidthRaw = formData.get('lineWidth');
    if (lineWidthRaw !== null && String(lineWidthRaw).trim() !== '') {
      const n = Number(lineWidthRaw);
      if (!Number.isFinite(n) || n <= 0) {
        return bad('lineWidth must be a positive number.');
      }
      lineWidth = n;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const giga = await getEngine();
    let doc: GigaPdfDoc | null = null;
    try {
      doc = giga.open(bytes);

      const added = doc.addInk(page, points, rgb, lineWidth);
      if (!added) {
        return NextResponse.json(
          { success: false, error: 'The page does not exist or the ink stroke was rejected.' },
          { status: 422 },
        );
      }

      const result = doc.saveCompressed();
      return new Response(Buffer.from(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': sanitizeContentDisposition(file.name),
          'Content-Length': String(result.byteLength),
        },
      });
    } catch (engineError: unknown) {
      serverLogger.warn('api.pdf.ink.engine', { error: engineError });
      return NextResponse.json(
        { success: false, error: 'Failed to add the ink stroke. The PDF may be corrupted.' },
        { status: 422 },
      );
    } finally {
      doc?.close();
    }
  } catch (error: unknown) {
    serverLogger.error('api.pdf.ink', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to add ink stroke.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
