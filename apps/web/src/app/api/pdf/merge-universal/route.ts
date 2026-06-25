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
 *   ranges      — Optional per-file page selection, ONE entry per `files` entry
 *                 IN THE SAME ORDER (repeat the key). Each value is a page-range
 *                 string ("1-5,8", 1-based) or empty for the whole file. Omitting
 *                 the field entirely keeps the legacy "merge every page" behaviour.
 *   outputName  — Suggested filename for the result (default: merged.pdf)
 *
 * Returns the merged PDF as application/pdf binary.
 *
 * Errors:
 *   400 — fewer than one file, an empty file, a file that cannot be converted
 *         (the engine error already names every offending file), or an invalid
 *         page range (the message names the file + the offending range)
 *   413 — total upload exceeds the size cap
 *   415 — a file's type is not supported by the universal merge engine
 *   500 — unexpected internal error (no stack trace exposed)
 */

import { NextResponse } from 'next/server';
import { mergeUniversal, parsePageRange } from '@giga-pdf/pdf-engine';
import { PDFEngineError } from '@giga-pdf/pdf-engine';
// Type-only imports: erased at runtime, keep the unit-test engine mocks simple.
import type { UniversalMergeInput, PageRange } from '@giga-pdf/pdf-engine';
// The zero-dependency engine exposes `mergePdfs([{ pdf, pages }])` — the native
// primitive for assembling page selections. It is server-only here, externalised
// via `serverExternalPackages` and its wasm traced through `/api/pdf/**`.
import { GigaPdfEngine } from '@qrcommunication/gigapdf-lib';
import type { MergePart } from '@qrcommunication/gigapdf-lib';
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
  // A page-range string the caller supplied is malformed or out of bounds.
  'MERGE_RANGE_INVALID',
]);

/**
 * Memoised engine handle for the page-range path. Mirrors pdf-engine's own
 * `getEngine()` (which `loadDefault()` does NOT memoise): one wasm instance is
 * reused across requests in this long-lived server module.
 */
let mergeEnginePromise: Promise<GigaPdfEngine> | null = null;
function getMergeEngine(): Promise<GigaPdfEngine> {
  mergeEnginePromise ??= GigaPdfEngine.loadDefault();
  return mergeEnginePromise;
}

/** Flatten 1-based, inclusive page ranges into an ordered list of page numbers. */
function rangesToPages(ranges: PageRange[]): number[] {
  const pages: number[] = [];
  for (const range of ranges) {
    for (let p = range.start; p <= range.end; p++) pages.push(p);
  }
  return pages;
}

/**
 * Merge with per-file page selection. Each input is converted to PDF in isolation
 * (reusing `mergeUniversal([input])` — same detection/conversion as the bulk path,
 * a passthrough for PDFs), then assembled with the engine's native
 * `mergePdfs([{ pdf, pages }])`. An empty range string keeps the whole file.
 *
 * `ranges` is aligned 1:1 with `inputs` (same order); a non-empty entry is parsed
 * against the converted file's real page count, so an out-of-bounds page yields a
 * precise, client-safe error rather than a silently truncated result.
 *
 * @throws {PDFEngineError} `MERGE_RANGE_INVALID` for a malformed/out-of-range
 *   string, `MERGE_UNIVERSAL_CONVERT_FAILED` for a file that cannot be converted,
 *   `MERGE_UNIVERSAL_EMPTY_OUTPUT` if the assembled document has no pages.
 */
async function mergeWithRanges(
  inputs: UniversalMergeInput[],
  ranges: string[],
): Promise<Uint8Array> {
  const engine = await getMergeEngine();
  const parts: (Uint8Array | MergePart)[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    const pdf = await mergeUniversal([input]); // convert one → PDF bytes
    const rangeStr = (ranges[i] ?? '').trim();

    if (rangeStr === '') {
      parts.push(pdf); // whole file (every page)
      continue;
    }

    const doc = engine.open(pdf);
    let pages: number[];
    try {
      pages = rangesToPages(parsePageRange(rangeStr, doc.pageCount()));
    } catch (err) {
      const label = input.filename ?? `file #${i + 1}`;
      throw new PDFEngineError(
        `Invalid page range for "${label}": ${err instanceof Error ? err.message : String(err)}`,
        'MERGE_RANGE_INVALID',
      );
    } finally {
      doc.close();
    }
    parts.push({ pdf, pages });
  }

  const merged = engine.mergePdfs(parts);
  if (merged.length === 0) {
    throw new PDFEngineError('mergeUniversal produced an empty document', 'MERGE_UNIVERSAL_EMPTY_OUTPUT');
  }
  return merged;
}

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

    // Per-file page selection, aligned 1:1 with `files` by position. Absent or
    // all-empty → legacy "merge every page" path (unchanged behaviour).
    const rangesRaw = formData.getAll('ranges');
    const ranges = files.map((_, i) =>
      typeof rangesRaw[i] === 'string' ? (rangesRaw[i] as string) : '',
    );
    const hasAnyRange = ranges.some((r) => r.trim() !== '');

    // Build the engine inputs, preserving order. The filename is the primary
    // type hint (extension); MIME type is informational.
    const inputs: UniversalMergeInput[] = await Promise.all(
      files.map(async (f) => ({
        bytes: new Uint8Array(await f.arrayBuffer()),
        filename: f.name,
        mimeType: f.type,
      })),
    );

    const mergedBytes = hasAnyRange
      ? await mergeWithRanges(inputs, ranges)
      : await mergeUniversal(inputs);

    serverLogger.info('[api/pdf/merge-universal] Merge successful', {
      userId: authResult.context.userId,
      fileCount: files.length,
      withRanges: hasAnyRange,
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
