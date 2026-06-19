/**
 * OCR block extraction route (#85 — semantic search ingestion).
 *
 * POST /api/pdf/ocr-page
 *
 * Runs the built-in WASM OCR engine on the uploaded PDF and returns the
 * recognized text as blocks with bounding boxes in PDF user space (points),
 * ready to POST verbatim to the backend ingestion endpoint
 * `POST /api/v1/storage/documents/{id}/ocr-blocks`.
 *
 * The editor sends its in-memory PDF blob (the single source of truth), so no
 * S3 round-trip is needed.
 *
 * NOTE on scope: the backend ingestion is a document-level REPLACE (it wipes
 * the existing index for the document and inserts what it receives). The
 * "Index OCR" action therefore OCRs the WHOLE document by default (`page`
 * omitted) so the resulting index stays complete and consistent. A specific
 * `page` may be supplied for targeted use, but callers must then send the full
 * block set they want to keep.
 *
 * Form fields (multipart/form-data):
 *   file        — PDF file (required)
 *   page        — 1-based page number (optional; omit = all pages)
 *   dpi         — 144 | 200 | 300 (optional, default 144)
 *   granularity — "line" (default) | "word"
 *
 * Returns (200) JSON:
 *   {
 *     success: true,
 *     page: number | null,
 *     blocks: [{ page, bbox: { x, y, w, h }, text }],
 *     pagesProcessed: number
 *   }
 *
 * Error codes:
 *   400  — bad request (invalid file, page, dpi, granularity)
 *   401  — unauthenticated
 *   422  — PDF corrupted
 *   500  — OCR failed
 *   503  — OCR engine unavailable
 */

import { NextResponse } from 'next/server';
import {
  extractOcrBlocks,
  OcrUnavailableError,
  PDFCorruptedError,
} from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    // `page` is optional: omit it to OCR the whole document (the default for
    // the index action, since the backend replaces the document's index).
    const pageRaw = formData.get('page');
    let page: number | null = null;
    if (pageRaw !== null && String(pageRaw).length > 0) {
      page = Number(pageRaw);
      if (!Number.isInteger(page) || page < 1) {
        return NextResponse.json(
          { success: false, error: 'page must be a positive integer (1-based).' },
          { status: 400 },
        );
      }
    }

    const dpiRaw = formData.get('dpi') as string | null;
    const dpi = dpiRaw ? Number(dpiRaw) : 144;
    if (![144, 200, 300].includes(dpi)) {
      return NextResponse.json(
        { success: false, error: 'dpi must be 144, 200 or 300.' },
        { status: 400 },
      );
    }

    const granularity = ((formData.get('granularity') as string | null) ??
      'line') as 'line' | 'word';
    if (granularity !== 'line' && granularity !== 'word') {
      return NextResponse.json(
        { success: false, error: 'granularity must be "line" or "word".' },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await extractOcrBlocks(new Uint8Array(arrayBuffer), {
      ...(page !== null ? { pages: [page] } : {}),
      dpi: dpi as 144 | 200 | 300,
      granularity,
    });

    return NextResponse.json({
      success: true,
      page,
      blocks: result.blocks,
      pagesProcessed: result.pagesProcessed,
    });
  } catch (error: unknown) {
    if (error instanceof OcrUnavailableError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 503 },
      );
    }
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }
    serverLogger.error('api.pdf.ocr-page', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'OCR failed.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
