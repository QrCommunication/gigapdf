/**
 * Markdown / CSV → PDF conversion, powered entirely by the in-house
 * zero-dependency engine (`@qrcommunication/gigapdf-lib`). No third-party
 * library.
 *
 * Each wrapper lowers the source into the engine's unified {@link GigaDocument}
 * model (`mdToModel` / `csvToModel`) and then raises that model back to a
 * paginated PDF (`modelToPdf`). This keeps Markdown and CSV imports on the exact
 * same model-based path used by the editor's editable-document pipeline.
 *
 * Both wrappers accept either a decoded `string` (Markdown only — CSV needs the
 * raw bytes so the engine can auto-detect the delimiter from the original
 * encoding) or raw `Uint8Array` bytes, so callers holding a freshly uploaded
 * file don't have to decode themselves.
 */

import { PDFEngineError } from '../errors';
import { getEngine } from '../wasm';

/** Decode `Uint8Array` input as UTF-8; pass a `string` through unchanged. */
function toText(input: string | Uint8Array): string {
  return typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
}

/**
 * Render a Markdown document into a paginated PDF (CommonMark-ish: headings,
 * lists, GFM tables, fenced code, emphasis/links).
 *
 * @param markdown - The Markdown source, as a `string` or UTF-8 `Uint8Array`.
 * @returns The PDF bytes (always starts with `%PDF`).
 * @throws {PDFEngineError} if the engine returns an empty document.
 */
export async function convertMarkdownToPdf(
  markdown: string | Uint8Array,
): Promise<Uint8Array> {
  const giga = await getEngine();
  const model = giga.mdToModel(toText(markdown));
  const pdf = giga.modelToPdf(model);
  if (pdf.length === 0) {
    throw new PDFEngineError(
      'could not convert Markdown to PDF (empty result)',
      'PDF_MARKDOWN_CONVERT_FAILED',
    );
  }
  return pdf;
}

/**
 * Render a CSV file into a paginated PDF as a single editable table (RFC 4180,
 * auto-detected `,` / `;` / tab / `|` delimiter).
 *
 * The CSV is parsed from its raw UTF-8 bytes so the engine can sniff the
 * delimiter from the original content; a `string` input is therefore re-encoded
 * to UTF-8 bytes before parsing.
 *
 * @param csv - The CSV source, as a `string` or UTF-8 `Uint8Array`.
 * @returns The PDF bytes (always starts with `%PDF`).
 * @throws {PDFEngineError} if the CSV contains no parseable fields, or the
 *   resulting PDF is empty.
 */
export async function convertCsvToPdf(csv: string | Uint8Array): Promise<Uint8Array> {
  const giga = await getEngine();
  const bytes = typeof csv === 'string' ? new TextEncoder().encode(csv) : csv;
  // `csvToModel` returns null when the bytes contain no parseable fields
  // (e.g. an empty CSV) — surface that as a clear conversion error.
  const model = giga.csvToModel(bytes);
  if (model === null) {
    throw new PDFEngineError(
      'could not convert CSV to PDF (no parseable fields — empty or malformed file)',
      'PDF_CSV_CONVERT_EMPTY',
    );
  }
  const pdf = giga.modelToPdf(model);
  if (pdf.length === 0) {
    throw new PDFEngineError('could not convert CSV to PDF (empty result)', 'PDF_CSV_CONVERT_FAILED');
  }
  return pdf;
}
