/**
 * PDF → Office Export route
 *
 * POST /api/office/export
 * Fetches a session document's PDF bytes from the Python backend, then
 * converts the file to the requested Office format (docx, xlsx, pptx, odt,
 * odp) using the pdf-engine package.
 *
 * Conversion matrix:
 *   docx  — LibreOffice writer_pdf_import     (convertPdfToOffice)
 *   odt   — LibreOffice writer_pdf_import     (convertPdfToOffice)
 *   pptx  — LibreOffice impress_pdf_import    (convertPdfToOffice)
 *   odp   — LibreOffice impress_pdf_import    (convertPdfToOffice)
 *   xlsx  — pdfjs + exceljs extraction        (convertPdfToXlsx — dynamic import)
 *
 * Note on xlsx: LibreOffice headless does not support PDF → XLSX (structural
 * limitation). A dedicated convertPdfToXlsx implementation based on pdfjs text
 * extraction + exceljs is loaded via dynamic import so this file type-checks
 * even when the symbol has not yet been added to the pdf-engine barrel.
 *
 * Request:
 *   Content-Type: application/json
 *   Cookie / Authorization: Better Auth session (validated by requireSession)
 *   Body: { documentId: string, format: 'docx' | 'xlsx' | 'pptx' | 'odt' | 'odp' }
 *
 * Responses:
 *   200  — Binary Office file (stream)
 *   400  — Missing / invalid body
 *   401  — Unauthenticated
 *   404  — Document session not found in Python backend
 *   422  — Conversion failed (LibreOfficeConversionError)
 *   503  — LibreOffice binary unavailable on the server
 *   504  — Python backend timed out
 */

import 'server-only';

import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  convertPdfToOffice,
  LibreOfficeUnavailableError,
  LibreOfficeConversionError,
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

// MIME types per export format (OOXML + OpenDocument)
const CONTENT_TYPE_MAP = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  odp: 'application/vnd.oasis.opendocument.presentation',
} as const;

// ─── Zod schema ────────────────────────────────────────────────────────────────

const RequestBodySchema = z.object({
  documentId: z
    .string({ error: 'documentId is required and must be a string' })
    .min(1, 'documentId cannot be empty'),
  format: z.enum(['docx', 'xlsx', 'pptx', 'odt', 'odp'], {
    error: "format must be one of: 'docx', 'xlsx', 'pptx', 'odt', 'odp'",
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

  // ── 3.5 Flatten interactive widgets + annotations BEFORE handing the
  //        PDF to LibreOffice / pdfjs. Without this, libreoffice can render
  //        an editable AcroForm widget AND its baked appearance, producing
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

  // ── 4. Convert PDF to the requested Office format ────────────────────────────
  serverLogger.info('[api/office/export] Starting conversion', { documentId, format });

  let outputBytes: Uint8Array;
  try {
    if (format === 'xlsx') {
      // Dynamic import so the route compiles even before convertPdfToXlsx is
      // added to the pdf-engine barrel (the xlsx implementation is being
      // developed in parallel). At runtime both must be present.
      const { convertPdfToXlsx } = (await import('@giga-pdf/pdf-engine') as unknown) as {
        convertPdfToXlsx: (buf: Uint8Array) => Promise<Uint8Array>;
      };
      outputBytes = await convertPdfToXlsx(pdfBytes);
    } else {
      // format is 'docx' | 'pptx' | 'odt' | 'odp' — handled by LibreOffice headless
      outputBytes = await convertPdfToOffice(pdfBytes, format);
    }
  } catch (err: unknown) {
    if (err instanceof LibreOfficeUnavailableError) {
      serverLogger.error('[api/office/export] LibreOffice binary not available', {
        documentId,
        format,
      });
      return jsonError(
        'Office conversion is temporarily unavailable. LibreOffice is not installed on this server.',
        503,
      );
    }

    if (err instanceof LibreOfficeConversionError) {
      serverLogger.warn('[api/office/export] LibreOffice conversion failed', {
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
  const filename = `document-${documentId.slice(0, 8)}.${format}`;
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
