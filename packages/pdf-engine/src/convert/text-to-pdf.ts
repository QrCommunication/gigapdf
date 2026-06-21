/**
 * Plain-text / RTF → PDF conversion, powered entirely by the in-house
 * zero-dependency engine (`@qrcommunication/gigapdf-lib`). No third-party
 * library.
 *
 * Both wrappers accept either a decoded `string` or raw `Uint8Array` bytes
 * (decoded as UTF-8) so callers holding a buffer (e.g. a freshly uploaded file)
 * don't have to decode themselves.
 */

import { PDFEngineError } from '../errors';
import { getEngine } from '../wasm';

/** Decode `Uint8Array` input as UTF-8; pass a `string` through unchanged. */
function toText(input: string | Uint8Array): string {
  return typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
}

/**
 * Render plain text into a paginated PDF.
 *
 * @param text - The text, as a `string` or UTF-8 `Uint8Array`.
 * @returns The PDF bytes (always starts with `%PDF`).
 * @throws {PDFEngineError} if the engine returns an empty document.
 */
export async function textToPdf(text: string | Uint8Array): Promise<Uint8Array> {
  const giga = await getEngine();
  const pdf = giga.txtToPdf(toText(text));
  if (pdf.length === 0) {
    throw new PDFEngineError('could not convert text to PDF (empty result)', 'PDF_TEXT_CONVERT_FAILED');
  }
  return pdf;
}

/**
 * Render an RTF document into a paginated PDF.
 *
 * @param rtf - The RTF source, as a `string` or UTF-8 `Uint8Array`.
 * @returns The PDF bytes (always starts with `%PDF`).
 * @throws {PDFEngineError} if the RTF is unrecognized or the result is empty.
 */
export async function rtfToPdf(rtf: string | Uint8Array): Promise<Uint8Array> {
  const giga = await getEngine();
  const pdf = giga.rtfToPdf(toText(rtf));
  if (pdf.length === 0) {
    throw new PDFEngineError(
      'could not convert RTF to PDF (unrecognized or empty content)',
      'PDF_RTF_CONVERT_FAILED',
    );
  }
  return pdf;
}
