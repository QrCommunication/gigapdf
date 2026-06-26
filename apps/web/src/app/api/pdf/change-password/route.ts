/**
 * Change / set the password of a PDF via the WASM engine.
 *
 * POST /api/pdf/change-password
 *
 * Rotates (or sets, for an unprotected file) the password protecting a PDF,
 * re-encrypting it with the Standard Security Handler. This is the deliberate
 * counterpart of the two existing tools:
 *   - /api/pdf/unlock  REMOVES the protection (plaintext output).
 *   - /api/pdf/encrypt (the /protect tool) ENCRYPTS a plaintext PDF.
 * Here we CHANGE/SET the password — opening the document with its current
 * password (when already encrypted) is what authorises the change
 * (ISO 32000-1 §7.6).
 *
 * Form fields (multipart/form-data):
 *   file              — PDF file (required)
 *   currentPassword   — the password currently protecting the document. Required
 *                       only when the PDF is actually encrypted; ignored otherwise.
 *   newUserPassword   — the new open/user password (at least one of user or owner
 *                       password is required).
 *   newOwnerPassword  — the new owner password (controls permissions). Optional.
 *   algorithm         — "AES-256" (default) | "AES-128".
 *
 * Behaviour:
 *   - already encrypted, correct currentPassword → re-encrypted with the new
 *     password via GigaPdfDoc.changePasswords(); existing permissions preserved.
 *   - already encrypted, missing currentPassword  → 400.
 *   - already encrypted, wrong currentPassword    → 422 (openEncrypted → null).
 *   - not encrypted                               → password SET via
 *     GigaPdfDoc.saveEncrypted() (open() needs no password).
 *   - no new password supplied                    → 400.
 *   - corrupt / unparsable source                 → 422.
 *
 * SECURITY: every password transits only inside this request (memory, scoped to
 * the call); none is ever persisted, cached, or logged.
 *
 * The engine is called directly here (rather than via @giga-pdf/pdf-engine)
 * because changePasswords()/saveEncrypted()/openEncrypted() are exposed on the
 * GigaPdf* classes of @qrcommunication/gigapdf-lib, a server-external package
 * whose `gigapdf.wasm` is traced for `/api/pdf/**` (see next.config.ts).
 */

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { GigaPdfEngine, type GigaPdfDoc } from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

/**
 * The Rust→WASM engine, instantiated once and shared across requests. Mirrors
 * the singleton in /api/pdf/unlock — `loadDefault()` reads the self-contained
 * `gigapdf.wasm` from disk (no third-party PDF libraries).
 */
let enginePromise: Promise<GigaPdfEngine> | null = null;
function getEngine(): Promise<GigaPdfEngine> {
  enginePromise ??= GigaPdfEngine.loadDefault();
  return enginePromise;
}

/**
 * UI algorithm labels → the engine's lowercase identifiers. RC4 is intentionally
 * not exposed (insecure); the /protect tool also only offers AES-128/256.
 */
const ALGORITHM_MAP = {
  'AES-256': 'aes256',
  'AES-128': 'aes128',
} as const satisfies Record<string, 'aes256' | 'aes128'>;

type AlgorithmLabel = keyof typeof ALGORITHM_MAP;

function isAlgorithmLabel(value: string): value is AlgorithmLabel {
  return Object.hasOwn(ALGORITHM_MAP, value);
}

function pdfResponse(bytes: Uint8Array, filename: string, status: string): Response {
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': sanitizeContentDisposition(filename),
      'Content-Length': String(bytes.byteLength),
      'X-PDF-Password-Status': status,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const fileValidation = validatePdfFile(formData.get('file'));
    if (!fileValidation.ok) return fileValidation.response;
    const file = fileValidation.file;

    const currentPassword = readString(formData.get('currentPassword'));
    const newUserPassword = readString(formData.get('newUserPassword'));
    const newOwnerPassword = readString(formData.get('newOwnerPassword'));

    if (!newUserPassword && !newOwnerPassword) {
      return NextResponse.json(
        {
          success: false,
          error: 'A new password is required (user password, owner password, or both).',
        },
        { status: 400 },
      );
    }

    const algorithmLabel = readString(formData.get('algorithm')) || 'AES-256';
    if (!isAlgorithmLabel(algorithmLabel)) {
      return NextResponse.json(
        {
          success: false,
          error: `algorithm must be one of: ${Object.keys(ALGORITHM_MAP).join(', ')}.`,
        },
        { status: 400 },
      );
    }
    const algorithm = ALGORITHM_MAP[algorithmLabel];

    const bytes = new Uint8Array(await file.arrayBuffer());
    const giga = await getEngine();

    // Inspect the `/Encrypt` dictionary without decrypting — decides whether we
    // rotate an existing password (changePasswords) or set a brand-new one
    // (saveEncrypted), and lets us require the current password only when needed.
    let info: { encrypted: boolean; permissions: number };
    try {
      info = giga.encryptionInfo(bytes);
    } catch (parseError: unknown) {
      serverLogger.warn('api.pdf.change-password.parse', { error: parseError });
      return NextResponse.json(
        { success: false, error: 'The file could not be read as a PDF. It may be corrupted.' },
        { status: 422 },
      );
    }

    if (info.encrypted && !currentPassword) {
      return NextResponse.json(
        {
          success: false,
          error:
            'This PDF is password-protected. The current password is required to change it.',
        },
        { status: 400 },
      );
    }

    let doc: GigaPdfDoc | null = null;
    try {
      // Re-encrypt an already-protected document with the new password (the
      // current password authorises the change), or open the plaintext source.
      if (info.encrypted) {
        doc = giga.openEncrypted(bytes, currentPassword);
        if (!doc) {
          return NextResponse.json(
            { success: false, error: 'Incorrect current password. The PDF could not be opened.' },
            { status: 422 },
          );
        }
      } else {
        doc = giga.open(bytes);
      }

      // `/ID` (any stable hex string) for the new encryption dictionary.
      const fileId = randomUUID().replace(/-/g, '');
      const opts: {
        ownerPassword?: string;
        algorithm: 'aes256' | 'aes128';
        permissions?: number;
      } = { algorithm };
      if (newOwnerPassword) opts.ownerPassword = newOwnerPassword;
      // Rotating a protected file preserves its existing access permissions
      // instead of silently widening them to "everything allowed".
      if (info.encrypted) opts.permissions = info.permissions;

      const out = info.encrypted
        ? doc.changePasswords(newUserPassword, fileId, opts)
        : doc.saveEncrypted(newUserPassword, fileId, opts);

      return pdfResponse(out, file.name, info.encrypted ? 'changed' : 'protected');
    } catch (engineError: unknown) {
      // The document opened (or parsed) but re-encryption failed — a
      // corrupt/unsupported source, client-correctable.
      serverLogger.warn('api.pdf.change-password.engine', { error: engineError });
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to change the password. The PDF may be corrupted or unsupported.',
        },
        { status: 422 },
      );
    } finally {
      doc?.close();
    }
  } catch (error: unknown) {
    serverLogger.error('api.pdf.change-password', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to change the PDF password.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

/**
 * Read a FormData entry as a string (empty when absent / a File). Passwords are
 * NOT trimmed — leading/trailing whitespace can be a legitimate part of one.
 */
function readString(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}
