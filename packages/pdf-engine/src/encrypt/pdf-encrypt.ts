import { randomBytes } from 'node:crypto';
import type { DocumentPermissions } from '@giga-pdf/types';
import { getEngine } from '../wasm';
import { PDFEngineError } from '../errors';

export type EncryptionAlgorithm = 'AES-128' | 'AES-256';

export interface EncryptOptions {
  userPassword?: string;
  ownerPassword?: string;
  algorithm?: EncryptionAlgorithm;
  permissions?: Partial<DocumentPermissions>;
}

/**
 * Maps {@link DocumentPermissions} to the PDF `/P` permission bitmask
 * (ISO 32000-1 Table 22). The base value `-4096` (`0xFFFFF000`) sets every
 * reserved high bit (13–32) to 1 while keeping bits 1–12 clear — crucially
 * bits 7–8, which are reserved and MUST be 0. Each allowed operation flips its
 * own bit on. With every permission granted this yields `/P = -196`, matching
 * the engine's canonical `permissionsToP()`; the previous base `-3904`
 * (`0xFFFFF0C0`) erroneously set reserved bits 7–8, producing a
 * non-conformant `/P` (`-4` for all-allowed).
 */
export function computePermissionFlags(perms: Partial<DocumentPermissions>): number {
  let flags = -4096; // 0xFFFFF000: reserved high bits set, bits 1–12 (incl. reserved 7–8) clear
  if (perms.print !== false) flags |= 0x4; // bit 3
  if (perms.modify !== false) flags |= 0x8; // bit 4
  if (perms.copy !== false) flags |= 0x10; // bit 5
  if (perms.annotate !== false) flags |= 0x20; // bit 6
  if (perms.fillForms !== false) flags |= 0x100; // bit 9
  if (perms.extract !== false) flags |= 0x200; // bit 10
  if (perms.assemble !== false) flags |= 0x400; // bit 11
  if (perms.printHighQuality !== false) flags |= 0x800; // bit 12
  return flags;
}

/**
 * Encrypts a PDF with the PDF Standard Security Handler via the zero-dependency
 * WASM engine — **real** AES-128 / AES-256 with separate user and owner
 * passwords. (The previous pdf-lib implementation was a stub: it could not
 * encrypt object streams and re-saved the document in clear text.)
 */
export async function encryptPDF(buffer: Buffer, options: EncryptOptions): Promise<Buffer> {
  if (!options.userPassword && !options.ownerPassword) {
    throw new PDFEngineError('At least one password must be provided', 'PDF_ENCRYPT_NO_PASSWORD');
  }

  const giga = await getEngine();
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let doc;
  try {
    doc = giga.open(data);
  } catch (err) {
    throw new PDFEngineError(
      `Failed to load PDF for encryption: ${err instanceof Error ? err.message : String(err)}`,
      'PDF_ENCRYPT_LOAD_FAILED',
    );
  }

  try {
    const algorithm = options.algorithm === 'AES-128' ? 'aes128' : 'aes256';
    const permissions = computePermissionFlags(options.permissions ?? {});
    // The open password is the user password; an owner-only request leaves the
    // user password empty (anyone can open, but the permissions are enforced).
    const userPassword = options.userPassword ?? '';
    const fileId = randomBytes(16).toString('hex');

    const encrypted = doc.saveEncrypted(userPassword, fileId, {
      algorithm,
      ownerPassword: options.ownerPassword,
      permissions,
    });
    return Buffer.from(encrypted);
  } finally {
    doc.close();
  }
}
