/**
 * PDF Encrypt/Decrypt/Permissions route
 *
 * POST /api/pdf/encrypt
 * Encrypts, decrypts, or reads/sets permissions on a PDF document. Encryption
 * comes in two flavours: password (Standard Security Handler) and certificate
 * (public-key / Adobe.PubSec — ISO 32000-1 §7.6.5).
 *
 * Form fields (multipart/form-data):
 *   file      — PDF file (required)
 *   action    — "encrypt" | "decrypt" | "encryptCertificate" |
 *               "decryptCertificate" | "getPermissions" | "setPermissions" (required)
 *
 *   For "encrypt" (password):
 *     userPassword       — string (at least one of user/owner required)
 *     ownerPassword      — string
 *     algorithm          — "AES-128" | "AES-256" (default: "AES-256")
 *     permissions        — JSON DocumentPermissions object (optional, default: all allowed)
 *     print, modify, copy, annotate, fillForms, extract, assemble,
 *     printHighQuality   — individual "true"/"false" boolean fields (optional; the
 *                          /protect UI switches). They override matching keys of
 *                          the `permissions` JSON; any omitted flag stays granted.
 *
 *   For "decrypt" (password):
 *     password           — string (required)
 *
 *   For "encryptCertificate" (public-key / certificate security):
 *     certificates[]     — one or more recipient X.509 certificate files (DER or
 *                          PEM, .cer/.crt/.pem/.der). At least one required; every
 *                          holder of a matching private key can open the result.
 *     algorithm          — "AES-128" | "AES-256" (default: "AES-256")
 *     permissions / individual flag fields — same as the password "encrypt" path.
 *
 *   For "decryptCertificate" (public-key / certificate security):
 *     certificate        — recipient X.509 certificate file (DER or PEM, required)
 *     privateKey         — recipient PKCS#1 RSA private key file (DER or PEM, required)
 *
 *   For "setPermissions":
 *     ownerPassword      — string (required)
 *     permissions        — JSON DocumentPermissions object (required)
 *
 * DocumentPermissions schema:
 * {
 *   print?: boolean,
 *   modify?: boolean,
 *   copy?: boolean,
 *   annotate?: boolean,
 *   fillForms?: boolean,
 *   extract?: boolean,
 *   assemble?: boolean,
 *   printHighQuality?: boolean
 * }
 *
 * "encrypt" / "decrypt" / "setPermissions" return the modified PDF as application/pdf.
 * "getPermissions" returns JSON with isEncrypted and permissions.
 */

import { NextResponse } from 'next/server';
import {
  encryptPDF,
  decryptPDF,
  getPermissions,
  setPermissions,
  encryptPDFForCertificates,
  decryptPDFWithPrivateKey,
} from '@giga-pdf/pdf-engine';
import {
  PDFCorruptedError,
  PDFInvalidPasswordError,
  PDFEncryptedError,
  PDFInvalidCertificateError,
} from '@giga-pdf/pdf-engine';
import type { EncryptionAlgorithm } from '@giga-pdf/pdf-engine';
import type { DocumentPermissions } from '@giga-pdf/types';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

/**
 * Certificates and private keys are tiny (a DER X.509 cert is a few KB, a PEM is
 * larger but still small) — 256 KB per file is already generous and caps abuse.
 *
 * SECURITY: certificate and private-key bytes transit only inside this request
 * (memory, scoped to the call); they are never persisted, cached, or logged.
 */
const MAX_CERT_FILE_SIZE_BYTES = 256 * 1024;

/** Sanity cap on the number of recipients per public-key encryption request. */
const MAX_RECIPIENTS = 50;

/**
 * The eight ISO 32000-1 (Table 22) access-permission form fields accepted on
 * `encrypt`. Each maps 1:1 to a {@link DocumentPermissions} key. The /protect
 * UI sends them as individual `"true"`/`"false"` switches.
 */
const PERMISSION_FIELDS = [
  'print',
  'modify',
  'copy',
  'annotate',
  'fillForms',
  'extract',
  'assemble',
  'printHighQuality',
] as const satisfies readonly (keyof DocumentPermissions)[];

/**
 * Read the individual permission switches from the form. Returns the subset of
 * flags that were explicitly provided (`"true"`/`"false"`), or `undefined` when
 * none were sent so callers leave the existing/default permissions untouched.
 * Backward compatible: omitting every flag yields `undefined` ⇒ all granted.
 */
