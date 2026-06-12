/**
 * PKCS#7 detached digital signature (`/SubFilter /adbe.pkcs7.detached`)
 * using a user-provided PKCS#12 (.p12 / .pfx) certificate.
 *
 * Pipeline:
 *   1. pdf-lib load (structure validation)
 *   2. `pdflibAddPlaceholder` — signature dictionary + invisible widget
 *      annotation with a zero-filled /Contents placeholder
 *   3. `save({ useObjectStreams: false })` — REQUIRED by @signpdf, which
 *      scans the raw serialized bytes for the /ByteRange placeholder
 *      (object streams would hide the signature dict from that scan)
 *   4. `SignPdf().sign()` with a `P12Signer` — computes the CMS container
 *      over the document byte ranges and patches /Contents in place
 *
 * SECURITY: neither the P12 bytes nor the passphrase are ever logged or
 * embedded in error messages. Every certificate/passphrase failure
 * (wrong password, corrupt DER, missing key/cert bags, key/cert mismatch)
 * is normalised into {@link PdfSignInvalidCertificateError} carrying a
 * single generic message, so nothing about the credential leaks upstream.
 */

import { PDFDocument } from 'pdf-lib';
import forge from 'node-forge';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { PDFCorruptedError, PDFEngineError } from '../errors';

/**
 * Bytes reserved in /Contents for the DER-encoded CMS container.
 * The @signpdf default (8192) is enough for a single self-signed
 * certificate, but user-provided P12 files often embed a CA chain —
 * 16384 absorbs multi-certificate chains at a negligible size cost.
 */
const SIGNATURE_PLACEHOLDER_LENGTH = 16384;

/**
 * Business error raised when the provided P12/PFX cannot be used: wrong
 * passphrase, corrupt/truncated DER, no private key or certificate bag,
 * or a private key that matches none of the bundled certificates.
 *
 * The message is intentionally generic — it MUST never distinguish
 * "wrong passphrase" from "broken file" (anti-enumeration) and MUST
 * never contain any user-supplied secret.
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

/**
 * Pre-flight validation of the P12 container with node-forge, using the
 * exact same parsing parameters as `P12Signer` (`asn1StrictParsing: false`).
 *
 * Doing this BEFORE the signing pipeline gives a deterministic error
 * classification: anything that fails here is a credential problem
 * (user-facing 400), while later pipeline failures are internal errors.
 */
function assertReadableP12(p12: Uint8Array, passphrase: string): void {
  try {
    const der = forge.util.createBuffer(Buffer.from(p12).toString('binary'));
    const asn1 = forge.asn1.fromDer(der);
    const pkcs12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);

    // `forge.pki.oids` is an open string map — narrow under
    // noUncheckedIndexedAccess before using the values as index types.
    const keyBagType = forge.pki.oids.pkcs8ShroudedKeyBag;
    const certBagType = forge.pki.oids.certBag;
    if (!keyBagType || !certBagType) {
      throw new Error('forge OIDs unavailable');
    }

    const keyBags = pkcs12.getBags({ bagType: keyBagType })[keyBagType];
    if (!keyBags || keyBags.length === 0 || !keyBags[0]?.key) {
      throw new Error('missing private key bag');
    }

    const certBags = pkcs12.getBags({ bagType: certBagType })[certBagType];
    if (!certBags || certBags.length === 0) {
      throw new Error('missing certificate bag');
    }
  } catch {
    // Deliberately swallow the underlying forge message: it may describe
    // the failure mode ("MAC could not be verified…") but must never
    // reach logs/responses alongside anything user-identifiable.
    throw new PdfSignInvalidCertificateError();
  }
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

  // 1. Credential pre-flight — fail fast with the business error before
  //    touching the document.
  assertReadableP12(p12, passphrase);

  // 2. Load the PDF (structure validation).
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
  } catch (err) {
    throw new PDFCorruptedError(
      `Failed to load PDF for signing: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. Placeholder + serialization + CMS signing. Errors past the
  //    pre-flight are either a key/cert mismatch inside the P12 (still a
  //    credential problem) or an internal pipeline failure.
  try {
    pdflibAddPlaceholder({
      pdfDoc,
      reason: reason ?? '',
      location: location ?? '',
      contactInfo: contactInfo ?? '',
      name: signerName ?? '',
      signatureLength: SIGNATURE_PLACEHOLDER_LENGTH,
      appName: 'GigaPDF',
    });

    // useObjectStreams: false is REQUIRED — @signpdf locates the
    // /ByteRange placeholder by scanning the raw bytes.
    const withPlaceholder = await pdfDoc.save({ useObjectStreams: false });

    const signer = new P12Signer(Buffer.from(p12), { passphrase });
    const signed = await new SignPdf().sign(Buffer.from(withPlaceholder), signer);

    return { bytes: new Uint8Array(signed) };
  } catch (err) {
    if (err instanceof PDFEngineError) throw err;

    // P12Signer throws when the private key matches none of the bundled
    // certificates — a credential problem the pre-flight cannot detect.
    if (err instanceof Error && /certificate that matches the private key/i.test(err.message)) {
      throw new PdfSignInvalidCertificateError();
    }

    // Generic internal failure. The underlying message is intentionally
    // dropped: it can only describe library internals, and keeping the
    // surface generic guarantees no credential material ever leaks.
    throw new PDFEngineError('Failed to sign PDF', 'PDF_SIGN_FAILED');
  }
}
