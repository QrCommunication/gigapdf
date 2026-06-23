/**
 * PDF → Markdown / CSV / EPUB export, powered entirely by the in-house
 * zero-dependency engine (`@qrcommunication/gigapdf-lib`). No third-party
 * library.
 *
 * Each wrapper opens a short-lived `GigaPdfDoc` on the shared WASM engine,
 * reconstructs the PDF into the engine's unified, format-neutral
 * {@link GigaDocument} model via `doc.toModel()`, then raises that model to the
 * requested target with the engine-level `modelToMarkdown()` / `modelToCsv()` /
 * `modelToEpub()` exporters. This is the exact same model-based path the editor's
 * editable-document pipeline uses (`toModel` → … → `modelTo*`), so a PDF, a Word
 * file, or a freshly built model all export identically.
 *
 * Markdown and CSV are decoded UTF-8 strings; EPUB is a packaged binary
 * (`application/epub+zip`).
 *
 * The doc is opened and serialised in the same synchronous tick (no `await`
 * between `open` and `close`) so the short-lived doc never overlaps other work on
 * the single shared WASM instance, then closed in `finally` — mirroring
 * {@link file://./office-headless.ts}.
 */

import type { GigaDocument, GigaPdfEngine } from '@qrcommunication/gigapdf-lib';

import { PDFEngineError } from '../errors';
import { getEngine } from '../wasm';

/**
 * Open `buffer`, build its unified model, and run `lower` on the engine to raise
 * that model to the target format. The doc is always closed, even if `lower`
 * throws.
 *
 * @typeParam T - The exporter's return type (`string` for text targets,
 *   `Uint8Array` for binary targets).
 * @param buffer - Raw PDF bytes.
 * @param lower - Maps `(engine, model)` to the serialised target.
 * @throws {PDFEngineError} if the source PDF cannot be parsed.
 */
async function lowerPdfModel<T>(
  buffer: Uint8Array,
  lower: (giga: GigaPdfEngine, model: GigaDocument) => T,
): Promise<T> {
  const giga = await getEngine();
  let doc;
  try {
    doc = giga.open(buffer);
  } catch {
    throw new PDFEngineError('could not parse the source PDF', 'PDF_PARSE_FAILED');
  }
  try {
    const model = doc.toModel();
    return lower(giga, model);
  } finally {
    doc.close();
  }
}

/**
 * Export a PDF to GitHub-flavoured Markdown (headings, lists, tables,
 * emphasis/links), decoded as a UTF-8 string.
 *
 * @param buffer - Raw PDF bytes.
 * @returns The Markdown source.
 * @throws {PDFEngineError} if the source PDF cannot be parsed.
 */
export async function exportPdfToMarkdown(buffer: Uint8Array): Promise<string> {
  return lowerPdfModel(buffer, (giga, model) => giga.modelToMarkdown(model));
}

/**
 * Export a PDF to CSV (RFC 4180) — the document's tabular content flattened into
 * comma-separated rows, decoded as a UTF-8 string.
 *
 * @param buffer - Raw PDF bytes.
 * @returns The CSV source.
 * @throws {PDFEngineError} if the source PDF cannot be parsed.
 */
export async function exportPdfToCsv(buffer: Uint8Array): Promise<string> {
  return lowerPdfModel(buffer, (giga, model) => giga.modelToCsv(model));
}

/**
 * Export a PDF to an EPUB e-book (`application/epub+zip`) — the document's
 * reflowable text content packaged as a standalone EPUB.
 *
 * @param buffer - Raw PDF bytes.
 * @returns The EPUB bytes (a ZIP container).
 * @throws {PDFEngineError} if the source PDF cannot be parsed, or the engine
 *   returns an empty package.
 */
export async function exportPdfToEpub(buffer: Uint8Array): Promise<Uint8Array> {
  const epub = await lowerPdfModel(buffer, (giga, model) => giga.modelToEpub(model));
  if (epub.length === 0) {
    throw new PDFEngineError('could not export PDF to EPUB (empty result)', 'PDF_EPUB_EXPORT_FAILED');
  }
  return epub;
}
