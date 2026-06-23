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
import { isBlockedFetchUrl } from '../convert/html-to-pdf';
import { PDFCorruptedError, PDFEngineError } from '../errors';

/**
 * Default RFC 3161 Time-Stamping Authority used for PAdES-B-T signatures.
 *
 * FreeTSA (https://freetsa.org/tsr) is a public, no-account TSA. This URL is
 * fixed server-side and is NEVER taken from user input — there is therefore no
 * SSRF surface here (the engine only POSTs the `TimeStampReq` to this exact
 * host via its built-in `defaultTsaPost`).
 */
export const FREETSA_TSA_URL = 'https://freetsa.org/tsr';

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

/**
 * Business error raised when a PAdES-B-T (timestamped) signature could not
 * obtain a trusted timestamp: the TSA was unreachable, timed out, or returned
 * an invalid/rejected `TimeStampResp`.
 *
 * Distinct from {@link PdfSignInvalidCertificateError} so the UI can tell the
 * user "the timestamp authority is unreachable, try again" rather than blaming
 * their certificate. Carries no secret and nothing user-supplied.
 */
export class PdfSignTimestampError extends PDFEngineError {
  constructor() {
    super('Timestamp authority unreachable', 'PDF_SIGN_TIMESTAMP_FAILED');
    this.name = 'PdfSignTimestampError';
  }
}

/**
 * Business error raised when a PAdES-LTV signature ({@link signPdfLtv}) could not
 * be completed because a network dependency it MUST reach was unreachable — in
 * practice the TSA (the B-LT/B-LTA tier always embeds a B-T timestamp first via
 * {@link FREETSA_TSA_URL}), or the document-timestamp round trip.
 *
 * Distinct from {@link PdfSignTimestampError} so the API can return a dedicated
 * `LTV_UNREACHABLE` code: an LTV request is a heavier, multi-round-trip
 * operation and "could not reach the revocation/timestamp infrastructure" is a
 * different failure mode from a plain B-T timestamp. NOTE: individual OCSP/CRL
 * responders being unreachable is NOT fatal — the engine simply skips them and
 * builds the DSS from whatever resolves — so this error is reserved for the
 * mandatory TSA leg, never for a skipped responder. Carries no secret and
 * nothing user-supplied.
 */
