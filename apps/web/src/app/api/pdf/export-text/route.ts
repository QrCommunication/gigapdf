/**
 * PDF → Markdown / CSV / EPUB Export route
 *
 * POST /api/pdf/export-text
 * Lowers an uploaded PDF into the engine's unified, format-neutral document
 * model (`toModel`) and raises it to the requested reflowable target, entirely
 * via the in-house zero-dependency WASM engine (`@qrcommunication/gigapdf-lib`).
 * No third-party library, no Python round-trip.
 *
 * Conversion matrix (all via the model path `toModel` → `modelTo*`):
 *   markdown — exportPdfToMarkdown  → text/markdown
 *   csv      — exportPdfToCsv       → text/csv
 *   epub     — exportPdfToEpub      → application/epub+zip
 *
 * Request: multipart/form-data
 *   file   — the binary PDF (validated by `%PDF` magic bytes)
 *   format — 'markdown' | 'csv' | 'epub'
 *
 * Responses:
 *   200  — Binary/text file (attachment, correct Content-Type)
 *   400  — Missing / invalid body, bad format, or non-PDF magic bytes
 *   401  — Unauthenticated
 *   413  — File too large
 *   422  — Conversion failed (PDFEngineError — unparseable PDF / empty result)
 *   500  — Unhandled error
 */

import 'server-only';

import { NextResponse } from 'next/server';
import {
  exportPdfToMarkdown,
  exportPdfToCsv,
  exportPdfToEpub,
  PDFEngineError,
} from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { serverLogger } from '@/lib/server-logger';
import { sanitizeContentDisposition } from '@/lib/content-disposition';

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 250 * 1024 * 1024; // 250 MB — matches /api/office/upload

/** PDF magic bytes (`%PDF`). */
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

/** Output descriptor per supported text/ebook export format. */
const FORMAT_OUTPUT = {
  markdown: { extension: 'md', contentType: 'text/markdown;charset=utf-8' },
  csv: { extension: 'csv', contentType: 'text/csv;charset=utf-8' },
  epub: { extension: 'epub', contentType: 'application/epub+zip' },
} as const;

type ExportTextFormat = keyof typeof FORMAT_OUTPUT;

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Type guard: is `value` one of the supported export formats? */
function isExportTextFormat(value: unknown): value is ExportTextFormat {
  return typeof value === 'string' && Object.hasOwn(FORMAT_OUTPUT, value);
}

/** Validate that `buffer` starts with the expected magic bytes. */
function hasMagic(buffer: Uint8Array, magic: Uint8Array): boolean {
  if (buffer.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buffer[i] !== magic[i]) return false;
  }
  return true;
}

/** Strip the extension from a filename for use as the output base name. */
function basenameWithoutExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return filename || 'document';
  return filename.slice(0, dot);
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  const { userId } = authResult.context;

  // ── Parse multipart form data ──────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Request must be multipart/form-data.' },
      { status: 400 },
    );
  }

  // ── Validate format field ──────────────────────────────────────────────────
  const format = formData.get('format');
  if (!isExportTextFormat(format)) {
    return NextResponse.json(
      { success: false, error: "format must be one of: 'markdown', 'csv', 'epub'." },
      { status: 400 },
    );
  }

  // ── Validate file field ────────────────────────────────────────────────────
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { success: false, error: 'Missing required field: file.' },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      {
        success: false,
        error: `File too large. Maximum allowed size is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
      },
      { status: 413 },
    );
  }

  // ── Read bytes + validate PDF magic ────────────────────────────────────────
  const arrayBuffer = await file.arrayBuffer();
  const pdfBytes = new Uint8Array(arrayBuffer);
  if (!hasMagic(pdfBytes, PDF_MAGIC)) {
    return NextResponse.json(
      { success: false, error: 'File does not appear to be a valid PDF (invalid magic bytes).' },
      { status: 400 },
    );
  }

  serverLogger.info('[api/pdf/export-text] Export request received', {
    userId,
    format,
    sizeBytes: pdfBytes.byteLength,
  });

  // ── Convert via the unified model path (toModel → modelTo*) ─────────────────
  let bytes: Uint8Array;
  try {
    if (format === 'epub') {
      bytes = await exportPdfToEpub(pdfBytes);
    } else {
      const text =
        format === 'markdown'
          ? await exportPdfToMarkdown(pdfBytes)
          : await exportPdfToCsv(pdfBytes);
      bytes = new TextEncoder().encode(text);
    }
  } catch (err: unknown) {
    if (err instanceof PDFEngineError) {
      serverLogger.warn('[api/pdf/export-text] Conversion failed', {
        userId,
        format,
        error: err.message,
      });
      return NextResponse.json(
        { success: false, error: `Export to ${format.toUpperCase()} failed: ${err.message}` },
        { status: 422 },
      );
    }
    serverLogger.error('[api/pdf/export-text] Unexpected conversion error', {
      userId,
      format,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred during export.' },
      { status: 500 },
    );
  }

  // ── Return binary/text attachment ──────────────────────────────────────────
  const { extension, contentType } = FORMAT_OUTPUT[format];
  const filename = `${basenameWithoutExt(file.name ?? '')}.${extension}`;
  const contentDisposition = sanitizeContentDisposition(filename, 'attachment');

  serverLogger.info('[api/pdf/export-text] Export successful', {
    userId,
    format,
    outputSizeBytes: bytes.byteLength,
  });

  // Wrap in Buffer so TypeScript accepts it as BodyInit across lib targets
  // (Next.js strict Fetch types reject the looser Uint8Array<ArrayBufferLike>).
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': contentDisposition,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
