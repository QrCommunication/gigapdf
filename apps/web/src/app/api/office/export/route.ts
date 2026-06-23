/**
 * PDF → document Export route
 *
 * POST /api/office/export
 * Fetches a session document's PDF bytes from the Python backend, then converts
 * the file to the requested target format using the in-house zero-dependency
 * `@giga-pdf/pdf-engine` (which wraps the `@qrcommunication/gigapdf-lib` WASM
 * engine). Every target is produced server-side — there is no client-side WASM
 * path — so the editor's export menu and these standalone tools share the exact
 * same engine code.
 *
 * Conversion matrix:
 *   docx | pptx | odt | odp  — convertPdfToOffice (model → office)
 *   xlsx                     — convertPdfToXlsx (tabular extraction)
 *   ods                      — exportPdfToOds (doc.toOds() spreadsheet binary)
 *   markdown                 — exportPdfToMarkdown (model → GFM text)
 *   csv                      — exportPdfToCsv (model → RFC 4180 text)
 *   epub                     — exportPdfToEpub (model → epub+zip binary)
 *   html                     — exportPdfToHtml (model → standalone HTML text)
 *   rtf                      — exportPdfToRtf (model → RTF text)
 *   txt                      — exportPdfToText (doc.toText() plain text)
 *
 * Note on xlsx: PDF → XLSX is not a direct conversion (a PDF is not a
 * spreadsheet). A dedicated convertPdfToXlsx implementation based on text
 * extraction is used.
 *
 * Request:
 *   Content-Type: application/json
 *   Cookie / Authorization: Better Auth session (validated by requireSession)
 *   Body: { documentId: string, format: ExportFormat }
 *
 * Responses:
 *   200  — Binary/text document (stream)
 *   400  — Missing / invalid body
 *   401  — Unauthenticated
 *   404  — Document session not found in Python backend
 *   422  — Conversion failed (OfficeConversionError / PDFEngineError)
 *   504  — Python backend timed out
 */

import 'server-only';

import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  convertPdfToOffice,
  exportPdfToMarkdown,
  exportPdfToCsv,
  exportPdfToEpub,
  exportPdfToHtml,
  exportPdfToRtf,
  exportPdfToText,
  exportPdfToOds,
  OfficeConversionError,
  PDFEngineError,
  openDocument,
  saveDocument,
  flattenForms,
  flattenAnnotations,
} from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { serverLogger } from '@/lib/server-logger';
import { sanitizeContentDisposition } from '@/lib/content-disposition';

// ─── Constants ─────────────────────────────────────────────────────────────────

const PYTHON_BACKEND_URL =
  process.env.PYTHON_BACKEND_URL ??
  (process.env.NODE_ENV === 'production'
    ? 'http://127.0.0.1:8000'
    : 'http://localhost:8000');

const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Every target this route can produce, ordered office → text → ebook. */
const EXPORT_FORMATS = [
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'markdown',
  'csv',
  'epub',
  'html',
  'rtf',
  'txt',
] as const;

type ExportFormat = (typeof EXPORT_FORMATS)[number];

// MIME types per export format (OOXML + OpenDocument + text/ebook targets).
const CONTENT_TYPE_MAP: Record<ExportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  markdown: 'text/markdown;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  epub: 'application/epub+zip',
  html: 'text/html;charset=utf-8',
  rtf: 'application/rtf',
  txt: 'text/plain;charset=utf-8',
};

// File extension per format (usually the key, except markdown → md).
const EXTENSION_MAP: Record<ExportFormat, string> = {
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
  odt: 'odt',
  ods: 'ods',
  odp: 'odp',
  markdown: 'md',
  csv: 'csv',
  epub: 'epub',
  html: 'html',
  rtf: 'rtf',
  txt: 'txt',
};

/**
 * Lower the (flattened) PDF bytes into `format`, returning bytes ready for the
 * Response body. Text targets are UTF-8 encoded here so the caller treats every
 * format uniformly. Throws OfficeConversionError / PDFEngineError on failure.
 */
async function convertTo(format: ExportFormat, pdfBytes: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  switch (format) {
    case 'docx':
    case 'pptx':
    case 'odt':
    case 'odp':
      return convertPdfToOffice(pdfBytes, format);
    case 'xlsx': {
      // Dynamic import so the route compiles even before convertPdfToXlsx is
      // added to the pdf-engine barrel (the xlsx implementation evolves
      // independently). At runtime the symbol must be present.
      const { convertPdfToXlsx } = (await import('@giga-pdf/pdf-engine') as unknown) as {
        convertPdfToXlsx: (buf: Uint8Array) => Promise<Uint8Array>;
      };
      return convertPdfToXlsx(pdfBytes);
    }
    case 'ods':
      return exportPdfToOds(pdfBytes);
    case 'markdown':
      return encoder.encode(await exportPdfToMarkdown(pdfBytes));
    case 'csv':
      return encoder.encode(await exportPdfToCsv(pdfBytes));
    case 'epub':
      return exportPdfToEpub(pdfBytes);
    case 'html':
      return encoder.encode(await exportPdfToHtml(pdfBytes));
    case 'rtf':
      return encoder.encode(await exportPdfToRtf(pdfBytes));
    case 'txt':
      return encoder.encode(await exportPdfToText(pdfBytes));
    default: {
      // Exhaustiveness guard — a new ExportFormat must be handled above.
      const never: never = format;
      throw new Error(`Unsupported export format: ${String(never)}`);
    }
  }
}

