/**
 * PDF Save route
 *
 * POST /api/pdf/save
 * Accepts a PDF file and optional save options, returns the (re-)saved PDF bytes.
 * Useful to normalise / garbage-collect a PDF before further processing.
 *
 * Form fields:
 *   file              — PDF file (required)
 *   garbage           — 0-4, compaction level (default 0)
 *   useObjectStreams   — "true" | "false" (default true)
 */

import { NextResponse } from 'next/server';
import { openDocument, saveDocument } from '@giga-pdf/pdf-engine';
import { PDFEncryptedError, PDFCorruptedError } from '@giga-pdf/pdf-engine';
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
    const buffer = Buffer.from(arrayBuffer);

    const garbageRaw = formData.get('garbage');
    const garbage = garbageRaw !== null ? (Number(garbageRaw) as 0 | 1 | 2 | 3 | 4) : 0;
    const useObjectStreams = formData.get('useObjectStreams') !== 'false';

    const handle = await openDocument(buffer);
    const savedBytes = await saveDocument(handle, { garbage, useObjectStreams });

    return new Response(new Uint8Array(savedBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(savedBytes.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof PDFEncryptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF is encrypted. Cannot save without password.' },
        { status: 422 },
      );
    }
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    serverLogger.error('api.pdf.save', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to save PDF document.' },
      { status: 500 },
    );
  }
}
