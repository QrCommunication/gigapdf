/**
 * Universal save optimizer — runs the pdf-lib serialization output through
 * MuPDF for object garbage-collection, stream compression, sanitization and
 * linearization (fast web view).
 *
 * Why a separate pass rather than passing options to pdf-lib:
 *   - pdf-lib's `save()` does not expose linearization at all.
 *   - pdf-lib's `useObjectStreams` reduces size somewhat but doesn't
 *     compete with MuPDF's `garbage=4` + `compress=yes` combo (-15 to -25%
 *     observed on real-world invoices).
 *   - Linearization moves the cross-reference table to the front of the
 *     file and reorders objects so a PDF reader can render the first page
 *     while the rest is still streaming. Significant for >5 MB documents
 *     served over HTTP — browser previewer paints sooner.
 *
 * This helper is lazy: MuPDF is `await import`-ed only when called, so the
 * wasm runtime cost is paid only on the save path that opts in (every
 * apply-elements flow does via `applyOperations`; the bare /api/pdf/save
 * route opts in too, see route handler).
 */

import { engineLogger } from '../utils/logger';

export interface OptimizeSaveOptions {
  /** Skip MuPDF post-pass and return pdf-lib bytes as-is. Defaults to false. */
  skipMupdf?: boolean;
  /** Linearize the output (fast web view). Defaults to true. */
  linearize?: boolean;
}

export interface OptimizeSaveResult {
  bytes: Uint8Array;
  /** True if MuPDF actually processed the bytes; false on fallback. */
  optimized: boolean;
  inputBytes: number;
  outputBytes: number;
}

export async function optimizeAndSave(
  pdfLibBytes: Uint8Array,
  options: OptimizeSaveOptions = {},
): Promise<OptimizeSaveResult> {
  const { skipMupdf = false, linearize = true } = options;

  if (skipMupdf) {
    return {
      bytes: pdfLibBytes,
      optimized: false,
      inputBytes: pdfLibBytes.byteLength,
      outputBytes: pdfLibBytes.byteLength,
    };
  }

  try {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(
      pdfLibBytes,
      'application/pdf',
    ) as unknown as InstanceType<typeof mupdf.PDFDocument>;

    const saveOpts = linearize
      ? 'garbage=4,compress=yes,sanitize=yes,linearize=yes'
      : 'garbage=4,compress=yes,sanitize=yes';

    const buf = doc.saveToBuffer(saveOpts);
    const bytes = buf.asUint8Array();

    engineLogger.info('optimize-save: pdf optimized via mupdf', {
      inputBytes: pdfLibBytes.byteLength,
      outputBytes: bytes.byteLength,
      ratio: Number((bytes.byteLength / pdfLibBytes.byteLength).toFixed(2)),
      linearize,
    });

    return {
      bytes,
      optimized: true,
      inputBytes: pdfLibBytes.byteLength,
      outputBytes: bytes.byteLength,
    };
  } catch (err) {
    engineLogger.warn('optimize-save: mupdf optimization failed, returning pdf-lib bytes', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      bytes: pdfLibBytes,
      optimized: false,
      inputBytes: pdfLibBytes.byteLength,
      outputBytes: pdfLibBytes.byteLength,
    };
  }
}
