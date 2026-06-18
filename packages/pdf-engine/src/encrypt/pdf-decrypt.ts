import { getEngine } from '../wasm';
import { PDFEngineError, PDFInvalidPasswordError } from '../errors';

/**
 * Decrypts an encrypted PDF with the user (or owner) password via the
 * zero-dependency WASM engine — **real** RC4 / AESV2 / AESV3 content-stream
 * decryption. (The previous pdf-lib path only stripped the `/Encrypt` entry and
 * left ciphertext streams intact.) Throws {@link PDFInvalidPasswordError} when
 * the password is wrong.
 */
export async function decryptPDF(buffer: Buffer, password: string): Promise<Buffer> {
  const giga = await getEngine();
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const doc = giga.openEncrypted(data, password);
  if (!doc) {
    throw new PDFInvalidPasswordError('Failed to decrypt PDF: incorrect password');
  }

  try {
    return Buffer.from(doc.save());
  } catch (err) {
    throw new PDFEngineError(
      `Failed to re-save decrypted PDF: ${err instanceof Error ? err.message : String(err)}`,
      'PDF_DECRYPT_SAVE_FAILED',
    );
  } finally {
    doc.close();
  }
}
