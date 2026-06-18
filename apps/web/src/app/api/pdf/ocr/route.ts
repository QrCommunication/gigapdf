/**
 * PDF OCR route — runs the built-in WASM OCR engine on each rasterised page.
 *
 * POST /api/pdf/ocr
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   output     — "text" (default) | "searchable"
 *                "text"       → JSON with the extracted text per page
 *                "searchable" → PDF binary with an INVISIBLE text layer
 *                               drawn over every image-only page (the PDF
 *                               becomes selectable/searchable). `pages` is
 *                               ignored in this mode — page selection is
 *                               automatic (pages without extractable text,
 *                               or all pages with force=true).
 *   pages      — JSON array of 1-based page numbers (optional, default all;
 *                output="text" only)
 *   lang       — OCR language hint (default "fra+eng"; output="text" only,
 *                kept for compatibility — the engine is script-based)
 *   dpi        — 144 | 200 | 300 (default 144)
 *   format     — "text" | "hocr" (default "text"; output="text" only)
 *   force      — "true" to OCR every page even those that already contain
 *                extractable text (output="searchable" only)
 *
 * Returns (output="text") JSON:
 *   {
 *     success: true,
 *     pages: [{ pageNumber, text, hocr? }, ...],
 *     fullText: string
 *   }
 *
 * Returns (output="searchable") the PDF binary (application/pdf) with:
 *   X-Ocr-Pages-Processed — number of pages that went through OCR
 *   X-Ocr-Words-Added     — number of invisible words written
 *
 * Returns 503 if the OCR engine is unavailable.
 */

import { NextResponse } from 'next/server';
import {
  ocrPdf,
  makeSearchablePdf,
  OcrUnavailableError,
  isOcrAvailable,
} from '@giga-pdf/pdf-engine';
import { PDFCorruptedError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
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

    const lang = (formData.get('lang') as string | null) ?? 'fra+eng';
    if (!/^[a-z]+(\+[a-z]+)*$/.test(lang)) {
      return NextResponse.json(
        { success: false, error: 'lang must match the OCR format e.g. "fra+eng".' },
        { status: 400 },
      );
    }

    const dpiRaw = formData.get('dpi') as string | null;
    const dpi = dpiRaw ? Number(dpiRaw) : 144;
    if (![144, 200, 300].includes(dpi)) {
      return NextResponse.json(
        { success: false, error: 'dpi must be 144, 200 or 300.' },
        { status: 400 },
      );
    }

    const output = ((formData.get('output') as string | null) ?? 'text') as
      | 'text'
      | 'searchable';
    if (output !== 'text' && output !== 'searchable') {
      return NextResponse.json(
        { success: false, error: 'output must be "text" or "searchable".' },
        { status: 400 },
      );
    }

    const format = ((formData.get('format') as string | null) ?? 'text') as 'text' | 'hocr';
    if (format !== 'text' && format !== 'hocr') {
      return NextResponse.json(
        { success: false, error: 'format must be "text" or "hocr".' },
        { status: 400 },
      );
    }

    // ─── Searchable output: invisible text layer, PDF binary response ──────
    if (output === 'searchable') {
      const force = (formData.get('force') as string | null) === 'true';
      const arrayBuffer = await file.arrayBuffer();
      const result = await makeSearchablePdf(new Uint8Array(arrayBuffer), {
        dpi: dpi as 144 | 200 | 300,
        force,
      });

      return new Response(Buffer.from(result.bytes), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': sanitizeContentDisposition(file.name),
          'Content-Length': String(result.bytes.byteLength),
          'X-Ocr-Pages-Processed': String(result.pagesProcessed),
          'X-Ocr-Words-Added': String(result.wordsAdded),
        },
      });
    }

    let pages: number[] | undefined;
    const pagesRaw = formData.get('pages') as string | null;
    if (pagesRaw) {
      try {
        const parsed = JSON.parse(pagesRaw);
        if (Array.isArray(parsed) && parsed.every((p) => Number.isInteger(p) && p >= 1)) {
          pages = parsed;
        } else {
          throw new Error('Invalid pages');
        }
      } catch {
        return NextResponse.json(
          { success: false, error: 'pages must be a JSON array of positive integers.' },
          { status: 400 },
        );
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await ocrPdf(new Uint8Array(arrayBuffer), {
      pages,
      lang,
      dpi: dpi as 144 | 200 | 300,
      format,
    });

    return NextResponse.json({ success: true, ...result });
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
    serverLogger.error('api.pdf.ocr', { error });
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

// GET /api/pdf/ocr/availability — frontend uses this to enable/disable the OCR button.
export async function GET(): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;
  const available = await isOcrAvailable();
  return NextResponse.json({ available });
}
