import { PDFDocument } from 'pdf-lib';
import { PDFParseError } from '../errors';

export async function flattenForm(buffer: Buffer): Promise<Buffer> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch (err) {
    throw new PDFParseError(
      `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const form = pdfDoc.getForm();
  form.flatten();

  const bytes = await pdfDoc.save({ useObjectStreams: true });
  return Buffer.from(bytes);
}
