/**
 * PDF OCR route — runs Tesseract on each rasterised page.
 *
 * POST /api/pdf/ocr
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   pages      — JSON array of 1-based page numbers (optional, default all)
 *   lang       — Tesseract language code (default "fra+eng")
 *   dpi        — 144 | 200 | 300 (default 144)
 *   format     — "text" | "hocr" (default "text")
 *
 * Returns JSON:
 *   {
 *     success: true,
 *     pages: [{ pageNumber, text, hocr? }, ...],
 *     fullText: string
 *   }
 *
 * Returns 503 if tesseract is not installed on the server.
 */

import { NextResponse } from 'next/server';
import { ocrPdf, TesseractNotInstalledError, isTesseractAvailable } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError } from '@giga-pdf/pdf-engine';
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

    const lang = (formData.get('lang') as string | null) ?? 'fra+eng';
    if (!/^[a-z]+(\+[a-z]+)*$/.test(lang)) {
      return NextResponse.json(
        { success: false, error: 'lang must match the tesseract format e.g. "fra+eng".' },
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

    const format = ((formData.get('format') as string | null) ?? 'text') as 'text' | 'hocr';
    if (format !== 'text' && format !== 'hocr') {
      return NextResponse.json(
        { success: false, error: 'format must be "text" or "hocr".' },
        { status: 400 },
      );
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
    if (error instanceof TesseractNotInstalledError) {
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
  const available = await isTesseractAvailable();
  return NextResponse.json({ available });
}
