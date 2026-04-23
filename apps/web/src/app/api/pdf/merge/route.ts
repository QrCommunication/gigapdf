/**
 * PDF Merge route
 *
 * POST /api/pdf/merge
 * Merges two or more PDF files into a single document.
 *
 * Form fields (multipart/form-data):
 *   files[]    — Two or more PDF files (required, repeat the key per file)
 *   ranges[]   — Optional page-range string per file, e.g. "1-5" (repeat
 *                per file; use "" or omit to include all pages)
 *   outputName — Suggested filename for the merged PDF (default: merged.pdf)
 *
 * Returns the merged PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import { mergePDFs, parsePageRange } from '@giga-pdf/pdf-engine';
import { PDFCorruptedError } from '@giga-pdf/pdf-engine';
import type { MergeOptions } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { MAX_FILE_SIZE_BYTES } from '@/lib/request-validation';

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const files = formData.getAll('files[]') as File[];
    if (files.length < 2 || files.some((f) => !(f instanceof File))) {
      return NextResponse.json(
        { success: false, error: 'At least two PDF files are required (field name: files[]).' },
        { status: 400 },
      );
    }

    // Validate each file: non-empty + size cap
    for (const f of files) {
      if (f.size === 0) {
        return NextResponse.json(
          { success: false, error: `File "${f.name}" is empty.` },
          { status: 400 },
        );
      }
      if (f.size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          {
            success: false,
            error: `File "${f.name}" exceeds the ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB size limit.`,
          },
          { status: 413 },
        );
      }
    }

    const rangeStrings = formData.getAll('ranges[]') as string[];
    const outputName = (formData.get('outputName') as string | null) ?? 'merged.pdf';

    // Convert files to Buffers
    const buffers = await Promise.all(
      files.map(async (f) => Buffer.from(await f.arrayBuffer())),
    );

    // Build per-document PageRange options from range strings.
    // Use a high sentinel page count; mergePDFs validates against actual counts.
    const MAX_PAGES = 100000;
    const pageRanges: MergeOptions['pageRanges'] = buffers.map((_: Buffer, i: number) => {
      const rangeStr = rangeStrings[i] ?? '';
      if (!rangeStr) return null;
      try {
        return parsePageRange(rangeStr, MAX_PAGES);
      } catch {
        return null;
      }
    });

    const hasRanges = pageRanges.some((r) => r !== null);
    const mergedBytes = await mergePDFs(buffers, hasRanges ? { pageRanges } : undefined);

    return new Response(new Uint8Array(mergedBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(outputName),
        'Content-Length': String(mergedBytes.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'One or more PDF files are corrupted.' },
        { status: 422 },
      );
    }

    serverLogger.error('api.pdf.merge', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to merge PDF documents.' },
      { status: 500 },
    );
  }
}
