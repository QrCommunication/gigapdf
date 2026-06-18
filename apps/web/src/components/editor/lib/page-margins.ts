/**
 * page-margins.ts
 *
 * Client-side helpers for the Word-like editor's draggable page margins.
 *
 * Margins are an intrinsic property of the PDF (the gap between a page's
 * `/CropBox` and `/MediaBox`), read and written through the GigaPDF engine
 * ({@link loadPdfEngine}) — the same single wasm instance that rasterises page
 * backgrounds, so we never load a second engine.
 *
 *   - {@link readAllPageMargins} opens the document once and reads every page's
 *     margins (PDF points). Called when the backing binary changes.
 *   - {@link applyPageMargins} opens the document, insets one page's CropBox to
 *     the requested margins, and returns the re-serialised bytes. The caller
 *     feeds those bytes back into the editor's single source of truth
 *     (`currentPdfFile`) exactly like any other full-binary page operation.
 *
 * Page indices in this module's PUBLIC API are 0-based (matching the editor's
 * page array); the engine is 1-based, so we add 1 at the boundary.
 *
 * No React, no DOM — trivially unit-testable with an injected engine loader.
 */

import { loadPdfEngine } from "@giga-pdf/canvas";
import type { PageMargins } from "@qrcommunication/gigapdf-lib";

export type { PageMargins };

/** Loader for the shared GigaPDF engine; injectable for tests. */
type EngineLoader = typeof loadPdfEngine;

/** Normalise PDF bytes to a `Uint8Array` the engine can open. */
function toBytes(source: ArrayBuffer | Uint8Array): Uint8Array {
  return source instanceof Uint8Array ? source : new Uint8Array(source);
}

/**
 * Read the margins (PDF points) of every page in `source`.
 *
 * Returns one entry per page, in document order. An entry is `null` when the
 * engine cannot determine that page's margins (it never throws for a single
 * page), so callers can fall back to "no guides" for it.
 */
export async function readAllPageMargins(
  source: ArrayBuffer | Uint8Array,
  loadEngine: EngineLoader = loadPdfEngine,
): Promise<Array<PageMargins | null>> {
  const engine = await loadEngine();
  const doc = engine.open(toBytes(source));
  try {
    const count = doc.pageCount();
    const out: Array<PageMargins | null> = [];
    for (let i = 1; i <= count; i += 1) {
      try {
        out.push(doc.pageMargins(i));
      } catch {
        out.push(null);
      }
    }
    return out;
  } finally {
    doc.close();
  }
}

/**
 * Apply `margins` (PDF points) to the 0-based `pageIndex` of `source` and return
 * the re-serialised PDF bytes. Throws if the page is out of range or the engine
 * rejects the change; the caller is expected to surface that as an error toast.
 *
 * The result is copied into a freshly-allocated `ArrayBuffer`-backed view so it
 * is a `Uint8Array<ArrayBuffer>` — directly usable as a `BlobPart` in the
 * browser (the engine's `save()` returns the looser `Uint8Array<ArrayBufferLike>`).
 */
export async function applyPageMargins(
  source: ArrayBuffer | Uint8Array,
  pageIndex: number,
  margins: PageMargins,
  loadEngine: EngineLoader = loadPdfEngine,
): Promise<Uint8Array<ArrayBuffer>> {
  const engine = await loadEngine();
  const doc = engine.open(toBytes(source));
  try {
    const ok = doc.setPageMargins(pageIndex + 1, margins);
    if (!ok) {
      throw new Error(`setPageMargins failed for page ${pageIndex + 1}`);
    }
    const saved = doc.save();
    const copy = new Uint8Array(saved.byteLength);
    copy.set(saved);
    return copy;
  } finally {
    doc.close();
  }
}
