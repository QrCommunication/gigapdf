/**
 * Remove the password protection from a PDF via the WASM engine.
 *
 * POST /api/pdf/unlock
 *
 * Opens a password-protected PDF with the supplied password and returns a
 * **plaintext** copy with the encryption stripped — the single-responsibility
 * counterpart of the /unlock dashboard tool. Unlike the multi-action
 * `/api/pdf/encrypt` route (which decrypts by re-saving the opened document),
 * this route uses `GigaPdfDoc.removeEncryption()`, the engine primitive that
 * guarantees a document with no `/Encrypt` dictionary (ISO 32000-1 §7.6).
 *
 * Form fields (multipart/form-data):
 *   file      — PDF file (required)
 *   password  — the user (or owner) password protecting the document. Required
 *               only when the PDF is actually encrypted; ignored otherwise.
 *
 * Behaviour:
 *   - PDF not encrypted    → returned unchanged (200, X-PDF-Unlock-Status:
 *                            not-encrypted). Removing protection from an open
 *                            document is a no-op, so there is nothing to do.
 *   - encrypted, no pwd    → 400 (password required).
 *   - encrypted, wrong pwd → 422 (openEncrypted returns null).
 *   - encrypted, good pwd  → 200 application/pdf (the decrypted, unprotected PDF).
 *   - corrupt / unparsable → 422.
 *
 * SECURITY: the password transits only inside this request (memory, scoped to
 * the call); it is never persisted, cached, or logged.
 *
 * The engine is called directly here (rather than via @giga-pdf/pdf-engine)
 * because `removeEncryption()` is exposed on GigaPdfDoc;
 * @qrcommunication/gigapdf-lib is a server-external package whose `gigapdf.wasm`
 * is traced for `/api/pdf/**` (see next.config.ts).
 */

import { NextResponse } from 'next/server';
import { GigaPdfEngine, type GigaPdfDoc } from '@qrcommunication/gigapdf-lib';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';
import { serverLogger } from '@/lib/server-logger';
import { validatePdfFile } from '@/lib/request-validation';

/**
 * The Rust→WASM engine, instantiated once and shared across requests. Mirrors
 * the singleton in @giga-pdf/pdf-engine — `loadDefault()` reads the self-
 * contained `gigapdf.wasm` from disk (no third-party PDF libraries).
 */
let enginePromise: Promise<GigaPdfEngine> | null = null;
function getEngine(): Promise<GigaPdfEngine> {
  enginePromise ??= GigaPdfEngine.loadDefault();
  return enginePromise;
}

function pdfResponse(bytes: Uint8Array, filename: string, status: string): Response {
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': sanitizeContentDisposition(filename),
      'Content-Length': String(bytes.byteLength),
      'X-PDF-Unlock-Status': status,
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

    const passwordRaw = formData.get('password');
    const password = typeof passwordRaw === 'string' ? passwordRaw : '';

    const bytes = new Uint8Array(await file.arrayBuffer());
    const giga = await getEngine();

    // Inspect the `/Encrypt` dictionary without decrypting — lets us treat an
    // already-plaintext PDF as a no-op instead of failing it as "wrong password"
    // (openEncrypted would return null for a document that has no password).
    let info: { encrypted: boolean };
    try {
      info = giga.encryptionInfo(bytes);
    } catch (parseError: unknown) {
      serverLogger.warn('api.pdf.unlock.parse', { error: parseError });
      return NextResponse.json(
        { success: false, error: 'The file could not be read as a PDF. It may be corrupted.' },
        { status: 422 },
      );
    }

    if (!info.encrypted) {
      // Nothing to remove — hand the original bytes back unchanged.
      return pdfResponse(bytes, file.name, 'not-encrypted');
    }

    if (!password) {
      return NextResponse.json(
        { success: false, error: 'This PDF is password-protected. A password is required to unlock it.' },
        { status: 400 },
      );
    }

    let doc: GigaPdfDoc | null = null;
    try {
      doc = giga.openEncrypted(bytes, password);
      if (!doc) {
        return NextResponse.json(
          { success: false, error: 'Incorrect password. The PDF could not be unlocked.' },
          { status: 422 },
        );
      }

      const unlocked = doc.removeEncryption();
      return pdfResponse(unlocked, file.name, 'unlocked');
    } catch (engineError: unknown) {
      // The password matched (openEncrypted returned a doc) but stripping the
      // encryption failed — a corrupt/unsupported source, client-correctable.
      serverLogger.warn('api.pdf.unlock.engine', { error: engineError });
      return NextResponse.json(
        { success: false, error: 'Failed to remove the protection. The PDF may be corrupted or unsupported.' },
        { status: 422 },
      );
    } finally {
      doc?.close();
    }
  } catch (error: unknown) {
    serverLogger.error('api.pdf.unlock', { error });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to unlock the PDF.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
