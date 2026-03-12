import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import type { DocumentPermissions } from '@giga-pdf/types';
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

// All permissions denied — returned as fallback for encrypted documents
// where the permission flags cannot be read.
const ALL_PERMISSIONS_DENIED: DocumentPermissions = {
  print: false,
  modify: false,
  copy: false,
  annotate: false,
  fillForms: false,
  extract: false,
  assemble: false,
  printHighQuality: false,
};

/**
 * Parses an integer permission bitmask (PDF spec Table 3.20) into a DocumentPermissions object.
 */
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
 * Reads the encryption status and permission flags from a PDF document.
 *
 * Permission flags are stored in the Encrypt dictionary's /P entry (a signed 32-bit integer).
 * pdf-lib exposes the trailer, which contains a reference to the Encrypt dictionary when
 * the document is encrypted.
 *
 * @param buffer - PDF bytes to inspect
 * @param password - Optional password for encrypted documents (unused in v1, see note in pdf-decrypt.ts)
 */
export async function getPermissions(buffer: Buffer, password?: string): Promise<PermissionsResult> {
  void password;

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch (err) {
    throw new PDFEngineError(
      `Failed to load PDF for permission inspection: ${err instanceof Error ? err.message : String(err)}`,
      'PDF_PERMISSIONS_LOAD_FAILED',
    );
  }

  // Check for an Encrypt dictionary in the trailer.
  const trailer = pdfDoc.context.trailerInfo;
  const encryptRef = trailer.Encrypt;

  if (encryptRef == null) {
    // No Encrypt entry — document is not encrypted, all operations permitted.
    return { isEncrypted: false, permissions: { ...ALL_PERMISSIONS_ALLOWED } };
  }

  // Attempt to resolve the Encrypt dictionary and read the /P (permissions) entry.
  try {
    const encryptDict = pdfDoc.context.lookup(encryptRef);

    if (encryptDict != null && 'get' in encryptDict) {
      const pEntry = (encryptDict as { get: (key: PDFName) => unknown }).get(PDFName.of('P'));

      if (pEntry instanceof PDFNumber) {
        const flags = pEntry.asNumber();
        return { isEncrypted: true, permissions: parsePermissionFlags(flags) };
      }
    }
  } catch {
    // If we can't read the permissions entry, fall through to the denied default.
  }

  // Encrypted but permissions flags could not be resolved — deny everything conservatively.
  return { isEncrypted: true, permissions: { ...ALL_PERMISSIONS_DENIED } };
}

/**
 * Returns a new PDF with the specified permissions applied.
 *
 * This delegates to `encryptPDF`, which sets the permission flags in the encryption
 * dictionary. An owner password is required to change permissions per the PDF spec.
 *
 * V1 LIMITATION: Because `encryptPDF` does not yet apply object-level encryption,
 * the returned PDF will have the permission intent recorded but not enforced at the
 * byte level. See `pdf-encrypt.ts` for the full explanation and upgrade path.
 *
 * @param buffer - Source PDF bytes
 * @param permissions - Permission flags to apply
 * @param ownerPassword - Owner password required to modify permissions
 */
export async function setPermissions(
  buffer: Buffer,
  permissions: Partial<DocumentPermissions>,
  ownerPassword: string,
): Promise<Buffer> {
  return encryptPDF(buffer, {
    ownerPassword,
    permissions,
  });
}
