/**
 * PDF digital signature route (PKCS#7 detached, adbe.pkcs7.detached).
 *
 * POST /api/pdf/sign
 *
 * Form fields (multipart/form-data):
 *   file        — PDF file (required)
 *   p12         — PKCS#12 certificate (.p12/.pfx, required, ≤ 1 MB)
 *   passphrase  — P12 passphrase (optional, defaults to empty string)
 *   reason      — /Reason (optional, ≤ 255 chars)
 *   location    — /Location (optional, ≤ 255 chars)
 *   contactInfo — /ContactInfo (optional, ≤ 255 chars)
 *   signerName  — /Name (optional, ≤ 255 chars)
 *   timestamp   — "true" to embed an RFC 3161 trusted timestamp (PAdES-B-T,
 *                 eIDAS advanced) via FreeTSA. Default "false" (plain PKCS#7).
 *
 * Returns the signed PDF as application/pdf.
 *
 * SECURITY (non-negotiable):
 *   - The P12 bytes and the passphrase are NEVER persisted (memory only,
 *     scoped to this request) and NEVER logged. The only logger call in
 *     this handler serializes the engine error object, whose messages are
 *     sanitized by the engine (generic, credential-free).
 *   - Credential failures return a single generic 400 message so a caller
 *     cannot distinguish "wrong passphrase" from "broken certificate".
 */

import { NextResponse } from 'next/server';
import {
  signPdf,
  signPdfTimestamped,
  PdfSignInvalidCertificateError,
  PdfSignTimestampError,
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

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

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
      const raw = formData.get(field);
      if (raw === null) continue;
      if (typeof raw !== 'string') {
        return NextResponse.json(
          { success: false, error: `${field} must be a string.` },
          { status: 400 },
        );
      }
      const trimmed = raw.trim();
      if (trimmed.length > MAX_FIELD_LENGTH) {
        return NextResponse.json(
          { success: false, error: `${field} must be at most ${MAX_FIELD_LENGTH} characters.` },
          { status: 400 },
        );
      }
      if (trimmed) optional[field] = trimmed;
    }

    // Opt-in PAdES-B-T: embed an RFC 3161 trusted timestamp from a fixed,
    // server-controlled TSA (FreeTSA). The TSA URL is never taken from the
    // request, so there is no SSRF surface here.
    const timestampRequested = formData.get('timestamp') === 'true';

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

    const result = timestampRequested
      ? await signPdfTimestamped(new Uint8Array(pdfBuffer), signOptions)
      : await signPdf(new Uint8Array(pdfBuffer), signOptions);

    return new Response(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(result.bytes.byteLength),
      },
    });
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
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }
    // Engine errors are sanitized upstream (PDF_SIGN_FAILED carries a
    // generic message). Do NOT log or echo any request payload here.
    serverLogger.error('api.pdf.sign', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to sign PDF.' },
      { status: 500 },
    );
  }
}
