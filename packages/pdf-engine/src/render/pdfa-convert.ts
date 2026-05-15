/**
 * PDF/A conversion via MuPDF.
 *
 * PDF/A is the ISO 19005 archival flavour of PDF — fonts embedded, no
 * encryption, no JavaScript, deterministic rendering. Required for long-
 * term archival (legal, healthcare, public sector).
 *
 * MuPDF's `Document.save()` accepts a string of comma-separated options.
 * The `profile=pdfa-2u` flag triggers MuPDF's PDF/A conformance pass
 * which:
 *   1. Embeds all fonts (subsetting where possible).
 *   2. Removes JavaScript actions and external file refs.
 *   3. Normalises colour profiles to ICC sRGB / CMYK.
 *   4. Stamps the /Catalog/Metadata with the PDF/A identifier.
 *
 * Variants:
 *   - pdfa-1b  : "Basic", PDF 1.4 visual fidelity only
 *   - pdfa-1a  : "Accessible", PDF 1.4 + structure tree (Tagged PDF)
 *   - pdfa-2b  : PDF 1.7 visual fidelity
 *   - pdfa-2u  : PDF 1.7 + Unicode mapping (recommended default)
 *   - pdfa-3b  : 2b + embedded files (e.g. ZUGFeRD invoices)
 *
 * If the document contains features incompatible with PDF/A (transparency
 * groups in PDF/A-1, encryption, etc.), MuPDF either downgrades them or
 * throws. We catch and surface the error to the caller.
 */

import { engineLogger } from '../utils/logger';

export type PdfAVariant = 'pdfa-1b' | 'pdfa-1a' | 'pdfa-2b' | 'pdfa-2u' | 'pdfa-3b';

export interface PdfAConversionResult {
  bytes: Uint8Array;
  variant: PdfAVariant;
  inputBytes: number;
  outputBytes: number;
}

export class PdfAConversionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PdfAConversionError';
  }
}

export async function convertToPdfA(
  pdfBytes: Uint8Array,
  variant: PdfAVariant = 'pdfa-2u',
): Promise<PdfAConversionResult> {
  try {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(
      pdfBytes,
      'application/pdf',
    ) as unknown as InstanceType<typeof mupdf.PDFDocument>;

    // garbage=4 + compress = required by PDF/A spec (no unreferenced
    // objects, streams must be compressed unless inline). sanitize=yes
    // fixes the malformed dicts that some scanners produce.
    const opts = `garbage=4,compress=yes,sanitize=yes,profile=${variant}`;

    let bytes: Uint8Array;
    try {
      const buf = doc.saveToBuffer(opts);
      bytes = buf.asUint8Array();
    } catch (saveErr) {
      throw new PdfAConversionError(
        `MuPDF refused PDF/A conversion to ${variant}. This usually means ` +
          `the source PDF contains transparency, encryption, or other ` +
          `features that cannot be downgraded to ${variant} without ` +
          `losing visual fidelity. Try pdfa-2u or pdfa-3b which allow ` +
          `more features.`,
        saveErr,
      );
    }

    engineLogger.info('pdfa-convert: PDF converted to PDF/A', {
      variant,
      inputBytes: pdfBytes.byteLength,
      outputBytes: bytes.byteLength,
    });

    return {
      bytes,
      variant,
      inputBytes: pdfBytes.byteLength,
      outputBytes: bytes.byteLength,
    };
  } catch (err) {
    if (err instanceof PdfAConversionError) throw err;
    throw new PdfAConversionError(
      `PDF/A conversion failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}
