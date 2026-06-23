/**
 * PDF Encrypt/Decrypt/Permissions route
 *
 * POST /api/pdf/encrypt
 * Encrypts, decrypts, or reads/sets permissions on a PDF document.
 *
 * Form fields (multipart/form-data):
 *   file      — PDF file (required)
 *   action    — "encrypt" | "decrypt" | "getPermissions" | "setPermissions" (required)
 *
 *   For "encrypt":
 *     userPassword       — string (at least one of user/owner required)
 *     ownerPassword      — string
 *     algorithm          — "AES-128" | "AES-256" (default: "AES-256")
 *     permissions        — JSON DocumentPermissions object (optional, default: all allowed)
 *     print, modify, copy, annotate, fillForms, extract, assemble,
 *     printHighQuality   — individual "true"/"false" boolean fields (optional; the
 *                          /protect UI switches). They override matching keys of
 *                          the `permissions` JSON; any omitted flag stays granted.
 *
 *   For "decrypt":
 *     password           — string (required)
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
} from '@giga-pdf/pdf-engine';
import {
  PDFCorruptedError,
  PDFInvalidPasswordError,
  PDFEncryptedError,
} from '@giga-pdf/pdf-engine';
import type { EncryptionAlgorithm } from '@giga-pdf/pdf-engine';
import type { DocumentPermissions } from '@giga-pdf/types';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

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
    const validActions = ['encrypt', 'decrypt', 'getPermissions', 'setPermissions'];
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

    serverLogger.error('api.pdf.encrypt', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to process encryption operation.' },
      { status: 500 },
    );
  }
}
