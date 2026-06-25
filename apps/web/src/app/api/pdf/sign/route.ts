/**
 * PDF digital-signature route. A single POST handles three actions, selected by
 * the `action` form field (default `"sign"`):
 *
 *   action=sign     — apply a PKCS#7 detached signature (`adbe.pkcs7.detached`),
 *                     optionally PAdES-B-T (RFC 3161 timestamp) or PAdES-LTV
 *                     (B-LT: chain + OCSP/CRL in a /DSS). Returns the signed PDF.
 *   action=certify  — DocMDP author certification: like sign but declares which
 *                     later changes are permitted (`docmdpLevel` 1|2|3). The
 *                     identity is a generated self-signed ID. Returns the PDF.
 *   action=verify   — list every signature and cryptographically verify each
 *                     one. Returns JSON (`{ signatures, reports }`).
 *
 * POST /api/pdf/sign  (multipart/form-data)
 *
 * Common field:
 *   file        — PDF file (required).
 *   action      — "sign" | "certify" | "verify" (optional, default "sign").
 *
 * action=sign fields:
 *   p12         — PKCS#12 certificate (.p12/.pfx, required, ≤ 1 MB)
 *   passphrase  — P12 passphrase (optional, defaults to empty string)
 *   reason      — /Reason (optional, ≤ 255 chars)
 *   location    — /Location (optional, ≤ 255 chars)
 *   contactInfo — /ContactInfo (optional, ≤ 255 chars)
 *   signerName  — /Name (optional, ≤ 255 chars)
 *   timestamp   — "true" to embed an RFC 3161 trusted timestamp (PAdES-B-T).
 *   ltv         — "true" for long-term validation (PAdES-B-LT). Takes precedence
 *                 over `timestamp` (LTV always embeds a B-T timestamp).
 *
 * action=certify fields:
 *   docmdpLevel — "1" | "2" | "3" (required): 1 = no changes, 2 = form-fill +
 *                 sign, 3 = also annotate.
 *   reason      — /Reason (optional, ≤ 255 chars)
 *   signerName  — /Name (optional, ≤ 255 chars)
 *
 * SECURITY (non-negotiable):
 *   - The P12 bytes and the passphrase are NEVER persisted (memory only,
 *     scoped to this request) and NEVER logged. The only logger call in
 *     this handler serializes the engine error object, whose messages are
 *     sanitized by the engine (generic, credential-free).
 *   - Credential failures return a single generic 400 message so a caller
 *     cannot distinguish "wrong passphrase" from "broken certificate".
 *   - SSRF: only `action=sign` with `ltv=true` performs cert-derived OCSP/CRL
 *     fetches, and those are SSRF-guarded inside `signPdfLtv` (private/reserved
 *     IPs are blocked, responder skipped). `verify` and `certify` make no
 *     network calls at all.
 */

import { NextResponse } from 'next/server';
import {
  signPdf,
  signPdfTimestamped,
  signPdfLtv,
  verifyPdfSignatures,
  certifyPdf,
  type DocMdpLevel,
  PdfSignInvalidCertificateError,
  PdfSignTimestampError,
  PdfSignLtvError,
  PDFCorruptedError,
} from '@giga-pdf/pdf-engine';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

/** P12 containers are small (key + cert chain) — 1 MB is already generous. */
const MAX_P12_SIZE_BYTES = 1024 * 1024;

/** Hard cap on the optional signature metadata fields. */
const MAX_FIELD_LENGTH = 255;

/** Sanity cap on the passphrase length (PKCS#12 passwords are short). */
const MAX_PASSPHRASE_LENGTH = 1024;

const OPTIONAL_FIELDS = ['reason', 'location', 'contactInfo', 'signerName'] as const;
type OptionalField = (typeof OPTIONAL_FIELDS)[number];

/** The supported request actions, selected by the `action` form field. */
type SignAction = 'sign' | 'certify' | 'verify';

/**
 * Reads, type-checks and length-caps an optional metadata field from the form.
 * Returns the trimmed value (or `undefined` when absent/empty), or a ready-made
 * 400 response when the value is the wrong type or too long.
 */
function readOptionalField(
  formData: FormData,
  field: OptionalField,
): { ok: true; value: string | undefined } | { ok: false; response: Response } {
  const raw = formData.get(field);
  if (raw === null) return { ok: true, value: undefined };
  if (typeof raw !== 'string') {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: `${field} must be a string.` },
        { status: 400 },
      ),
    };
  }
  const trimmed = raw.trim();
  if (trimmed.length > MAX_FIELD_LENGTH) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: `${field} must be at most ${MAX_FIELD_LENGTH} characters.` },
        { status: 400 },
      ),
    };
  }
  return { ok: true, value: trimmed || undefined };
}

/** Builds the signed-PDF binary response shared by `sign` and `certify`. */
function pdfBinaryResponse(bytes: Uint8Array, fileName: string): Response {
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': sanitizeContentDisposition(fileName),
      'Content-Length': String(bytes.byteLength),
    },
  });
}

/**
 * action=verify — list every signature and verify each one. Returns JSON; the
 * engine call is read-only and makes no network request.
 */
async function handleVerify(file: File): Promise<Response> {
  const pdfBuffer = await file.arrayBuffer();
  const result = await verifyPdfSignatures(new Uint8Array(pdfBuffer));
  return NextResponse.json({ success: true, data: result });
}

/**
 * action=certify — DocMDP author certification (self-signed identity, no P12).
 * Returns the certified PDF binary.
 */
