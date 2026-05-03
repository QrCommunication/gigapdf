/**
 * Office → PDF Conversion Route
 *
 * POST /api/office/upload
 * Converts a DOCX, XLSX, or PPTX file to PDF via LibreOffice headless.
 *
 * Request: multipart/form-data
 *   file — the binary Office document (.docx, .xlsx, or .pptx)
 *
 * Validation:
 *   - File required (400)
 *   - Extension must be .docx | .xlsx | .pptx, case-insensitive (400)
 *   - First 4 bytes must be ZIP magic (PK\x03\x04) (400)
 *   - Size limit: 25 MB (413)
 *
 * Returns: application/pdf binary (pure conversion — caller uploads to storage)
 *
 * Errors:
 *   400 — missing/invalid file
 *   413 — file too large
 *   422 — LibreOffice conversion failure
 *   503 — LibreOffice binary unavailable
 *   500 — unhandled error
 */

import { NextResponse } from 'next/server';
import {
  convertOfficeToPdf,
  LibreOfficeUnavailableError,
  LibreOfficeConversionError,
} from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { serverLogger } from '@/lib/server-logger';
import { sanitizeContentDisposition } from '@/lib/content-disposition';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

/** ZIP magic bytes shared by DOCX, XLSX, and PPTX (all OOXML containers). */
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

const ALLOWED_EXTENSIONS = new Set(['docx', 'xlsx', 'pptx']);

type AllowedFormat = 'docx' | 'xlsx' | 'pptx';

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
 * Falls back to 'document' if the name has no extension or is empty.
 */
function basenameWithoutExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return filename || 'document';
  return filename.slice(0, dot);
}

/**
 * Validates that the first 4 bytes of the buffer match ZIP magic (PK\x03\x04).
 * All OOXML formats (DOCX, XLSX, PPTX) are ZIP archives.
 */
function hasZipMagic(buffer: Uint8Array): boolean {
  if (buffer.length < 4) return false;
  for (let i = 0; i < 4; i++) {
    if (buffer[i] !== ZIP_MAGIC[i]) return false;
  }
  return true;
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

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported file extension "${ext || '(none)'}". Allowed: .docx, .xlsx, .pptx.`,
        },
        { status: 400 },
      );
    }

    // ── Read buffer and validate magic bytes ────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    if (!hasZipMagic(buffer)) {
      return NextResponse.json(
        {
          success: false,
          error: 'File does not appear to be a valid Office document (invalid magic bytes).',
        },
        { status: 400 },
      );
    }

    const sourceFormat = ext as AllowedFormat;
    const baseName = basenameWithoutExt(filename);
    const outputFilename = `${baseName}.pdf`;

    serverLogger.info('[api/office/upload] Starting Office→PDF conversion', {
      userId,
      filename,
      sourceFormat,
      sizeBytes: file.size,
    });

    // ── Conversion ──────────────────────────────────────────────────────────
    const pdfBytes = await convertOfficeToPdf(buffer, sourceFormat);

    serverLogger.info('[api/office/upload] Conversion successful', {
      userId,
      filename,
      outputSizeBytes: pdfBytes.byteLength,
    });

    // ── Return PDF binary ───────────────────────────────────────────────────
    // Wrap in Buffer (Node.js subclass of Uint8Array) so the Response body
    // accepts it as BodyInit without TypeScript narrowing issues with
    // SharedArrayBuffer vs ArrayBuffer in the Uint8Array generic type param.
    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(outputFilename),
        'Content-Length': String(pdfBytes.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof LibreOfficeUnavailableError) {
      serverLogger.error('[api/office/upload] LibreOffice binary not found', {
        error,
      });
      return NextResponse.json(
        { success: false, error: 'Office conversion service is currently unavailable.' },
        { status: 503 },
      );
    }

    if (error instanceof LibreOfficeConversionError) {
      serverLogger.warn('[api/office/upload] LibreOffice conversion failed', {
        error,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to convert Office document to PDF.' },
        { status: 422 },
      );
    }

    serverLogger.error('[api/office/upload] Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred during conversion.' },
      { status: 500 },
    );
  }
}
