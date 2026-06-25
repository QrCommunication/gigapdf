import type { DocumentPermissions } from '@giga-pdf/types';
import { getEngine } from '../wasm';
import { PDFEngineError, PDFInvalidCertificateError } from '../errors';
import { computePermissionFlags, type EncryptionAlgorithm } from './pdf-encrypt';

/** Options for {@link encryptPDFForCertificates}. */
export interface EncryptForCertificatesOptions {
  /**
   * Recipient X.509 certificates (DER or PEM). At least one is required — every
   * holder of a matching recipient private key will be able to open the result.
   */
  certificates: Uint8Array[];
  /**
   * AES variant for the content encryption. Public-key (certificate) security is
   * always AES; defaults to AES-256.
   */
  algorithm?: EncryptionAlgorithm;
  /**
   * Named access permissions (ISO 32000-1 Table 22). Omitted flags default to
   * granted.
   */
  permissions?: Partial<DocumentPermissions>;
}

/** First PEM block (`-----BEGIN X-----` … `-----END X-----`), base64 captured. */
const PEM_BLOCK_RE =
  /-----BEGIN [A-Z0-9 ]+-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END [A-Z0-9 ]+-----/;

/**
 * Normalize a certificate or private key to DER. PEM-armored input (ASCII
 * `-----BEGIN …-----`) has its first base64 block decoded to DER; bytes that are
 * not PEM-armored are assumed to already be DER and returned unchanged.
 *
 * @throws {PDFInvalidCertificateError} when the input looks like PEM but carries
 * no decodable block.
 */
export function normalizeToDer(bytes: Uint8Array): Uint8Array {
  // PEM is 7-bit ASCII; sniff the head for the armor marker before stringifying
  // the whole (potentially large) buffer.
  const head = Buffer.from(bytes.subarray(0, 32)).toString('latin1');
  if (!head.includes('-----BEGIN')) return bytes; // already DER

  const text = Buffer.from(bytes).toString('latin1');
  const match = PEM_BLOCK_RE.exec(text);
  const block = match?.[1];
  if (block === undefined) {
    throw new PDFInvalidCertificateError('Malformed PEM data');
  }
  const base64 = block.replace(/\s+/g, '');
  const der = Buffer.from(base64, 'base64');
  if (der.byteLength === 0) {
    throw new PDFInvalidCertificateError('Empty PEM payload');
  }
  return new Uint8Array(der);
}

/**
 * Encrypts a PDF to one or more **X.509 recipients** (public-key / certificate
 * security, ISO 32000-1 §7.6.5, `/Filter /Adobe.PubSec`) via the zero-dependency
 * WASM engine: only a holder of a matching recipient private key can open the
 * result — there is no shared password. Accepts DER or PEM certificates. Open the
 * output with {@link decryptPDFWithPrivateKey}.
 *
 * @throws {PDFInvalidCertificateError} when no certificate is supplied or a
 * certificate cannot be used as a recipient.
 */
export async function encryptPDFForCertificates(
  buffer: Buffer,
  options: EncryptForCertificatesOptions,
): Promise<Buffer> {
  if (!options.certificates || options.certificates.length === 0) {
    throw new PDFInvalidCertificateError('At least one recipient certificate is required');
  }

  const certificates = options.certificates.map(normalizeToDer);

  const giga = await getEngine();
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let doc;
  try {
    doc = giga.open(data);
  } catch (err) {
    throw new PDFEngineError(
      `Failed to load PDF for encryption: ${err instanceof Error ? err.message : String(err)}`,
      'PDF_ENCRYPT_LOAD_FAILED',
    );
  }

  try {
    const permissions = computePermissionFlags(options.permissions ?? {});
    let encrypted: Uint8Array;
    try {
      encrypted = doc.encryptForRecipients(certificates, {
        // The engine exposes a single AES toggle for public-key security; any
        // non-AES-128 request maps to AES-256 (the default and recommendation).
        aes256: options.algorithm !== 'AES-128',
        permissions,
      });
    } catch (err) {
      // The PDF opened cleanly, so a failure here is the recipient certificate
      // (not valid X.509 SubjectPublicKeyInfo). Surface it as a credential error.
      throw new PDFInvalidCertificateError(
        `Public-key encryption failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!encrypted || encrypted.byteLength === 0) {
      throw new PDFInvalidCertificateError('Invalid recipient certificate');
    }
    return Buffer.from(encrypted);
  } finally {
    doc.close();
  }
}

/**
 * Opens a **public-key (certificate) encrypted** PDF with a recipient's
 * certificate + PKCS#1 RSA private key (each DER or PEM) and returns the
 * decrypted plaintext PDF — the counterpart of {@link encryptPDFForCertificates}.
 *
 * @throws {PDFInvalidCertificateError} when the certificate/private-key pair is
 * not a recipient of the document (or the document is not public-key encrypted).
 */
export async function decryptPDFWithPrivateKey(
  buffer: Buffer,
  certificate: Uint8Array,
  privateKey: Uint8Array,
): Promise<Buffer> {
  const certDer = normalizeToDer(certificate);
  const keyDer = normalizeToDer(privateKey);

  const giga = await getEngine();
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const doc = giga.openWithPrivateKey(data, certDer, keyDer);
  if (!doc) {
    throw new PDFInvalidCertificateError(
      'The certificate or private key cannot open this document',
    );
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
