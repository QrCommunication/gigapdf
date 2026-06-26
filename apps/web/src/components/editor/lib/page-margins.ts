/**
 * page-margins.ts
 *
 * Client-side helpers for the Word-like editor's draggable page margins.
 *
 * Word margins are the page's CONTENT ZONE — they drive the on-sheet guides and
 * the header/footer position. They are DELIBERATELY NOT a recrop: they never
 * touch `/CropBox` or `/MediaBox`, so the page geometry (and the rendered
 * background) is unchanged when a guide is dragged. Instead they live in the
 * GigaPDF editor-metadata SIDECAR ({@link GigaPdfDoc.setEditorMargins}), an
 * opaque per-document stream that travels with the PDF and survives save/open —
 * so dragged margins persist across reloads without ever recropping the page.
 *
 *   - {@link readAllPageMargins} opens the document once and reads every page's
 *     margins (PDF points), preferring the sidecar value written by a drag and
 *     falling back to the estimated `/CropBox`→`/MediaBox` inset for legacy
 *     documents that have no sidecar yet.
 *   - {@link applyPageMargins} opens the document, records one page's margins in
 *     the sidecar (NOT the CropBox), and returns the re-serialised bytes. The
 *     caller feeds those bytes back into the editor's single source of truth
 *     (`currentPdfFile`) — but because the sidecar is not page geometry, the
 *     caller adopts them WITHOUT re-parsing (no blank, no churn).
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
 * Returns one entry per page, in document order. For each page the editor
 * SIDECAR value ({@link GigaPdfDoc.editorMargins}, written by a margin drag)
 * wins; when none was stored we fall back to the estimated `/CropBox` inset
 * ({@link GigaPdfDoc.pageMargins}) so legacy documents still show sensible
 * guides. An entry is `null` only when neither can be determined (it never
 * throws for a single page), so callers can fall back to "no guides" for it.
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
      // Editor sidecar (written by a drag) takes priority.
      let stored: PageMargins | null = null;
      try {
        stored = doc.editorMargins(i);
      } catch {
        stored = null;
      }
      if (stored) {
        out.push(stored);
        continue;
      }
      // Fall back to the estimated CropBox→MediaBox inset for legacy docs.
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
 * Record `margins` (PDF points) for the 0-based `pageIndex` of `source` in the
 * editor-metadata SIDECAR and return the re-serialised PDF bytes. This is a
 * pure metadata write: it NEVER insets `/CropBox` or `/MediaBox`, so the page
 * geometry is untouched — callers adopt the result WITHOUT re-parsing. Throws
 * if the page is out of range or the engine rejects the change; the caller is
 * expected to surface that as an error toast.
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
    const ok = doc.setEditorMargins(pageIndex + 1, margins);
    if (!ok) {
      throw new Error(`setEditorMargins failed for page ${pageIndex + 1}`);
    }
    const saved = doc.saveCompressed();
    const copy = new Uint8Array(saved.byteLength);
    copy.set(saved);
    return copy;
  } finally {
    doc.close();
  }
}
