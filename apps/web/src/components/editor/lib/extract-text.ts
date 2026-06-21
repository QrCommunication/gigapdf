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

/** One positioned text line: bbox in PDF user-space points (lower-left origin). */
export interface PositionedBlock {
  page: number;
  bbox: { x: number; y: number; w: number; h: number };
  text: string;
}

interface StructuredTextDoc {
  pageCount(): number;
  /** Per-line text + bbox (PDF user space, lower-left origin). */
  structuredText(page: number): Array<{ x: number; y: number; w: number; h: number; text: string }>;
  close(): void;
}

interface BlocksEngine {
  open(bytes: Uint8Array): StructuredTextDoc;
}

// Bound the index size (very large documents can yield thousands of lines).
const MAX_BLOCKS = 4000;

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

/**
 * Extract POSITIONED text blocks (one per line) with their bbox in PDF user
 * space — the exact shape the semantic index (`POST .../ocr-blocks`) and the
 * search-hit page highlighter consume. This is the in-browser counterpart of
 * the server-side backfill extractor, so import, save and backfill all produce
 * the SAME geometry-aware index. Read-only; closes the doc in `finally`.
 *
 * Scanned (image-only) PDFs have no text layer and yield `[]` here — those are
 * indexed through the server OCR route instead.
 */
export async function extractDocumentBlocks(
  source: ArrayBuffer | Uint8Array,
  loadEngine: EngineLoader = loadPdfEngine,
): Promise<PositionedBlock[]> {
  const engine = (await loadEngine()) as unknown as BlocksEngine;
  const doc = engine.open(toBytes(source));
  try {
    const blocks: PositionedBlock[] = [];
    const pages = doc.pageCount();
    // Pages are 1-based across the engine and the index/preview pipeline.
    for (let page = 1; page <= pages && blocks.length < MAX_BLOCKS; page++) {
      for (const line of doc.structuredText(page)) {
        const text = (line.text ?? "").trim();
        if (!text) continue;
        blocks.push({ page, bbox: { x: line.x, y: line.y, w: line.w, h: line.h }, text });
        if (blocks.length >= MAX_BLOCKS) break;
      }
    }
    return blocks;
  } finally {
    doc.close();
  }
}
