/**
 * outline-bake.ts
 *
 * Client-side helper for baking an edited outline (table of contents) onto the
 * PDF through the shared GigaPDF engine — the SAME single wasm instance that
 * rasterises page backgrounds and bakes redactions/headers/footers (via
 * {@link loadPdfEngine}), so we never load a second engine.
 *
 * Mirrors `redact-pii.ts`: open → mutate → save → close in one synchronous tick
 * so the short-lived doc never overlaps page rendering on the shared instance.
 *
 * The editor's outline is a `BookmarkObject[]` tree; the engine's `setOutline`
 * consumes a flat, level-encoded `{ level, title, page }[]` (page 0/undefined =
 * no destination). Label styling (bold/italic/colour) is populated on read but
 * not persisted by the writer, so the round-trip keeps structure + titles +
 * destinations only. The caller feeds the returned bytes back into the editor's
 * single source of truth (`currentPdfFile`) via `adoptModifiedPdf`.
 *
 * No React, no DOM — trivially unit-testable with an injected engine loader.
 */

import { loadPdfEngine } from "@giga-pdf/canvas";
import type { BookmarkObject } from "@giga-pdf/types";

/** Loader for the shared GigaPDF engine; injectable for tests. */
type EngineLoader = typeof loadPdfEngine;

/** Flat outline entry consumed by the engine's `setOutline`. */
interface FlatOutlineEntry {
  level: number;
  title: string;
  page?: number;
}

/** Minimal doc surface used here (avoids importing the full lib types). */
interface OutlineWritableDoc {
  setOutline(entries: FlatOutlineEntry[]): boolean;
  save(): Uint8Array;
  saveCompressed(): Uint8Array;
  close(): void;
}

/** Bytes → owned `Uint8Array` (defensive copy off the wasm heap). */
function freshCopy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy as Uint8Array<ArrayBuffer>;
}

function toBytes(source: ArrayBuffer | Uint8Array): Uint8Array {
  return source instanceof Uint8Array ? source : new Uint8Array(source);
}

/**
 * Flatten a bookmark tree into the engine's pre-order, level-encoded list. A
 * page <= 0 / absent is emitted without a destination.
 */
export function flattenOutline(
  nodes: BookmarkObject[],
  level = 0,
  out: FlatOutlineEntry[] = [],
): FlatOutlineEntry[] {
  for (const node of nodes) {
    const page = node.destination?.pageNumber;
    out.push({
      level,
      title: node.title ?? "",
      ...(typeof page === "number" && page > 0 ? { page } : {}),
    });
    if (node.children && node.children.length > 0) {
      flattenOutline(node.children, level + 1, out);
    }
  }
  return out;
}

/**
 * Replace the document outline with `outline` and return freshly-serialised
 * bytes. An empty tree clears the outline. Throws (doc closed) if the engine
 * cannot open the bytes; the caller surfaces that as an error toast.
 */
export async function bakeOutline(
  source: ArrayBuffer | Uint8Array,
  outline: BookmarkObject[],
  loadEngine: EngineLoader = loadPdfEngine,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; entries: number }> {
  const flat = flattenOutline(outline);
  const engine = await loadEngine();
  const doc = engine.open(toBytes(source)) as unknown as OutlineWritableDoc;
  try {
    doc.setOutline(flat);
    return { bytes: freshCopy(doc.saveCompressed()), entries: flat.length };
  } finally {
    doc.close();
  }
}
