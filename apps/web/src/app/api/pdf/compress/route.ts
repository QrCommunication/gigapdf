/**
 * PDF Compression route.
 *
 * POST /api/pdf/compress
 *
 * Form fields (multipart/form-data):
 *   file — PDF file (required)
 *
 * Pipeline: pdf-lib round-trip (openDocument → saveDocument, normalises the
 * structure + object streams) then MuPDF post-pass via optimizeAndSave
 * (garbage=4, compress=yes, sanitize=yes, linearize=yes) — the combo that
 * yields -15 to -25% on real-world documents.
 *
 * Returns the compressed PDF as application/pdf with size headers:
 *   X-Original-Size   — input size in bytes
 *   X-Compressed-Size — output size in bytes
 */

import { NextResponse } from 'next/server';
import {
  openDocument,
  saveDocument,
  optimizeAndSave,
  PDFCorruptedError,
  PDFEncryptedError,
  PDFParseError,
} from '@giga-pdf/pdf-engine';
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

    const arrayBuffer = await file.arrayBuffer();
    const originalSize = arrayBuffer.byteLength;

    // 1. pdf-lib round-trip: re-serialises with object streams, drops
    //    incremental-update tails and normalises the xref structure.
    const handle = await openDocument(Buffer.from(arrayBuffer));
    const pdfLibBytes = await saveDocument(handle, {
      useObjectStreams: true,
    });

    // 2. MuPDF post-pass: garbage=4 (dedupe + drop unreferenced objects),
    //    compress=yes (re-deflate streams), sanitize + linearize (fast web
    //    view). Falls back to the pdf-lib bytes if MuPDF chokes.
    const optimized = await optimizeAndSave(new Uint8Array(pdfLibBytes), {
      linearize: true,
    });

    serverLogger.info('api.pdf.compress', {
      originalSize,
      compressedSize: optimized.bytes.byteLength,
      mupdfOptimized: optimized.optimized,
    });

    return new Response(Buffer.from(optimized.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(optimized.bytes.byteLength),
        'X-Original-Size': String(originalSize),
        'X-Compressed-Size': String(optimized.bytes.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof PDFEncryptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF is encrypted — decrypt it before compressing.' },
        { status: 422 },
      );
    }
    if (error instanceof PDFCorruptedError || error instanceof PDFParseError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }
    serverLogger.error('api.pdf.compress', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to compress PDF.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
