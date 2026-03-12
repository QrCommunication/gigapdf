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

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();

    const files = formData.getAll('files[]') as File[];
    if (files.length < 2 || files.some((f) => !(f instanceof File))) {
      return NextResponse.json(
        { success: false, error: 'At least two PDF files are required (field name: files[]).' },
        { status: 400 },
      );
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
    const pageRanges: MergeOptions['pageRanges'] = buffers.map((_, i) => {
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

    return new Response(mergedBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${outputName}"`,
        'Content-Length': String(mergedBytes.byteLength),
      },
    });
  } catch (error) {
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'One or more PDF files are corrupted.' },
        { status: 422 },
      );
    }

    console.error('[api/pdf/merge]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to merge PDF documents.' },
      { status: 500 },
    );
  }
}