// ─── Zod schema ────────────────────────────────────────────────────────────────

const RequestBodySchema = z.object({
  documentId: z
    .string({ error: 'documentId is required and must be a string' })
    .min(1, 'documentId cannot be empty'),
  format: z.enum(EXPORT_FORMATS, {
    error: `format must be one of: ${EXPORT_FORMATS.join(', ')}`,
  }),
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  // ── 1. Authentication ────────────────────────────────────────────────────────
  const authResult = await requireSession();
  if (!authResult.ok) {
    return authResult.response;
  }
  const { userId } = authResult.context;

  // ── 2. Parse and validate request body ──────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError('Request body must be valid JSON.', 400);
  }

  const parsed = RequestBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid request body.', details: fieldErrors }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { documentId, format } = parsed.data;

  serverLogger.info('[api/office/export] Export request received', {
    userId,
    documentId,
    format,
  });

  // ── 3. Fetch PDF bytes from Python backend ───────────────────────────────────
  const downloadUrl = `${PYTHON_BACKEND_URL}/api/v1/documents/${documentId}/download`;

  // Forward the incoming Authorization header (Bearer JWT) so Python can
  // validate the caller owns this document session.
  const authHeader = request.headers.get('Authorization');
  const forwardHeaders: Record<string, string> = {};
  if (authHeader) {
    forwardHeaders['Authorization'] = authHeader;
  }

  let pdfBytes: Uint8Array;
  try {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), DOWNLOAD_TIMEOUT_MS);

    let pythonResponse: globalThis.Response;
    try {
      pythonResponse = await fetch(downloadUrl, {
        method: 'GET',
        headers: forwardHeaders,
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (pythonResponse.status === 404) {
      serverLogger.warn('[api/office/export] Document session not found in Python', {
        documentId,
      });
      return jsonError(
        `Document session '${documentId}' not found. It may have expired or never existed.`,
        404,
      );
    }

    if (!pythonResponse.ok) {
      const body = await pythonResponse.text().catch(() => '');
      serverLogger.error('[api/office/export] Unexpected error from Python backend', {
        documentId,
        status: pythonResponse.status,
        body: body.slice(0, 500),
      });
      return jsonError('Failed to retrieve PDF from backend.', 504);
    }

    const arrayBuffer = await pythonResponse.arrayBuffer();
    pdfBytes = new Uint8Array(arrayBuffer);

    serverLogger.info('[api/office/export] PDF bytes received from Python', {
      documentId,
      sizeBytes: pdfBytes.byteLength,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      serverLogger.error('[api/office/export] Python backend timeout', {
        documentId,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
      });
      return jsonError('Backend timed out while retrieving PDF.', 504);
    }

    serverLogger.error('[api/office/export] Network error contacting Python backend', {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonError('Failed to connect to backend.', 504);
  }

  // ── 3.5 Flatten interactive widgets + annotations BEFORE the WASM
  //        conversion / pdfjs extraction. Without this, an editable AcroForm
  //        widget AND its baked appearance can both be rendered, producing
  //        duplicated cells / labels in the resulting docx/pptx; for xlsx,
  //        pdfjs would emit two text items at the same position.
  try {
    const handle = await openDocument(Buffer.from(pdfBytes));
    flattenForms(handle);
    flattenAnnotations(handle);
    const flattened = await saveDocument(handle);
    pdfBytes = new Uint8Array(flattened);
    serverLogger.info('[api/office/export] PDF flattened before conversion', {
      documentId,
      flattenedSizeBytes: pdfBytes.byteLength,
    });
  } catch (err: unknown) {
    // Non-fatal: degraded export still works on the unflattened bytes,
    // duplication may reappear but the user gets a file. Log so we notice
    // recurring failures.
    serverLogger.warn('[api/office/export] Flatten step failed, exporting raw PDF', {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 4. Convert PDF to the requested target format ────────────────────────────
  serverLogger.info('[api/office/export] Starting conversion', { documentId, format });

  let outputBytes: Uint8Array;
  try {
    outputBytes = await convertTo(format, pdfBytes);
  } catch (err: unknown) {
    // Both engine error families map to 422 (unprocessable): the request was
    // well-formed but the PDF could not be converted to this target.
    if (err instanceof OfficeConversionError || err instanceof PDFEngineError) {
      serverLogger.warn('[api/office/export] Conversion failed', {
        documentId,
        format,
        error: (err as Error).message,
      });
      return jsonError(
        `Conversion to ${format.toUpperCase()} failed: ${(err as Error).message}`,
        422,
      );
    }

    // Generic error (covers convertPdfToXlsx failures too)
    serverLogger.error('[api/office/export] Unexpected conversion error', {
      documentId,
      format,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonError('An unexpected error occurred during conversion.', 500);
  }

  serverLogger.info('[api/office/export] Conversion successful', {
    documentId,
    format,
    outputSizeBytes: outputBytes.byteLength,
  });

  // ── 5. Return binary response with correct Content-Type / Content-Disposition
  const filename = `document-${documentId.slice(0, 8)}.${EXTENSION_MAP[format]}`;
  const contentDisposition = sanitizeContentDisposition(filename, 'attachment');

  // Wrap in Buffer so TypeScript accepts it as BodyInit across lib targets
  return new Response(Buffer.from(outputBytes), {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPE_MAP[format],
      'Content-Disposition': contentDisposition,
      'Content-Length': String(outputBytes.byteLength),
      // Prevent caches from storing the binary — each export is on-demand
      'Cache-Control': 'no-store',
    },
  });
}
