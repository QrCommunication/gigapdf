/**
 * Native Optional Content Group (OCG / "PDF layers") mutations via the WASM
 * engine (`@qrcommunication/gigapdf-lib`).
 *
 * Native engine path. Real `/OCG` objects are toggled (visibility/locked) or
 * removed in the document's `/OCProperties` so readers honour them natively.
 * Each op targets a layer by its numeric OCG `id` (read via `doc.layers()` and
 * surfaced to the editor as `LayerObject.ocgId`).
 *
 * This is a thin, dedicated mutator (mirrors `native-annotations.ts`) so the
 * editor can drive OCG state WITHOUT touching the heavyweight element
 * redact+add pipeline (`apply-operations.ts`).
 */

import { getEngine } from '../wasm';
import { engineLogger } from '../utils/logger';

/** A single OCG-layer mutation, addressed by the native numeric OCG id. */
export interface OcgLayerOperation {
  /**
   * `visibility`: show/hide the group; `locked`: lock/unlock it (UI hint stored
   * in `/OCProperties`); `remove`: drop the OCG and unwrap its marked content.
   */
  action: 'visibility' | 'locked' | 'remove';
  /** Numeric OCG id (from `doc.layers()[].id`). */
  ocgId: number;
  /** Target boolean for `visibility` / `locked` (ignored for `remove`). */
  value?: boolean;
}

export interface ApplyOcgOperationsResult {
  /** Final PDF bytes after every OCG mutation. */
  bytes: Uint8Array;
  /** Number of operations the engine reported as applied. */
  applied: number;
}

/**
 * Apply a batch of OCG-layer mutations to a PDF. Operations the engine rejects
 * (unknown id, unsupported) are skipped and logged; the function never throws
 * across the boundary. Returns the (possibly unchanged) bytes + applied count.
 */
export async function applyOcgOperations(
  pdfBytes: Uint8Array,
  operations: OcgLayerOperation[],
): Promise<ApplyOcgOperationsResult> {
  if (operations.length === 0) {
    return { bytes: pdfBytes, applied: 0 };
  }

  const giga = await getEngine();
  const doc = giga.open(pdfBytes);
  try {
    let applied = 0;
    for (const op of operations) {
      let ok = false;
      switch (op.action) {
        case 'visibility':
          ok = doc.setLayerVisibility(op.ocgId, op.value ?? true);
          break;
        case 'locked':
          ok = doc.setLayerLocked(op.ocgId, op.value ?? false);
          break;
        case 'remove':
          ok = doc.removeLayer(op.ocgId);
          break;
      }
      if (ok) applied++;
      else {
        engineLogger.warn('ocg-layers: operation skipped (engine rejected)', {
          action: op.action,
          ocgId: op.ocgId,
        });
      }
    }

    const bytes = doc.saveCompressed();
    engineLogger.info('ocg-layers: applied OCG mutations', {
      requested: operations.length,
      applied,
      outputBytes: bytes.byteLength,
    });
    return { bytes, applied };
  } finally {
    doc.close();
  }
}
