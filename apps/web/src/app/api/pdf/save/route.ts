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

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();

    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: file' },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const garbageRaw = formData.get('garbage');
    const garbage = garbageRaw !== null ? (Number(garbageRaw) as 0 | 1 | 2 | 3 | 4) : 0;
    const useObjectStreams = formData.get('useObjectStreams') !== 'false';

    const handle = await openDocument(buffer);
    const savedBytes = await saveDocument(handle, { garbage, useObjectStreams });

    return new Response(savedBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${file.name}"`,
        'Content-Length': String(savedBytes.byteLength),
      },
    });
  } catch (error) {
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

    console.error('[api/pdf/save]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save PDF document.' },
      { status: 500 },
    );
  }
}
