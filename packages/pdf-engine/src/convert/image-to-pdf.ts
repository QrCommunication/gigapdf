/**
 * Image → PDF conversion, powered entirely by the in-house zero-dependency
 * engine (`@qrcommunication/gigapdf-lib`). No third-party image library.
 *
 * The source format is auto-detected from the bytes: PNG and JPEG embed
 * directly, while GIF / WebP / AVIF are transcoded to PNG first — all in pure
 * Rust/WASM. The image is centred and scaled to fit a single A4 portrait page.
 * To assemble several images into one document, pipe each result through the
 * merge primitive (see {@link mergeUniversal}).
 */

import { PDFEngineError } from '../errors';
import { getEngine } from '../wasm';

/**
 * Convert a raster image (PNG / JPEG / GIF / WebP / AVIF) into a one-page PDF.
 * The format is auto-detected by the engine; no hint is required.
 *
 * @param image - Raw image bytes.
 * @returns The PDF bytes (always starts with `%PDF`).
 * @throws {PDFEngineError} if the bytes are not a recognized image.
 */
export async function imageToPdf(image: Uint8Array): Promise<Uint8Array> {
  const giga = await getEngine();
  const pdf = giga.imageToPdf(image);
  if (pdf.length === 0) {
    throw new PDFEngineError(
      'could not convert image to PDF (unrecognized or empty image bytes)',
      'PDF_IMAGE_CONVERT_FAILED',
    );
  }
  return pdf;
}
