/**
 * PDF in-place image replacement route via the WASM engine.
 *
 * POST /api/pdf/replace-image
 *
 * Swaps the pixels of an EXISTING image XObject in place (ISO 32000-1 §8.9) —
 * the writable counterpart of the editor's "Replace image" action on a selected
 * image element. The image keeps its object number and every `/Do` placement
 * (position / scale / rotation / clip), so the new raster is drawn into the same
 * box; only the stream bytes + image dictionary are rewritten.
 *
 * Form fields (multipart/form-data):
 *   file        — PDF file (required)
 *   page        — 1-based page number (required, positive integer)
 *   imageIndex  — the UNIFIED element index of the image on `page` (required,
 *                 non-negative integer), exactly the `index` reported by
 *                 `GigaPdfDoc.imageElements()` and carried on the editor's
 *                 `ImageElement.index`.
 *   image       — the replacement bitmap: PNG, JPEG, WebP, GIF, TIFF or AVIF (required).
 *
 * Returns the modified PDF as application/pdf, 400 on bad input, 422 when the
 * engine rejects the swap (page/index doesn't resolve to a top-level image, or
 * the bytes aren't a decodable raster).
 *
 * The engine is called directly here (rather than via @giga-pdf/pdf-engine)
 * because `replaceImage` is exposed by GigaPdfDoc; @qrcommunication/gigapdf-lib
 * is a server-external package whose `gigapdf.wasm` is traced for `/api/pdf/**`
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

/** 5 MB cap on the replacement bitmap (a generous raster ceiling). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Sniff the magic bytes of an uploaded image. `replaceImage` re-encodes through
 * the same shared `prepare_image` path as `addImage`, so it accepts EVERY raster
 * the engine decodes — PNG, JPEG, WebP, GIF, TIFF and AVIF (documented as such
 * since gigapdf-lib 0.109.1). PNG/JPEG embed natively; the rest decode to RGBA in
 * pure Rust/WASM. This gate only rejects bytes that are no recognized image at
 * all (400); the engine remains the final authority and returns `false` → 422
 * for anything it ultimately cannot decode.
 */
function detectImageFormat(
  bytes: Uint8Array,
): 'png' | 'jpeg' | 'webp' | 'gif' | 'avif' | 'tiff' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return 'webp';
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'gif'; // "GIF8"
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 && // "ftyp"
    bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69 && bytes[11] === 0x66 // "avif"
  ) {
    return 'avif';
  }
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) || // "II*\0" (LE)
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)) // "MM\0*" (BE)
  ) {
    return 'tiff';
  }
  return null;
}

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

    const imageIndexRaw = formData.get('imageIndex');
    const imageIndex = Number(imageIndexRaw);
    if (imageIndexRaw === null || !Number.isInteger(imageIndex) || imageIndex < 0) {
      return bad('imageIndex must be a non-negative integer.');
    }

    const imageEntry = formData.get('image');
    if (!(imageEntry instanceof File) || imageEntry.size === 0) {
      return bad('image file is required.');
    }
    if (imageEntry.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { success: false, error: `image exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MB size limit.` },
        { status: 413 },
      );
    }
    const imageBytes = new Uint8Array(await imageEntry.arrayBuffer());
    if (detectImageFormat(imageBytes) === null) {
      return bad('image must be a PNG, JPEG, WebP, GIF, TIFF or AVIF bitmap.');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const giga = await getEngine();
    let doc: GigaPdfDoc | null = null;
    try {
      doc = giga.open(bytes);

      const replaced = doc.replaceImage(page, imageIndex, imageBytes);
      if (!replaced) {
        return NextResponse.json(
          {
            success: false,
            error:
              'The page/index does not resolve to a top-level image, or the bitmap could not be decoded.',
          },
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
      // The input is a validated, non-empty PDF, so an engine failure here means
      // a corrupt/unsupported source — a client-correctable 422, not a fault.
      serverLogger.warn('api.pdf.replace-image.engine', { error: engineError });
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to replace the image. The PDF may be corrupted or the image is unsupported.',
        },
        { status: 422 },
      );
    } finally {
      doc?.close();
    }
  } catch (error: unknown) {
    serverLogger.error('api.pdf.replace-image', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to replace image.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
