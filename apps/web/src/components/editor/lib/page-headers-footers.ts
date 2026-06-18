/**
 * page-headers-footers.ts
 *
 * Client-side helpers for the Word-like editor's running headers & footers.
 *
 * A running header/footer is baked onto the PDF through the GigaPDF engine
 * ({@link loadPdfEngine}) — the same single wasm instance that rasterises page
 * backgrounds, so we never load a second engine. The engine draws the band text
 * (with `{{page}}` / `{{pages}}` tokens substituted per page) inside the top
 * (header) / bottom (footer) margin band of every page in the requested range.
 *
 *   - {@link applyHeaderFooter} opens the document, sets the header *or* footer
 *     to `spec`, and returns the re-serialised bytes.
 *   - {@link removeHeaderFooter} opens the document, removes every header *or*
 *     footer band, and returns the re-serialised bytes.
 *
 * In both cases the caller feeds the returned bytes back into the editor's
 * single source of truth (`currentPdfFile`) exactly like any other full-binary
 * operation (via `adoptModifiedPdf`).
 *
 * No React, no DOM — trivially unit-testable with an injected engine loader.
 */

import { loadPdfEngine } from "@giga-pdf/canvas";
import type { HeaderFooterSpec } from "@qrcommunication/gigapdf-lib";

export type { HeaderFooterSpec };

/** Which band an operation targets. */
export type HeaderFooterKind = "header" | "footer";

/** Loader for the shared GigaPDF engine; injectable for tests. */
type EngineLoader = typeof loadPdfEngine;

/** Normalise PDF bytes to a `Uint8Array` the engine can open. */
function toBytes(source: ArrayBuffer | Uint8Array): Uint8Array {
  return source instanceof Uint8Array ? source : new Uint8Array(source);
}

/**
 * Copy the engine's saved bytes into a freshly-allocated `ArrayBuffer`-backed
 * view so the result is a `Uint8Array<ArrayBuffer>` — directly usable as a
 * `BlobPart` in the browser (the engine's `save()` returns the looser
 * `Uint8Array<ArrayBufferLike>`).
 */
function freshCopy(saved: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(saved.byteLength);
  copy.set(saved);
  return copy;
}

/**
 * Bake `spec` onto the `kind` band ("header" or "footer") of `source` and return
 * the re-serialised PDF bytes. Throws if the engine rejects the change; the
 * caller is expected to surface that as an error toast.
 */
export async function applyHeaderFooter(
  source: ArrayBuffer | Uint8Array,
  kind: HeaderFooterKind,
  spec: HeaderFooterSpec,
  loadEngine: EngineLoader = loadPdfEngine,
): Promise<Uint8Array<ArrayBuffer>> {
  const engine = await loadEngine();
  const doc = engine.open(toBytes(source));
  try {
    const ok =
      kind === "header" ? doc.setHeader(spec) : doc.setFooter(spec);
    if (!ok) {
      throw new Error(`set ${kind} failed`);
    }
    return freshCopy(doc.save());
  } finally {
    doc.close();
  }
}

/**
 * Remove every `kind` band ("header" or "footer") from `source` and return the
 * re-serialised PDF bytes. Throws if the engine rejects the change.
 */
export async function removeHeaderFooter(
  source: ArrayBuffer | Uint8Array,
  kind: HeaderFooterKind,
  loadEngine: EngineLoader = loadPdfEngine,
): Promise<Uint8Array<ArrayBuffer>> {
  const engine = await loadEngine();
  const doc = engine.open(toBytes(source));
  try {
    const ok =
      kind === "header" ? doc.removeHeaders() : doc.removeFooters();
    if (!ok) {
      throw new Error(`remove ${kind}s failed`);
    }
    return freshCopy(doc.save());
  } finally {
    doc.close();
  }
}
