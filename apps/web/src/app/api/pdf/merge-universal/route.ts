/**
 * Universal Merge route — the flagship "combine anything into one PDF" tool.
 *
 * POST /api/pdf/merge-universal
 * Accepts a heterogeneous list of files (PDF, image, Office, HTML, RTF, plain
 * text), converts each to PDF in the order given, and concatenates them into a
 * single PDF.
 *
 * Form fields (multipart/form-data):
 *   files       — Two or more files to merge, ORDER PRESERVED (repeat the key
 *                 per file). One file is also accepted (it is simply converted).
 *   outputName  — Suggested filename for the result (default: merged.pdf)
 *
 * Returns the merged PDF as application/pdf binary.
 *
 * Errors:
 *   400 — fewer than one file, an empty file, or a file that cannot be
 *         converted (the engine error already names every offending file)
 *   413 — total upload exceeds the size cap
 *   415 — a file's type is not supported by the universal merge engine
 *   500 — unexpected internal error (no stack trace exposed)
 */

import { NextResponse } from 'next/server';
import { mergeUniversal } from '@giga-pdf/pdf-engine';
import { PDFEngineError } from '@giga-pdf/pdf-engine';
// Type-only import: erased at runtime, keeps unit-test mocks of the engine simple.
import type { UniversalMergeInput } from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';

/**
 * Total upload cap across all files. The universal merge converts every input
 * to PDF in memory, so this bounds peak memory and conversion time. Kept below
 * the per-file PDF limit (250 MB) because the work here is N-way conversion.
 */
const MAX_TOTAL_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Engine error codes that signal a client-side problem (a file the caller sent
 * cannot be turned into a PDF) → 400, with the engine's descriptive message
 * (it already aggregates and names every offending file).
 */
const CLIENT_ERROR_CODES = new Set([
  'MERGE_UNIVERSAL_EMPTY_INPUT',
  'MERGE_UNIVERSAL_CONVERT_FAILED',
  'MERGE_UNIVERSAL_EMPTY_OUTPUT',
]);

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Request must be multipart/form-data.' },
        { status: 400 },
      );
    }

    const files = formData.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length < 1) {
      return NextResponse.json(
        { success: false, error: 'At least one file is required (field name: files).' },
        { status: 400 },
      );
    }

    // Reject empty files early with a precise message.
    const emptyFile = files.find((f) => f.size === 0);
    if (emptyFile) {
      return NextResponse.json(
        { success: false, error: `File "${emptyFile.name || '(unnamed)'}" is empty.` },
        { status: 400 },
      );
    }

    // Enforce the total upload cap.
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_TOTAL_SIZE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `Combined upload exceeds the ${MAX_TOTAL_SIZE_BYTES / 1024 / 1024} MB limit.`,
        },
        { status: 413 },
      );
    }

    const outputName = (formData.get('outputName') as string | null) ?? 'merged.pdf';

    // Build the engine inputs, preserving order. The filename is the primary
    // type hint (extension); MIME type is informational.
    const inputs: UniversalMergeInput[] = await Promise.all(
      files.map(async (f) => ({
        bytes: new Uint8Array(await f.arrayBuffer()),
        filename: f.name,
        mimeType: f.type,
      })),
    );

    const mergedBytes = await mergeUniversal(inputs);

    serverLogger.info('[api/pdf/merge-universal] Merge successful', {
      userId: authResult.context.userId,
      fileCount: files.length,
      totalInputBytes: totalSize,
      outputBytes: mergedBytes.byteLength,
    });

    // Buffer.from is required: Next.js rejects Uint8Array<ArrayBufferLike> as BodyInit.
    return new Response(Buffer.from(mergedBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(outputName),
        'Content-Length': String(mergedBytes.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof PDFEngineError && CLIENT_ERROR_CODES.has(error.code)) {
      // The engine message names every file it could not convert — safe to surface.
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }

    serverLogger.error('[api/pdf/merge-universal] Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to merge the supplied files.' },
      { status: 500 },
    );
  }
}
