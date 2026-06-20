/**
 * Office → PDF Conversion Route
 *
 * POST /api/office/upload
 * Converts an Office document to PDF via LibreOffice headless.
 *
 * Accepted formats:
 *   - OOXML        : .docx, .xlsx, .pptx          (ZIP container)
 *   - Office 97-2003: .doc, .xls, .ppt            (OLE2 container)
 *   - OpenDocument : .odt, .ods, .odp             (ZIP container)
 *
 * Request: multipart/form-data
 *   file — the binary Office document
 *
 * Validation:
 *   - File required (400)
 *   - Extension must be one of the accepted formats, case-insensitive (400)
 *   - Magic bytes must match the container family of the extension (400):
 *       ZIP  (PK\x03\x04)                          → docx/xlsx/pptx/odt/ods/odp
 *       OLE2 (\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1)    → doc/xls/ppt
 *   - Size limit: 250 MB (413)
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
// Type-only import: erased at runtime, keeps unit-test mocks of the engine simple
// while letting tsc enforce route ⊆ engine format compatibility.
import type { OfficeImportFormat } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { serverLogger } from '@/lib/server-logger';
import { sanitizeContentDisposition } from '@/lib/content-disposition';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 250 * 1024 * 1024; // 250 MB

/** ZIP magic bytes shared by OOXML (docx/xlsx/pptx) and ODF (odt/ods/odp). */
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

/** OLE2 / Compound File magic bytes shared by legacy Office (doc/xls/ppt). */
const OLE2_MAGIC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * Expected container magic per accepted extension.
 * Record<OfficeImportFormat, …> keeps this table exhaustive: adding a format
 * to the engine without mapping its magic here fails type-check.
 */
const MAGIC_BY_FORMAT: Record<OfficeImportFormat, Uint8Array> = {
  docx: ZIP_MAGIC,
  xlsx: ZIP_MAGIC,
  pptx: ZIP_MAGIC,
  doc: OLE2_MAGIC,
  xls: OLE2_MAGIC,
  ppt: OLE2_MAGIC,
  odt: ZIP_MAGIC,
  ods: ZIP_MAGIC,
  odp: ZIP_MAGIC,
};

const ALLOWED_EXTENSIONS_LABEL =
  '.doc, .docx, .xls, .xlsx, .ppt, .pptx, .odt, .ods, .odp';

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

/** Type guard: is this extension one of the accepted Office import formats? */
function isAllowedFormat(ext: string): ext is OfficeImportFormat {
  return Object.hasOwn(MAGIC_BY_FORMAT, ext);
}

/**
 * Validates that the buffer starts with the expected magic bytes.
 * OOXML/ODF files are ZIP archives (PK\x03\x04); legacy Office 97-2003 files
 * are OLE2 compound files (\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1).
 */
function hasMagic(buffer: Uint8Array, magic: Uint8Array): boolean {
  if (buffer.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buffer[i] !== magic[i]) return false;
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

    if (!isAllowedFormat(ext)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported file extension "${ext || '(none)'}". Allowed: ${ALLOWED_EXTENSIONS_LABEL}.`,
        },
        { status: 400 },
      );
    }

    // ── Read buffer and validate magic bytes (per container family) ─────────
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    if (!hasMagic(buffer, MAGIC_BY_FORMAT[ext])) {
      return NextResponse.json(
        {
          success: false,
          error: 'File does not appear to be a valid Office document (invalid magic bytes).',
        },
        { status: 400 },
      );
    }

    const sourceFormat: OfficeImportFormat = ext;
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
