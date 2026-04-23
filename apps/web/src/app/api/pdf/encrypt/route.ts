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
import { requireSession } from '@/lib/auth-helpers';

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();

    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: file' },
        { status: 400 },
      );
    }

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

      const permissionsRaw = formData.get('permissions') as string | null;
      let permissions: Record<string, boolean> | undefined;
      if (permissionsRaw) {
        try {
          permissions = JSON.parse(permissionsRaw) as Record<string, boolean>;
        } catch {
          return NextResponse.json(
            { success: false, error: 'permissions must be valid JSON.' },
            { status: 400 },
          );
        }
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
          'Content-Disposition': `attachment; filename="${file.name}"`,
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
          'Content-Disposition': `attachment; filename="${file.name}"`,
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
        'Content-Disposition': `attachment; filename="${file.name}"`,
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

    console.error('[api/pdf/encrypt]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process encryption operation.' },
      { status: 500 },
    );
  }
}
