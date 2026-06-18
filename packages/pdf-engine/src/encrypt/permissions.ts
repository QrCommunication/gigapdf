import type { DocumentPermissions } from '@giga-pdf/types';
import { getEngine } from '../wasm';
import { PDFEngineError } from '../errors';
import { encryptPDF } from './pdf-encrypt';

export interface PermissionsResult {
  isEncrypted: boolean;
  permissions: DocumentPermissions;
}

// All permissions enabled — returned for unencrypted documents.
const ALL_PERMISSIONS_ALLOWED: DocumentPermissions = {
  print: true,
  modify: true,
  copy: true,
  annotate: true,
  fillForms: true,
  extract: true,
  assemble: true,
  printHighQuality: true,
};

/** Decodes a `/P` permission bitmask (ISO 32000 Table 22) into flags. */
function parsePermissionFlags(flags: number): DocumentPermissions {
  return {
    print: (flags & 0x4) !== 0, // bit 3
    modify: (flags & 0x8) !== 0, // bit 4
    copy: (flags & 0x10) !== 0, // bit 5
    annotate: (flags & 0x20) !== 0, // bit 6
    fillForms: (flags & 0x100) !== 0, // bit 9
    extract: (flags & 0x200) !== 0, // bit 10
    assemble: (flags & 0x400) !== 0, // bit 11
    printHighQuality: (flags & 0x800) !== 0, // bit 12
  };
}

/**
 * Reads a PDF's encryption status and permission flags via the zero-dependency
 * WASM engine — `engine.encryptionInfo` parses the `/Encrypt` dictionary's `/P`
 * **without decrypting** (no password needed), so this works on protected files.
 */
export async function getPermissions(
  buffer: Buffer,
  // Permission flags are read from the (cleartext) `/Encrypt` dictionary, so no
  // password is needed; kept optional for backward-compatible call sites.
  _password?: string,
): Promise<PermissionsResult> {
  // `encryptionInfo` is lenient on non-PDF input (it would report "not
  // encrypted"); reject anything without a PDF header up front instead.
  if (!buffer.subarray(0, 1024).includes('%PDF-')) {
    throw new PDFEngineError('Not a valid PDF document', 'PDF_PERMISSIONS_LOAD_FAILED');
  }

  const giga = await getEngine();
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const info = giga.encryptionInfo(data);

  if (!info.encrypted) {
    return { isEncrypted: false, permissions: { ...ALL_PERMISSIONS_ALLOWED } };
  }
  return { isEncrypted: true, permissions: parsePermissionFlags(info.permissions) };
}

/**
 * Returns a new PDF with the requested permissions applied. Delegates to
 * {@link encryptPDF}, which records the permission flags in a real encryption
 * dictionary (an owner password is required to change permissions per the spec).
 */
export async function setPermissions(
  buffer: Buffer,
  permissions: Partial<DocumentPermissions>,
  ownerPassword: string,
): Promise<Buffer> {
  return encryptPDF(buffer, { ownerPassword, permissions });
}
