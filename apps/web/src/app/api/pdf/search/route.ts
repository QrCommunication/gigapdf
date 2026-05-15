/**
 * PDF Search route — full-text search via MuPDF.
 *
 * POST /api/pdf/search
 *
 * Form fields (multipart/form-data):
 *   file       — PDF file (required)
 *   needle     — Search query string (required, non-empty)
 *   pages      — JSON array of 1-based page numbers (optional, defaults to all)
 *   maxHitsPerPage — Integer cap, default 500
 *
 * Returns JSON:
 *   {
 *     needle, totalHits, pagesSearched,
 *     hits: [{ pageNumber, matchIndex, quads, bbox }, ...]
 *   }
 *
 * Quads and bbox are in PDF user-space (origin bottom-left). The caller is
 * responsible for converting to web coordinates if highlighting on a
 * Fabric overlay.
 */

import { NextResponse } from 'next/server';
import { searchPdf } from '@giga-pdf/pdf-engine';
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

    const needle = (formData.get('needle') as string | null)?.trim();
    if (!needle) {
      return NextResponse.json(
        { success: false, error: 'needle is required and must be non-empty.' },
        { status: 400 },
      );
    }

    let pages: number[] | undefined;
    const pagesRaw = formData.get('pages') as string | null;
    if (pagesRaw) {
      try {
        const parsed = JSON.parse(pagesRaw);
        if (
          Array.isArray(parsed) &&
          parsed.every((p) => Number.isInteger(p) && p >= 1)
        ) {
          pages = parsed;
        } else {
          throw new Error('Invalid pages array');
        }
      } catch {
        return NextResponse.json(
          { success: false, error: 'pages must be a JSON array of positive integers.' },
          { status: 400 },
        );
      }
    }

    const maxHitsRaw = formData.get('maxHitsPerPage') as string | null;
    const maxHitsPerPage = maxHitsRaw ? Number(maxHitsRaw) : undefined;
    if (
      maxHitsPerPage !== undefined &&
      (!Number.isInteger(maxHitsPerPage) || maxHitsPerPage < 1 || maxHitsPerPage > 5000)
    ) {
      return NextResponse.json(
        { success: false, error: 'maxHitsPerPage must be an integer between 1 and 5000.' },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await searchPdf(new Uint8Array(arrayBuffer), needle, {
      pages,
      maxHitsPerPage,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }
    serverLogger.error('api.pdf.search', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to search PDF.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
