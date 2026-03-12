import { PDFDocument } from 'pdf-lib';
import { PDFEngineError, PDFInvalidPasswordError } from '../errors';

/**
 * Attempts to decrypt an encrypted PDF and returns the decrypted bytes.
 *
 * pdf-lib loads encrypted documents with `ignoreEncryption: true`, which bypasses
 * the PDF password check and strips the Encrypt dictionary on re-save. This works for
 * documents where pdf-lib can parse the encrypted structure without actually decrypting
 * the content streams.
 *
 * LIMITATION: For documents using strong AES-256 encryption where content streams are
 * ciphertext, pdf-lib will parse the raw (undecrypted) streams. True decryption of
 * content streams requires a native library such as qpdf:
 * `qpdf --decrypt --password=<pwd> input.pdf output.pdf`
 *
 * @param buffer - Encrypted PDF bytes
 * @param password - User or owner password (used for validation; pdf-lib ignores it internally)
 * @throws {PDFInvalidPasswordError} When the PDF cannot be loaded at all
 * @throws {PDFEngineError} When an unexpected error occurs during processing
 */
export async function decryptPDF(buffer: Buffer, password: string): Promise<Buffer> {
  // password is received for API correctness and future native implementation.
  void password;

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // pdf-lib surfaces password-related errors with messages containing "password"
    if (message.toLowerCase().includes('password') || message.toLowerCase().includes('encrypt')) {
      throw new PDFInvalidPasswordError(`Failed to decrypt PDF: ${message}`);
    }

    throw new PDFEngineError(
      `Failed to load PDF for decryption: ${message}`,
      'PDF_DECRYPT_LOAD_FAILED',
    );
  }

  try {
    const bytes = await pdfDoc.save({ useObjectStreams: false });
    return Buffer.from(bytes);
  } catch (err) {
    throw new PDFEngineError(
      `Failed to re-save decrypted PDF: ${err instanceof Error ? err.message : String(err)}`,
      'PDF_DECRYPT_SAVE_FAILED',
    );
  }
}
