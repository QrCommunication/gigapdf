/**
 * Image → PDF Conversion Route
 *
 * POST /api/convert/image
 * Converts a raster image to a single-page editable PDF via the in-house
 * zero-dependency WASM engine (`imageToPdf`). The image is centred and scaled
 * to fit an A4 portrait page; the source format is auto-detected by the engine.
 *
 * Accepted formats (by extension, case-insensitive; re-checked by magic bytes):
 *   - PNG  : .png            (\x89PNG)
 *   - JPEG : .jpg, .jpeg     (FF D8 FF)
 *   - GIF  : .gif            (GIF8)
 *   - WebP : .webp           (RIFF…WEBP)
 *   - AVIF : .avif           (…ftyp…avif)
 *   - TIFF : .tif, .tiff     (II*\0 / MM\0*)
 *
 * Request: multipart/form-data
 *   file — the binary image
 *
 * Returns: application/pdf binary (pure conversion — caller uploads to storage)
 *
 * Errors:
 *   400 — missing/invalid file, unsupported extension, magic-byte mismatch
 *   413 — file too large
 *   422 — conversion failure (unrecognized/corrupt image content)
 *   500 — unhandled error
 */

import { NextResponse } from 'next/server';
import { imageToPdf, PDFEngineError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { serverLogger } from '@/lib/server-logger';
import { sanitizeContentDisposition } from '@/lib/content-disposition';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 250 * 1024 * 1024; // 250 MB (mirrors the storage backend cap)

/** Image extensions this route accepts (mirrors the engine's supported formats). */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'tif', 'tiff']);

const ALLOWED_EXTENSIONS_LABEL = '.png, .jpg, .jpeg, .gif, .webp, .avif, .tif, .tiff';

// Magic byte signatures (offset-aware for container formats). Mirrors the
// sniffing used by the engine's universal-merge detector.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const; // \x89PNG
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const; // JFIF/EXIF SOI
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38] as const; // GIF8
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46] as const; // RIFF
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50] as const; // WEBP (at offset 8)
const FTYP_TAG = [0x66, 0x74, 0x79, 0x70] as const; // ftyp (at offset 4)
const AVIF_BRAND = [0x61, 0x76, 0x69, 0x66] as const; // avif (at offset 8)
const TIFF_LE_MAGIC = [0x49, 0x49, 0x2a, 0x00] as const; // II*\0 (little-endian / Intel)
const TIFF_BE_MAGIC = [0x4d, 0x4d, 0x00, 0x2a] as const; // MM\0* (big-endian / Motorola)

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extracts the lowercase extension from a filename, without the leading dot.
 * Returns an empty string if no extension is found.
 */
function extractExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Strips the extension from a filename to use as the base for the output PDF name.
 * Falls back to 'image' if the name has no extension or is empty.
 */
function basenameWithoutExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return filename || 'image';
  return filename.slice(0, dot);
}

/** Do the first `sig` bytes (at `offset`) of `bytes` match the given signature? */
function hasMagic(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

/** Sniff whether the buffer is a supported raster image (PNG/JPEG/GIF/WebP/AVIF/TIFF). */
function isImageMagic(bytes: Uint8Array): boolean {
  if (hasMagic(bytes, PNG_MAGIC) || hasMagic(bytes, JPEG_MAGIC) || hasMagic(bytes, GIF_MAGIC)) {
    return true;
  }
  // WebP: "RIFF"...."WEBP"
  if (hasMagic(bytes, RIFF_MAGIC) && hasMagic(bytes, WEBP_TAG, 8)) return true;
  // AVIF: ....ftyp....avif
  if (hasMagic(bytes, FTYP_TAG, 4) && hasMagic(bytes, AVIF_BRAND, 8)) return true;
  // TIFF: "II*\0" (little-endian) or "MM\0*" (big-endian)
  if (hasMagic(bytes, TIFF_LE_MAGIC) || hasMagic(bytes, TIFF_BE_MAGIC)) return true;
  return false;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  const { userId } = authResult.context;

  try {
    // ── Parse multipart form data ───────────────────────────────────────────
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Request must be multipart/form-data.' },
        { status: 400 },
      );
    }

    const file = formData.get('file');

    // FormData.get() returns string | File | null; reject anything that is
    // not a File (null or a plain string field with the name "file").
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: file.' },
        { status: 400 },
      );
    }

    // ── Size validation ─────────────────────────────────────────────────────
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          success: false,
          error: `File too large. Maximum allowed size is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
        },
        { status: 413 },
      );
    }

    // ── Extension validation ────────────────────────────────────────────────
    const filename = file.name ?? '';
    const ext = extractExtension(filename);

    if (!IMAGE_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported file extension "${ext || '(none)'}". Allowed: ${ALLOWED_EXTENSIONS_LABEL}.`,
        },
        { status: 400 },
      );
    }

    // ── Read buffer and validate magic bytes ────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    if (!isImageMagic(buffer)) {
      return NextResponse.json(
        {
          success: false,
          error: 'File does not appear to be a valid image (invalid magic bytes).',
        },
        { status: 400 },
      );
    }

    const baseName = basenameWithoutExt(filename);
    const outputFilename = `${baseName}.pdf`;

    serverLogger.info('[api/convert/image] Starting image → PDF conversion', {
      userId,
      filename,
      format: ext,
      sizeBytes: file.size,
    });

    const pdfBytes = await imageToPdf(buffer);

    serverLogger.info('[api/convert/image] Conversion successful', {
      userId,
      filename,
      outputSizeBytes: pdfBytes.byteLength,
    });

    // ── Return PDF binary ───────────────────────────────────────────────────
    // Wrap in Buffer (Node.js subclass of Uint8Array) so the Response body
    // accepts it as BodyInit without TypeScript narrowing issues with the
    // Uint8Array<ArrayBufferLike> generic.
    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(outputFilename),
        'Content-Length': String(pdfBytes.byteLength),
      },
    });
  } catch (error: unknown) {
    // PDFEngineError = a conversion failure (unrecognized / corrupt image bytes).
    // Treat it as a 422 (unprocessable content), not a 500.
    if (error instanceof PDFEngineError) {
      serverLogger.warn('[api/convert/image] Conversion failed', {
        error: error.message,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to convert the image to PDF.' },
        { status: 422 },
      );
    }

    serverLogger.error('[api/convert/image] Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred during conversion.' },
      { status: 500 },
    );
  }
}
