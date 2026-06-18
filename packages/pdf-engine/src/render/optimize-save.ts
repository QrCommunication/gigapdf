/**
 * Save optimizer — re-serialises a PDF with every stream Flate-compressed via
 * the WASM engine (`@qrcommunication/gigapdf-lib`).
 *
 * Native recompression pass (dedupe + drop unreferenced objects, re-deflate
 * streams). Linearization (fast web view) is not performed by the engine; the
 * `linearize` option is kept for signature compatibility but ignored.
 */

import { getEngine } from '../wasm';
import { engineLogger } from '../utils/logger';

export interface OptimizeSaveOptions {
  /** Skip the optimization pass and return the input bytes as-is. */
  skipRecompress?: boolean;
  /** Reserved for compatibility (the engine does not linearize). */
  linearize?: boolean;
}

export interface OptimizeSaveResult {
  bytes: Uint8Array;
  /** True if the engine actually re-compressed the bytes; false on fallback. */
  optimized: boolean;
  inputBytes: number;
  outputBytes: number;
}

export async function optimizeAndSave(
  pdfLibBytes: Uint8Array,
  options: OptimizeSaveOptions = {},
): Promise<OptimizeSaveResult> {
  const { skipRecompress = false } = options;

  if (skipRecompress) {
    return {
      bytes: pdfLibBytes,
      optimized: false,
      inputBytes: pdfLibBytes.byteLength,
      outputBytes: pdfLibBytes.byteLength,
    };
  }

  try {
    const giga = await getEngine();
    const doc = giga.open(pdfLibBytes);
    try {
      const bytes = doc.saveCompressed();
      engineLogger.info('optimize-save: pdf re-compressed via wasm engine', {
        inputBytes: pdfLibBytes.byteLength,
        outputBytes: bytes.byteLength,
        ratio: Number((bytes.byteLength / Math.max(1, pdfLibBytes.byteLength)).toFixed(2)),
      });
      return {
        bytes,
        optimized: true,
        inputBytes: pdfLibBytes.byteLength,
        outputBytes: bytes.byteLength,
      };
    } finally {
      doc.close();
    }
  } catch (err) {
    engineLogger.warn('optimize-save: optimization failed, returning input bytes', {
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
