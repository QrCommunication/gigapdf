/**
 * PDF/A conversion via the WASM engine (`@qrcommunication/gigapdf-lib`).
 *
 * Native engine path. The engine emits PDF/A-2b archival
 * structure (XMP `pdfaid` packet + embedded sRGB OutputIntent + trailer /ID).
 * The `variant` argument is accepted for signature compatibility; all variants
 * map to the engine's PDF/A-2b output.
 */

import { getEngine } from '../wasm';
import { engineLogger } from '../utils/logger';

export type PdfAVariant = 'pdfa-1b' | 'pdfa-1a' | 'pdfa-2b' | 'pdfa-2u' | 'pdfa-3b';

export interface PdfAConversionResult {
  bytes: Uint8Array;
  variant: PdfAVariant;
  inputBytes: number;
  outputBytes: number;
}

export class PdfAConversionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PdfAConversionError';
  }
}

export async function convertToPdfA(
  pdfBytes: Uint8Array,
  variant: PdfAVariant = 'pdfa-2u',
): Promise<PdfAConversionResult> {
  try {
    const giga = await getEngine();
    const doc = giga.open(pdfBytes);
    try {
      const bytes = doc.toPdfA();
      engineLogger.info('pdfa-convert: PDF converted to PDF/A-2b', {
        variant,
        inputBytes: pdfBytes.byteLength,
        outputBytes: bytes.byteLength,
      });
      return { bytes, variant, inputBytes: pdfBytes.byteLength, outputBytes: bytes.byteLength };
    } finally {
      doc.close();
    }
  } catch (err) {
    if (err instanceof PdfAConversionError) throw err;
    throw new PdfAConversionError(
      `PDF/A conversion failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}
