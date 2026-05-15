/**
 * PDF/A conversion route via MuPDF.
 *
 * POST /api/pdf/pdfa
 *
 * Form fields (multipart/form-data):
 *   file     — PDF file (required)
 *   variant  — "pdfa-1b" | "pdfa-1a" | "pdfa-2b" | "pdfa-2u" | "pdfa-3b"
 *              (default: "pdfa-2u" — recommended for most use cases)
 *
 * Returns the PDF/A-compliant PDF as application/pdf.
 *
 * Returns 422 with explanation if MuPDF refuses conversion (e.g. source
 * uses transparency on pdfa-1b, contains JavaScript, or embeds files on
 * pdfa-1b/2b which forbid them — fallback to pdfa-2u or pdfa-3b).
 */

import { NextResponse } from 'next/server';
import { convertToPdfA, PdfAConversionError } from '@giga-pdf/pdf-engine';
import type { PdfAVariant } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

const VALID_VARIANTS: PdfAVariant[] = [
  'pdfa-1b',
  'pdfa-1a',
  'pdfa-2b',
  'pdfa-2u',
  'pdfa-3b',
];

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const variant = ((formData.get('variant') as string | null) ?? 'pdfa-2u') as PdfAVariant;
    if (!VALID_VARIANTS.includes(variant)) {
      return NextResponse.json(
        {
          success: false,
          error: `variant must be one of: ${VALID_VARIANTS.join(', ')}.`,
        },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await convertToPdfA(new Uint8Array(arrayBuffer), variant);

    const renamed = file.name.replace(/\.pdf$/i, '') + '.pdfa.pdf';

    return new Response(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(renamed),
        'Content-Length': String(result.bytes.byteLength),
        'X-PDF-A-Variant': variant,
      },
    });
  } catch (error: unknown) {
    if (error instanceof PdfAConversionError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 422 },
      );
    }
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }
    serverLogger.error('api.pdf.pdfa', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'PDF/A conversion failed.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
