/**
 * Real PDF content-stream redaction via the WASM engine
 * (`@qrcommunication/gigapdf-lib`).
 *
 * Native engine path. The engine physically
 * removes any content (text / image / path) intersecting each target rectangle
 * from the page stream — no cosmetic overlay, so the original bytes never leak
 * on copy-paste or after flatten. Callers pass PDF user-space bounds (origin
 * bottom-left), so no Y-flip is required here.
 */

import { getEngine } from '../wasm';
import { engineLogger } from '../utils/logger';

export interface RedactionTarget {
  /** 1-based page number */
  pageNumber: number;
  /** PDF coordinate-space rectangle to redact (origin bottom-left). */
  bounds: { x: number; y: number; width: number; height: number };
}

export interface ApplyRedactionsResult {
  bytes: Uint8Array;
  /** Number of redaction targets actually applied (<= targets.length). */
  applied: number;
  /** Pages that received at least one redaction. */
  pagesAffected: number;
}

export async function applyRedactions(
  pdfBytes: Uint8Array,
  targets: RedactionTarget[],
): Promise<ApplyRedactionsResult> {
  if (targets.length === 0) {
    return { bytes: pdfBytes, applied: 0, pagesAffected: 0 };
  }

  const giga = await getEngine();
  const doc = giga.open(pdfBytes);
  try {
    const totalPages = doc.pageCount();
    const pagesAffected = new Set<number>();
    let applied = 0;
    for (const t of targets) {
      if (t.pageNumber < 1 || t.pageNumber > totalPages) {
        engineLogger.warn('redact: page out of range, skipped', {
          pageNumber: t.pageNumber,
          pageCount: totalPages,
        });
        continue;
      }
      // Default: no opaque cover — only remove the underlying content bytes.
      const removed = doc.redact(t.pageNumber, t.bounds.x, t.bounds.y, t.bounds.width, t.bounds.height);
      if (removed >= 0) {
        applied++;
        pagesAffected.add(t.pageNumber);
      }
    }

    const bytes = doc.saveCompressed();
    engineLogger.info('redact: redactions applied', {
      targetsRequested: targets.length,
      redactionsApplied: applied,
      pagesAffected: pagesAffected.size,
      inputBytes: pdfBytes.byteLength,
      outputBytes: bytes.byteLength,
    });
    return { bytes, applied, pagesAffected: pagesAffected.size };
  } finally {
    doc.close();
  }
}
