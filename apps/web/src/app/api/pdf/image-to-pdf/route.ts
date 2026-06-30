/**
 * Image → PDF route.
 *
 * POST /api/pdf/image-to-pdf
 * Converts one or more raster images into a single PDF. A single image becomes
 * a one-page PDF; multiple images become a multi-page PDF (one image per page),
 * in the order given.
 *
 * Form fields (multipart/form-data):
 *   files       — One or more image files, ORDER PRESERVED (repeat the key).
 *   outputName  — Suggested filename for the result (default: images.pdf)
 *
 * Accepted image formats: PNG, JPEG, GIF, WebP, AVIF, TIFF (extension + magic-byte
 * validated). PNG/JPEG embed directly; GIF/WebP/AVIF/TIFF are transcoded internally.
 *
 * Returns the PDF as application/pdf binary.
 *
 * Errors:
 *   400 — no file, or an empty file
 *   413 — total upload exceeds the size cap
 *   415 — a file is not a supported image (bad extension or magic bytes), or the
 *         engine rejects the bytes as not a recognizable image
 *   500 — unexpected internal error (no stack trace exposed)
 */

import { NextResponse } from 'next/server';
import { imageToPdf, mergeUniversal } from '@giga-pdf/pdf-engine';
import { PDFEngineError } from '@giga-pdf/pdf-engine';
import type { UniversalMergeInput } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';

/** Total upload cap across all images (bounds peak memory during conversion). */
const MAX_TOTAL_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

/** Accepted image extensions (lowercase, without the dot). */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'tif', 'tiff']);

/**
 * Magic-byte signatures, by image kind. A file passes when it carries any of
 * these signatures, guarding against mis-named or hostile uploads before the
 * bytes reach the engine.
 */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const; // \x89PNG
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const; // SOI
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38] as const; // GIF8
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46] as const; // RIFF (WebP container)
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50] as const; // WEBP (at offset 8)
const FTYP_TAG = [0x66, 0x74, 0x79, 0x70] as const; // ftyp (at offset 4, AVIF)
const AVIF_BRAND = [0x61, 0x76, 0x69, 0x66] as const; // avif (at offset 8)
const TIFF_LE_MAGIC = [0x49, 0x49, 0x2a, 0x00] as const; // II*\0 (little-endian / Intel)
const TIFF_BE_MAGIC = [0x4d, 0x4d, 0x00, 0x2a] as const; // MM\0* (big-endian / Motorola)

/** Lowercase extension (without the dot) of a filename, or '' if none. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

/** Do the bytes at `offset` match the signature? */
function hasMagic(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

/** True when the bytes start with a recognized image signature. */
function isImageMagic(bytes: Uint8Array): boolean {
  if (hasMagic(bytes, PNG_MAGIC) || hasMagic(bytes, JPEG_MAGIC) || hasMagic(bytes, GIF_MAGIC)) {
    return true;
  }
  if (hasMagic(bytes, RIFF_MAGIC) && hasMagic(bytes, WEBP_TAG, 8)) return true; // WebP
  if (hasMagic(bytes, FTYP_TAG, 4) && hasMagic(bytes, AVIF_BRAND, 8)) return true; // AVIF
  if (hasMagic(bytes, TIFF_LE_MAGIC) || hasMagic(bytes, TIFF_BE_MAGIC)) return true; // TIFF
  return false;
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Request must be multipart/form-data.' },
        { status: 400 },
      );
    }

    const files = formData.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length < 1) {
      return NextResponse.json(
        { success: false, error: 'At least one image file is required (field name: files).' },
        { status: 400 },
      );
    }

    const emptyFile = files.find((f) => f.size === 0);
    if (emptyFile) {
      return NextResponse.json(
        { success: false, error: `File "${emptyFile.name || '(unnamed)'}" is empty.` },
        { status: 400 },
      );
    }

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_TOTAL_SIZE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `Combined upload exceeds the ${MAX_TOTAL_SIZE_BYTES / 1024 / 1024} MB limit.`,
        },
        { status: 413 },
      );
    }

    const outputName = (formData.get('outputName') as string | null) ?? 'images.pdf';

    // Read all bytes and validate each is a supported image (extension OR magic).
    const decoded = await Promise.all(
      files.map(async (f) => ({ file: f, bytes: new Uint8Array(await f.arrayBuffer()) })),
    );

    for (const { file, bytes } of decoded) {
      const ext = extensionOf(file.name);
      const extOk = IMAGE_EXTENSIONS.has(ext);
      if (!extOk && !isImageMagic(bytes)) {
        return NextResponse.json(
          {
            success: false,
            error: `File "${file.name || '(unnamed)'}" is not a supported image (PNG, JPEG, GIF, WebP, AVIF).`,
          },
          { status: 415 },
        );
      }
    }

    // Single image → direct one-page conversion. Multiple images → mergeUniversal,
    // which turns each image into a page and concatenates them in order.
    let pdfBytes: Uint8Array;
    if (decoded.length === 1) {
      pdfBytes = await imageToPdf(decoded[0]!.bytes);
    } else {
      const inputs: UniversalMergeInput[] = decoded.map(({ file, bytes }) => ({
        bytes,
        filename: file.name,
        mimeType: file.type,
      }));
      pdfBytes = await mergeUniversal(inputs);
    }

    serverLogger.info('[api/pdf/image-to-pdf] Conversion successful', {
      userId: authResult.context.userId,
      imageCount: files.length,
      outputBytes: pdfBytes.byteLength,
    });

    // Buffer.from is required: Next.js rejects Uint8Array<ArrayBufferLike> as BodyInit.
    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(outputName),
        'Content-Length': String(pdfBytes.byteLength),
      },
    });
  } catch (error: unknown) {
    // The engine throws when bytes are not a recognizable image, or a merged
    // image fails to convert — treat as a client-side bad-input problem (415).
    if (error instanceof PDFEngineError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 415 },
      );
    }

    serverLogger.error('[api/pdf/image-to-pdf] Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to convert the supplied images to PDF.' },
      { status: 500 },
    );
  }
}
