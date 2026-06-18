/**
 * PKCS#7 detached digital signature (`/SubFilter /adbe.pkcs7.detached`)
 * using a user-provided PKCS#12 (.p12 / .pfx) certificate.
 *
 * Fully native: the PKCS#12 is imported and the CMS `SignedData` is built by
 * the in-house `@qrcommunication/gigapdf-lib` engine (Rust → WASM) — no pdf-lib,
 * no node-forge, no @signpdf. `signP12` opens the PDF, adds an invisible
 * signature widget + value dictionary with a fixed-width `/Contents`
 * placeholder, patches `/ByteRange`, and fills `/Contents` with the detached
 * CMS computed over the document byte ranges.
 *
 * SECURITY: neither the P12 bytes nor the passphrase are ever logged or
 * embedded in error messages. Every certificate/passphrase failure (wrong
 * password, corrupt DER, missing key/cert bags, unsupported cipher) is
 * normalised by the engine into a single generic error, surfaced here as
 * {@link PdfSignInvalidCertificateError} — nothing about the credential leaks.
 */

import type { GigaPdfDoc } from '@qrcommunication/gigapdf-lib';
import { getEngine } from '../wasm';
import { PDFCorruptedError, PDFEngineError } from '../errors';

/**
 * Business error raised when the provided P12/PFX cannot be used: wrong
 * passphrase, corrupt/truncated DER, no private key or certificate bag, or an
 * unsupported encryption cipher.
 *
 * The message is intentionally generic — it MUST never distinguish "wrong
 * passphrase" from "broken file" (anti-enumeration) and MUST never contain any
 * user-supplied secret.
 */
export class PdfSignInvalidCertificateError extends PDFEngineError {
  constructor() {
    super('Invalid certificate or passphrase', 'PDF_SIGN_INVALID_CERTIFICATE');
    this.name = 'PdfSignInvalidCertificateError';
  }
}

export interface SignPdfOptions {
  /** PKCS#12 (.p12 / .pfx) container bytes. */
  p12: Uint8Array;
  /** Passphrase protecting the P12 (may be empty for unprotected files). */
  passphrase: string;
  /** /Reason — why the document is being signed. */
  reason?: string;
  /** /Location — physical or logical signing location. */
  location?: string;
  /** /ContactInfo — how to reach the signer. */
  contactInfo?: string;
  /** /Name — human-readable signer name. */
  signerName?: string;
}

export interface SignPdfResult {
  /** The signed PDF (input bytes + signature dict + CMS container). */
  bytes: Uint8Array;
}

/** Current time as a PDF date string, `D:YYYYMMDDHHMMSSZ` (UTC). */
function pdfDateNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/**
 * Signs a PDF with a PKCS#7 detached signature (adbe.pkcs7.detached).
 *
 * The signature is invisible (zero-sized widget rectangle on page 1) and
 * covers the whole document via /ByteRange. Any later modification of the
 * bytes invalidates it — signing must be the LAST operation in a workflow.
 *
 * @throws {PdfSignInvalidCertificateError} wrong passphrase or unusable P12
 * @throws {PDFCorruptedError} input bytes are not a loadable PDF
 * @throws {PDFEngineError} internal signing failure (code PDF_SIGN_FAILED)
 */
export async function signPdf(
  pdfBytes: Uint8Array,
  opts: SignPdfOptions,
): Promise<SignPdfResult> {
  const { p12, passphrase, reason, location, contactInfo, signerName } = opts;

  if (p12.byteLength === 0) {
    throw new PdfSignInvalidCertificateError();
  }

  const giga = await getEngine();

  // 1. Open the PDF (structure validation).
  let doc: GigaPdfDoc;
  try {
    doc = giga.open(pdfBytes);
  } catch (err) {
    throw new PDFCorruptedError(
      `Failed to load PDF for signing: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Import the P12 + build the detached CMS, all in the engine. signP12
  //    throws a single generic error for ANY credential problem (wrong
  //    password, malformed file, unsupported cipher, missing certificate).
  try {
    const signed = doc.signP12(p12, passphrase, {
      name: signerName ?? '',
      reason: reason ?? '',
      date: pdfDateNow(),
      location: location ?? '',
      contactInfo: contactInfo ?? '',
    });
    return { bytes: signed };
  } catch (err) {
    if (err instanceof PDFEngineError) throw err;
    // The engine's generic "PKCS#12 signing failed: …" is, by construction, a
    // credential problem. Anything else here is an internal pipeline failure.
    if (err instanceof Error && /PKCS#12 signing failed/i.test(err.message)) {
      throw new PdfSignInvalidCertificateError();
    }
    throw new PDFEngineError('Failed to sign PDF', 'PDF_SIGN_FAILED');
  } finally {
    doc.close();
  }
}
