/**
 * extract-text.ts
 *
 * Client-side helper that extracts the plain-text content of the current
 * document, entirely in the browser, with no backend job.
 *
 * The document bytes are opened through the shared GigaPDF engine
 * ({@link loadPdfEngine} — the same single wasm instance used everywhere else,
 * so we never load a second engine) and lowered to text by the SDK's
 * `doc.toText()`.
 *
 * Strictly READ-ONLY: it opens a short-lived `GigaPdfDoc` on a copy of the
 * current bytes, reads the text, and closes the doc in `finally`. It never
 * mutates `currentPdfFile`, the scene graph, or the operations queue — exactly
 * like {@link file://./export-document.ts}.
 *
 * No React, no DOM — trivially unit-testable with an injected engine loader.
 */

import { loadPdfEngine } from "@giga-pdf/canvas";

/** Loader for the shared GigaPDF engine; injectable for tests. */
type EngineLoader = typeof loadPdfEngine;

/** Minimal structural view of the SDK document used here. */
interface TextDoc {
  toText(): string;
  close(): void;
}

interface TextEngine {
  open(bytes: Uint8Array): TextDoc;
}

/** Normalise PDF bytes to a `Uint8Array` the engine can open. */
function toBytes(source: ArrayBuffer | Uint8Array): Uint8Array {
  return source instanceof Uint8Array ? source : new Uint8Array(source);
}

/**
 * Extract the document's plain text. Opens a short-lived `GigaPdfDoc` on the
 * shared engine, reads `toText()`, and closes the doc in `finally`. Throws if the
 * engine cannot open the bytes; the caller surfaces that as an error toast.
 */
export async function extractDocumentText(
  source: ArrayBuffer | Uint8Array,
  loadEngine: EngineLoader = loadPdfEngine,
): Promise<string> {
  const engine = (await loadEngine()) as unknown as TextEngine;
  const doc = engine.open(toBytes(source));
  try {
    return doc.toText();
  } finally {
    doc.close();
  }
}