async function handleCertify(file: File, formData: FormData): Promise<Response> {
  const levelRaw = formData.get('docmdpLevel');
  const level = typeof levelRaw === 'string' ? Number(levelRaw) : NaN;
  if (level !== 1 && level !== 2 && level !== 3) {
    return NextResponse.json(
      { success: false, error: 'docmdpLevel must be 1, 2 or 3.' },
      { status: 400 },
    );
  }

  const reason = readOptionalField(formData, 'reason');
  if (!reason.ok) return reason.response;
  const signerName = readOptionalField(formData, 'signerName');
  if (!signerName.ok) return signerName.response;

  const pdfBuffer = await file.arrayBuffer();
  const result = await certifyPdf(new Uint8Array(pdfBuffer), {
    docmdpLevel: level as DocMdpLevel,
    reason: reason.value,
    signerName: signerName.value,
  });
  return pdfBinaryResponse(result.bytes, file.name);
}

/**
 * action=sign — PKCS#7 detached signature with a user-provided P12, optionally
 * PAdES-B-T (timestamp) or PAdES-LTV. Returns the signed PDF binary.
 */
async function handleSign(file: File, formData: FormData): Promise<Response> {
  const p12Entry = formData.get('p12');
  if (!p12Entry || !(p12Entry instanceof File) || p12Entry.size === 0) {
    return NextResponse.json(
      { success: false, error: 'p12 certificate file is required.' },
      { status: 400 },
    );
  }
  if (p12Entry.size > MAX_P12_SIZE_BYTES) {
    return NextResponse.json(
      { success: false, error: 'p12 certificate exceeds the 1 MB size limit.' },
      { status: 400 },
    );
  }

  const passphraseRaw = formData.get('passphrase');
  const passphrase = typeof passphraseRaw === 'string' ? passphraseRaw : '';
  if (passphrase.length > MAX_PASSPHRASE_LENGTH) {
    return NextResponse.json(
      { success: false, error: 'passphrase is too long.' },
      { status: 400 },
    );
  }

  const optional: Partial<Record<OptionalField, string>> = {};
  for (const field of OPTIONAL_FIELDS) {
    const read = readOptionalField(formData, field);
    if (!read.ok) return read.response;
    if (read.value !== undefined) optional[field] = read.value;
  }

  // Opt-in PAdES-B-T: embed an RFC 3161 trusted timestamp from a fixed,
  // server-controlled TSA (FreeTSA). The TSA URL is never taken from the
  // request, so there is no SSRF surface here.
  const timestampRequested = formData.get('timestamp') === 'true';
  // Opt-in PAdES-LTV (B-LT): adds a /DSS with the chain + OCSP/CRL revocation
  // material on top of a B-T signature. LTV always embeds a B-T timestamp, so
  // it takes precedence over `timestamp`. The OCSP/CRL responder URLs come
  // from the user's certificate and are SSRF-guarded inside `signPdfLtv`.
  const ltvRequested = formData.get('ltv') === 'true';

  const [pdfBuffer, p12Buffer] = await Promise.all([
    file.arrayBuffer(),
    p12Entry.arrayBuffer(),
  ]);

  const signOptions = {
    p12: new Uint8Array(p12Buffer),
    passphrase,
    reason: optional.reason,
    location: optional.location,
    contactInfo: optional.contactInfo,
    signerName: optional.signerName,
  } as const;

  const result = ltvRequested
    ? await signPdfLtv(new Uint8Array(pdfBuffer), signOptions)
    : timestampRequested
      ? await signPdfTimestamped(new Uint8Array(pdfBuffer), signOptions)
      : await signPdf(new Uint8Array(pdfBuffer), signOptions);

  return pdfBinaryResponse(result.bytes, file.name);
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const actionRaw = formData.get('action');
    const action: SignAction =
      actionRaw === 'verify' || actionRaw === 'certify' ? actionRaw : 'sign';

    if (action === 'verify') return await handleVerify(file);
    if (action === 'certify') return await handleCertify(file, formData);
    return await handleSign(file, formData);
  } catch (error: unknown) {
    if (error instanceof PdfSignInvalidCertificateError) {
      // Generic on purpose: never reveal whether the passphrase or the
      // certificate itself was at fault, and never echo any input back.
      return NextResponse.json(
        {
          success: false,
          error: 'Certificat ou mot de passe invalide',
          code: 'INVALID_CERTIFICATE_OR_PASSPHRASE',
        },
        { status: 400 },
      );
    }
    if (error instanceof PdfSignTimestampError) {
      // The signature itself is fine; the trusted-timestamp authority could
      // not be reached. 502 (upstream dependency failure) lets the client tell
      // the user to retry rather than blame their certificate.
      return NextResponse.json(
        {
          success: false,
          error: "Autorité d'horodatage injoignable",
          code: 'TSA_UNREACHABLE',
        },
        { status: 502 },
      );
    }
    if (error instanceof PdfSignLtvError) {
      // The credential is fine; the long-term-validation infrastructure (the
      // mandatory timestamp / archival TSA leg) was unreachable. 502 lets the
      // client invite a retry rather than blame the certificate. Unreachable
      // OCSP/CRL responders are NOT fatal (skipped inside signPdfLtv).
      return NextResponse.json(
        {
          success: false,
          error: 'Validation long-terme indisponible',
          code: 'LTV_UNREACHABLE',
        },
        { status: 502 },
      );
    }
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }
    // Engine errors are sanitized upstream (PDF_SIGN_FAILED / PDF_CERTIFY_FAILED
    // / PDF_VERIFY_FAILED carry generic messages). Do NOT log or echo any
    // request payload here.
    serverLogger.error('api.pdf.sign', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to process the signature request.' },
      { status: 500 },
    );
  }
}