export class PdfSignLtvError extends PDFEngineError {
  constructor() {
    super('Long-term validation infrastructure unreachable', 'PDF_SIGN_LTV_FAILED');
    this.name = 'PdfSignLtvError';
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

/**
 * Decides whether an error thrown by `signTimestamped` is a TSA/network
 * problem (→ {@link PdfSignTimestampError}) rather than a credential problem.
 * The engine prefixes timestamp-round-trip failures with "TSA"/"timestamp",
 * and `defaultTsaPost` surfaces `fetch` failures (network/DNS/HTTP) — none of
 * which implicate the user's certificate.
 */
function isTimestampFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\b(tsa|timestamp|timestampresp|timestampreq|time-?stamp|fetch failed|failed to fetch|network|enotfound|econnrefused|etimedout|getaddrinfo)\b/i.test(
    err.message,
  );
}

/**
 * Signs a PDF with a PAdES-B-T signature: a PKCS#7 detached signature that
 * additionally embeds an RFC 3161 trusted timestamp (eIDAS *advanced* level)
 * obtained from a Time-Stamping Authority. The timestamp proves the document
 * existed at a verifiable moment, independent of the signer's clock.
 *
 * Like {@link signPdf}, the signature is invisible and covers the whole
 * document via /ByteRange — it MUST be the last operation in a workflow.
 *
 * The TSA round trip is performed by the engine's built-in `defaultTsaPost`
 * against {@link FREETSA_TSA_URL} (a fixed, host-controlled URL — never user
 * input, so no SSRF surface). It is a network call and may fail; such failures
 * surface as {@link PdfSignTimestampError}, distinct from certificate errors.
 *
 * @throws {PdfSignInvalidCertificateError} wrong passphrase or unusable P12
 * @throws {PdfSignTimestampError} the TSA was unreachable or rejected the request
 * @throws {PDFCorruptedError} input bytes are not a loadable PDF
 * @throws {PDFEngineError} internal signing failure (code PDF_SIGN_FAILED)
 */
export async function signPdfTimestamped(
  pdfBytes: Uint8Array,
  opts: SignPdfOptions,
): Promise<SignPdfResult> {
  const { p12, passphrase, reason, location, contactInfo, signerName } = opts;

  if (p12.byteLength === 0) {
    throw new PdfSignInvalidCertificateError();
  }

  const giga = await getEngine();

  let doc: GigaPdfDoc;
  try {
    doc = giga.open(pdfBytes);
  } catch (err) {
    throw new PDFCorruptedError(
      `Failed to load PDF for signing: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    // tsaFetch is intentionally omitted: the engine uses its built-in
    // defaultTsaPost against the fixed FREETSA_TSA_URL. The URL is a constant,
    // never user-supplied, so there is no SSRF surface to allow-list.
    const signed = await doc.signTimestamped({
      p12,
      password: passphrase,
      tsaUrl: FREETSA_TSA_URL,
      name: signerName ?? '',
      reason: reason ?? '',
      date: pdfDateNow(),
      location: location ?? '',
      contactInfo: contactInfo ?? '',
    });
    return { bytes: signed };
  } catch (err) {
    if (err instanceof PDFEngineError) throw err;
    // Order matters: a TSA/network failure is the most likely runtime error
    // and must NOT be misreported as a certificate problem.
    if (isTimestampFailure(err)) {
      throw new PdfSignTimestampError();
    }
    if (err instanceof Error && /PKCS#12 signing failed/i.test(err.message)) {
      throw new PdfSignInvalidCertificateError();
    }
    throw new PDFEngineError('Failed to sign PDF', 'PDF_SIGN_FAILED');
  } finally {
    doc.close();
  }
}

// ── PAdES-LTV (B-LT / B-LTA) ───────────────────────────────────────────────────

/** Per-response cap for OCSP/CRL fetches — keeps a hostile CRL-DP from exhausting memory. */
const MAX_REVOCATION_BYTES = 20 * 1024 * 1024;
/** Hard cap on redirect hops while following an OCSP/CRL responder. */
const MAX_REVOCATION_REDIRECTS = 5;
/** Network timeout (ms) for a single OCSP/CRL responder round trip. */
const REVOCATION_TIMEOUT_MS = 30_000;

/**
 * Performs one host-side OCSP/CRL fetch with the SSRF guard applied on EVERY hop.
 *
 * The responder URL is read by the engine from the signer's certificate chain
 * (the AIA / CRL-DP extensions) — i.e. it is **attacker-influenced**: a hostile
 * P12 can carry an AIA pointing at `http://169.254.169.254/…` (cloud metadata)
 * or an RFC1918 address. So before each request (and after each redirect) the
 * URL passes {@link isBlockedFetchUrl} — the SAME package-level baseline guard
 * the HTML→PDF engine uses for `<img>`/font fetches — which rejects non-http(s)
 * and bare private/reserved IP literals.
 *
 * On a blocked URL this **throws**, which the engine treats as "skip this
 * responder" (the DSS is built from whatever resolves) — exactly the safe
 * degradation we want: an internal/blocked responder is simply omitted from the
 * long-term validation material rather than fetched.
 *
 * @param method `GET` for CRL distribution points, `POST` for OCSP responders.
 * @param body   DER `OCSPRequest` for the POST path; `undefined` for CRL GET.
 */
async function safeRevocationFetch(
  url: string,
  method: 'GET' | 'POST',
  body: Uint8Array | undefined,
  contentType: string | undefined,
): Promise<Uint8Array> {
  let current = url;
  for (let hop = 0; hop <= MAX_REVOCATION_REDIRECTS; hop++) {
    if (isBlockedFetchUrl(current)) {
      // Blocked by the SSRF baseline → tell the engine to skip this responder.
      throw new PDFEngineError(
        'Revocation responder blocked by SSRF policy',
        'PDF_SIGN_LTV_RESPONDER_BLOCKED',
      );
    }
    const res = await fetch(current, {
      method,
      redirect: 'manual',
      headers: contentType ? { 'content-type': contentType } : undefined,
      // Only the first hop carries the request body (OCSP POST). Redirects are
      // re-issued without it so a redirected OCSP can't smuggle the body
      // somewhere new; in practice OCSP responders answer directly. A fresh
      // copy (slice) yields a plain Uint8Array<ArrayBuffer>, the body type the
      // runtime `fetch` accepts.
      body: hop === 0 && body ? body.slice() : undefined,
      signal: AbortSignal.timeout(REVOCATION_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new PDFEngineError('Revocation redirect missing Location', 'PDF_SIGN_LTV_FETCH');
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) {
      throw new PDFEngineError(`Revocation responder HTTP ${res.status}`, 'PDF_SIGN_LTV_FETCH');
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_REVOCATION_BYTES) {
      throw new PDFEngineError('Revocation response empty or too large', 'PDF_SIGN_LTV_FETCH');
    }
    return bytes;
  }
  throw new PDFEngineError('Too many revocation redirects', 'PDF_SIGN_LTV_FETCH');
}

export interface SignPdfLtvOptions extends SignPdfOptions {
  /**
   * Add a B-LTA **document timestamp** over the whole file (DSS included) after
   * the DSS — a second TSA round trip against {@link FREETSA_TSA_URL}. When
   * omitted, only B-LT (DSS with chain + OCSP/CRL) is produced.
   */
  archiveTimestamp?: boolean;
}

/**
 * Signs a PDF with **PAdES long-term validation (LTV)** material embedded:
 * a B-T signature (PKCS#7 detached + RFC 3161 timestamp from FreeTSA) followed
 * by a `/DSS` (Document Security Store) carrying the certificate chain plus the
 * OCSP responses / CRLs the host fetched (PAdES-B-LT), and — with
 * `archiveTimestamp` — a final document timestamp over the whole file
 * (PAdES-B-LTA, renewable archival). The signature then validates long after the
 * signing certificate expires or is revoked.
 *
 * Like {@link signPdf}, the signature is invisible and covers the whole document
 * via /ByteRange — it MUST be the last operation in a workflow.
 *
 * SECURITY — SSRF (OWASP A10): the OCSP/CRL responder URLs are read by the
 * engine from the signer's certificate (AIA / CRL-DP), so they are
 * attacker-influenced. Every such fetch is routed through {@link safeRevocationFetch},
 * which applies the package-level {@link isBlockedFetchUrl} baseline (the same
 * guard the HTML→PDF engine uses) on every hop and degrades by skipping a
 * blocked responder. The TSA URL stays the fixed, host-controlled
 * {@link FREETSA_TSA_URL} (no SSRF surface; the engine's built-in `defaultTsaPost`
 * handles it).
 *
 * @throws {PdfSignInvalidCertificateError} wrong passphrase or unusable P12
 * @throws {PdfSignLtvError} the mandatory timestamp/archival TSA leg was unreachable
 * @throws {PDFCorruptedError} input bytes are not a loadable PDF
 * @throws {PDFEngineError} internal signing failure (code PDF_SIGN_FAILED)
 */
export async function signPdfLtv(
  pdfBytes: Uint8Array,
  opts: SignPdfLtvOptions,
): Promise<SignPdfResult> {
  const { p12, passphrase, reason, location, contactInfo, signerName, archiveTimestamp } = opts;

  if (p12.byteLength === 0) {
    throw new PdfSignInvalidCertificateError();
  }

  const giga = await getEngine();

  let doc: GigaPdfDoc;
  try {
    doc = giga.open(pdfBytes);
  } catch (err) {
    throw new PDFCorruptedError(
      `Failed to load PDF for signing: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    // tsaFetch is intentionally omitted: the engine uses its built-in
    // defaultTsaPost against the fixed FREETSA_TSA_URL (no SSRF surface). Only
    // the cert-derived OCSP/CRL fetches are host-supplied, and they go through
    // the SSRF-guarded helpers below.
    const signed = await doc.signLtv({
      p12,
      password: passphrase,
      tsaUrl: FREETSA_TSA_URL,
      archiveTimestamp: archiveTimestamp ?? false,
      revocationFetch: (req, url) => safeRevocationFetch(url, 'POST', req, 'application/ocsp-request'),
      crlFetch: (url) => safeRevocationFetch(url, 'GET', undefined, undefined),
      name: signerName ?? '',
      reason: reason ?? '',
      date: pdfDateNow(),
      location: location ?? '',
      contactInfo: contactInfo ?? '',
    });
    return { bytes: signed };
  } catch (err) {
    if (err instanceof PDFEngineError) {
      // A blocked OCSP/CRL responder is non-fatal (the engine skips it), so a
      // PDFEngineError surfacing here means the engine itself failed — most
      // likely the mandatory TSA leg. Map our own LTV-fetch markers and the
      // engine's TSA failures to PdfSignLtvError; keep credential errors as-is.
      if (
        err.code === 'PDF_SIGN_LTV_FETCH' ||
        err.code === 'PDF_SIGN_LTV_RESPONDER_BLOCKED' ||
        isTimestampFailure(err)
      ) {
        throw new PdfSignLtvError();
      }
      throw err;
    }
    // The mandatory B-T timestamp (or B-LTA archival timestamp) round trip is
    // the most likely runtime failure — it must NOT be misreported as a
    // credential problem.
    if (isTimestampFailure(err)) {
      throw new PdfSignLtvError();
    }
    if (err instanceof Error && /PKCS#12 signing failed/i.test(err.message)) {
      throw new PdfSignInvalidCertificateError();
    }
    throw new PDFEngineError('Failed to sign PDF', 'PDF_SIGN_FAILED');
  } finally {
    doc.close();
  }
}