function collectPermissionFlags(
  formData: FormData,
): Partial<DocumentPermissions> | undefined {
  let flags: Partial<DocumentPermissions> | undefined;
  for (const key of PERMISSION_FIELDS) {
    const raw = formData.get(key);
    if (typeof raw !== 'string') continue;
    flags = { ...flags, [key]: raw === 'true' };
  }
  return flags;
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const action = formData.get('action') as string | null;
    const validActions = [
      'encrypt',
      'decrypt',
      'encryptCertificate',
      'decryptCertificate',
      'getPermissions',
      'setPermissions',
    ];
    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        {
          success: false,
          error: `action must be one of: ${validActions.join(', ')}.`,
        },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (action === 'getPermissions') {
      const result = await getPermissions(buffer);
      return NextResponse.json({
        success: true,
        data: result,
      });
    }

    if (action === 'encrypt') {
      const userPassword = formData.get('userPassword') as string | null;
      const ownerPassword = formData.get('ownerPassword') as string | null;

      if (!userPassword && !ownerPassword) {
        return NextResponse.json(
          { success: false, error: 'At least one of userPassword or ownerPassword is required.' },
          { status: 400 },
        );
      }

      const algorithm = (formData.get('algorithm') as EncryptionAlgorithm | null) ?? 'AES-256';
      const validAlgorithms: EncryptionAlgorithm[] = ['AES-128', 'AES-256'];
      if (!validAlgorithms.includes(algorithm)) {
        return NextResponse.json(
          {
            success: false,
            error: `algorithm must be one of: ${validAlgorithms.join(', ')}.`,
          },
          { status: 400 },
        );
      }

      // Permissions can arrive two ways (precedence: individual flags win):
      //   1. A single `permissions` JSON object (legacy / programmatic callers).
      //   2. Individual boolean form fields (the /protect UI switches), one per
      //      ISO 32000-1 access permission. Any flag left unset stays granted.
      const permissionsRaw = formData.get('permissions') as string | null;
      let permissions: Partial<DocumentPermissions> | undefined;
      if (permissionsRaw) {
        try {
          permissions = JSON.parse(permissionsRaw) as Partial<DocumentPermissions>;
        } catch {
          return NextResponse.json(
            { success: false, error: 'permissions must be valid JSON.' },
            { status: 400 },
          );
        }
      }

      const flagFields = collectPermissionFlags(formData);
      if (flagFields) {
        permissions = { ...permissions, ...flagFields };
      }

      const encryptedBuffer = await encryptPDF(buffer, {
        userPassword: userPassword ?? undefined,
        ownerPassword: ownerPassword ?? undefined,
        algorithm,
        permissions,
      });

      return new Response(new Uint8Array(encryptedBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': sanitizeContentDisposition(file.name),
          'Content-Length': String(encryptedBuffer.byteLength),
        },
      });
    }

    if (action === 'decrypt') {
      const password = formData.get('password') as string | null;
      if (!password) {
        return NextResponse.json(
          { success: false, error: 'password is required for decrypt action.' },
          { status: 400 },
        );
      }

      const decryptedBuffer = await decryptPDF(buffer, password);

      return new Response(new Uint8Array(decryptedBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': sanitizeContentDisposition(file.name),
          'Content-Length': String(decryptedBuffer.byteLength),
        },
      });
    }

    if (action === 'encryptCertificate') {
      const certEntries = formData.getAll('certificates[]');
      const certFiles = certEntries.filter(
        (entry): entry is File => entry instanceof File && entry.size > 0,
      );

      if (certFiles.length === 0) {
        return NextResponse.json(
          { success: false, error: 'At least one recipient certificate is required.' },
          { status: 400 },
        );
      }
      if (certFiles.length > MAX_RECIPIENTS) {
        return NextResponse.json(
          { success: false, error: `At most ${MAX_RECIPIENTS} recipients are allowed.` },
          { status: 400 },
        );
      }
      if (certFiles.some((cert) => cert.size > MAX_CERT_FILE_SIZE_BYTES)) {
        return NextResponse.json(
          { success: false, error: 'A certificate file exceeds the 256 KB size limit.' },
          { status: 400 },
        );
      }

      const algorithm = (formData.get('algorithm') as EncryptionAlgorithm | null) ?? 'AES-256';
      const validAlgorithms: EncryptionAlgorithm[] = ['AES-128', 'AES-256'];
      if (!validAlgorithms.includes(algorithm)) {
        return NextResponse.json(
          {
            success: false,
            error: `algorithm must be one of: ${validAlgorithms.join(', ')}.`,
          },
          { status: 400 },
        );
      }

      // Permissions arrive exactly like the password "encrypt" path: an optional
      // `permissions` JSON object overridden by individual boolean flag fields.
      const permissionsRaw = formData.get('permissions') as string | null;
      let permissions: Partial<DocumentPermissions> | undefined;
      if (permissionsRaw) {
        try {
          permissions = JSON.parse(permissionsRaw) as Partial<DocumentPermissions>;
        } catch {
          return NextResponse.json(
            { success: false, error: 'permissions must be valid JSON.' },
            { status: 400 },
          );
        }
      }
      const flagFields = collectPermissionFlags(formData);
      if (flagFields) {
        permissions = { ...permissions, ...flagFields };
      }

      const certificates = await Promise.all(
        certFiles.map(async (cert) => new Uint8Array(await cert.arrayBuffer())),
      );

      const encryptedBuffer = await encryptPDFForCertificates(buffer, {
        certificates,
        algorithm,
        permissions,
      });

      return new Response(new Uint8Array(encryptedBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': sanitizeContentDisposition(file.name),
          'Content-Length': String(encryptedBuffer.byteLength),
        },
      });
    }

    if (action === 'decryptCertificate') {
      const certEntry = formData.get('certificate');
      const keyEntry = formData.get('privateKey');

      if (!(certEntry instanceof File) || certEntry.size === 0) {
        return NextResponse.json(
          { success: false, error: 'certificate file is required for decryptCertificate action.' },
          { status: 400 },
        );
      }
      if (!(keyEntry instanceof File) || keyEntry.size === 0) {
        return NextResponse.json(
          { success: false, error: 'privateKey file is required for decryptCertificate action.' },
          { status: 400 },
        );
      }
      if (
        certEntry.size > MAX_CERT_FILE_SIZE_BYTES ||
        keyEntry.size > MAX_CERT_FILE_SIZE_BYTES
      ) {
        return NextResponse.json(
          { success: false, error: 'The certificate or private key exceeds the 256 KB size limit.' },
          { status: 400 },
        );
      }

      const [certificate, privateKey] = await Promise.all([
        certEntry.arrayBuffer().then((b) => new Uint8Array(b)),
        keyEntry.arrayBuffer().then((b) => new Uint8Array(b)),
      ]);

      const decryptedBuffer = await decryptPDFWithPrivateKey(buffer, certificate, privateKey);

      return new Response(new Uint8Array(decryptedBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': sanitizeContentDisposition(file.name),
          'Content-Length': String(decryptedBuffer.byteLength),
        },
      });
    }

    // action === 'setPermissions'
    const ownerPassword = formData.get('ownerPassword') as string | null;
    if (!ownerPassword) {
      return NextResponse.json(
        { success: false, error: 'ownerPassword is required for setPermissions action.' },
        { status: 400 },
      );
    }

    const permissionsRaw = formData.get('permissions') as string | null;
    if (!permissionsRaw) {
      return NextResponse.json(
        { success: false, error: 'permissions (JSON) is required for setPermissions action.' },
        { status: 400 },
      );
    }

    let permissions: Record<string, boolean>;
    try {
      permissions = JSON.parse(permissionsRaw) as Record<string, boolean>;
    } catch {
      return NextResponse.json(
        { success: false, error: 'permissions must be valid JSON.' },
        { status: 400 },
      );
    }

    const updatedBuffer = await setPermissions(buffer, permissions, ownerPassword);

    return new Response(new Uint8Array(updatedBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(file.name),
        'Content-Length': String(updatedBuffer.byteLength),
      },
    });
  } catch (error: unknown) {
    if (error instanceof PDFCorruptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF file is corrupted.' },
        { status: 422 },
      );
    }

    if (error instanceof PDFInvalidPasswordError) {
      return NextResponse.json(
        { success: false, error: 'Invalid password.' },
        { status: 401 },
      );
    }

    if (error instanceof PDFEncryptedError) {
      return NextResponse.json(
        { success: false, error: 'PDF is encrypted — password required.' },
        { status: 401 },
      );
    }

    if (error instanceof PDFInvalidCertificateError) {
      // Generic on purpose: never reveal whether the certificate or the private
      // key was at fault, and never log the credential payload (the error
      // message is engine-generic, but we skip logging it entirely here).
      return NextResponse.json(
        { success: false, error: 'Invalid certificate or private key.' },
        { status: 400 },
      );
    }

    serverLogger.error('api.pdf.encrypt', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to process encryption operation.' },
      { status: 500 },
    );
  }
}
