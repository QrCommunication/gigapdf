/**
 * Text-format → PDF Conversion Route
 *
 * POST /api/convert/text-format
 * Converts a text-based document (Markdown or CSV) to an editable PDF via the
 * in-house zero-dependency WASM engine (`mdToModel`/`csvToModel` → `modelToPdf`).
 *
 * Accepted formats (by extension, case-insensitive):
 *   - Markdown : .md, .markdown   → convertMarkdownToPdf
 *   - CSV      : .csv             → convertCsvToPdf
 *
 * These are plain UTF-8 text files with no binary container, so there is no
 * magic-byte check (unlike /api/office/upload). Validation is extension + size.
 *
 * Request: multipart/form-data
 *   file — the binary text document
 *
 * Returns: application/pdf binary (pure conversion — caller uploads to storage)
 *
 * Errors:
 *   400 — missing/invalid file, unsupported extension
 *   413 — file too large
 *   422 — conversion failure (e.g. an empty/malformed CSV with no fields)
 *   500 — unhandled error
 */

import { NextResponse } from 'next/server';
import { convertMarkdownToPdf, convertCsvToPdf, PDFEngineError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { serverLogger } from '@/lib/server-logger';
import { sanitizeContentDisposition } from '@/lib/content-disposition';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 250 * 1024 * 1024; // 250 MB (mirrors the storage backend cap)

/** Text-format extensions accepted by this route, mapped to their converter. */
const CONVERTERS = {
  md: convertMarkdownToPdf,
  markdown: convertMarkdownToPdf,
  csv: convertCsvToPdf,
} as const satisfies Record<string, (bytes: Uint8Array) => Promise<Uint8Array>>;

type TextFormat = keyof typeof CONVERTERS;

const ALLOWED_EXTENSIONS_LABEL = '.md, .markdown, .csv';

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

/** Type guard: is this extension one of the accepted text formats? */
function isTextFormat(ext: string): ext is TextFormat {
  return Object.hasOwn(CONVERTERS, ext);
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

    if (!isTextFormat(ext)) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported file extension "${ext || '(none)'}". Allowed: ${ALLOWED_EXTENSIONS_LABEL}.`,
        },
        { status: 400 },
      );
    }

    // ── Read buffer and convert ─────────────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const baseName = basenameWithoutExt(filename);
    const outputFilename = `${baseName}.pdf`;

    serverLogger.info('[api/convert/text-format] Starting text→PDF conversion', {
      userId,
      filename,
      format: ext,
      sizeBytes: file.size,
    });

    const pdfBytes = await CONVERTERS[ext](buffer);

    serverLogger.info('[api/convert/text-format] Conversion successful', {
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
    // PDFEngineError = a conversion failure (e.g. an empty/malformed CSV with no
    // parseable fields). Treat it as a 422 (unprocessable content), not a 500.
    if (error instanceof PDFEngineError) {
      serverLogger.warn('[api/convert/text-format] Conversion failed', {
        error: error.message,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to convert the document to PDF.' },
        { status: 422 },
      );
    }

    serverLogger.error('[api/convert/text-format] Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred during conversion.' },
      { status: 500 },
    );
  }
}
