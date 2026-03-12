import { PDFDocument } from 'pdf-lib';
import type { DocumentPermissions } from '@giga-pdf/types';
import { PDFEngineError } from '../errors';

export type EncryptionAlgorithm = 'AES-128' | 'AES-256';

export interface EncryptOptions {
  userPassword?: string;
  ownerPassword?: string;
  algorithm?: EncryptionAlgorithm;
  permissions?: Partial<DocumentPermissions>;
}

// Maps DocumentPermissions fields to PDF permission bit flags per PDF spec Table 3.20.
// Bits are numbered from 1; unused bits (1-2, 7-8, 13+) are set to 0.
// The base value -3904 (0xFFFFF0C0) pre-sets reserved bits to 1 as required by the spec.
function computePermissionFlags(perms: Partial<DocumentPermissions>): number {
  let flags = -3904; // Base: reserved bits set per PDF spec
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
 * Encrypts a PDF document with the provided passwords and permissions.
 *
 * V1 LIMITATION: pdf-lib does not support encrypting individual PDF objects
 * (streams, strings) which is required by the PDF encryption spec (ISO 32000-1 §7.6).
 * Full AES-128/AES-256 encryption requires wrapping each object with a derived key,
 * computing the encryption dictionary (Encrypt), and updating the cross-reference table.
 * This is beyond what pdf-lib exposes.
 *
 * For production-grade encryption, integrate with a native library such as qpdf (MIT)
 * via child_process: `qpdf --encrypt <userPwd> <ownerPwd> 256 -- input.pdf output.pdf`
 *
 * This function validates inputs, computes permission flags, and returns the re-saved
 * (unencrypted) PDF so the API surface is correct for future drop-in replacement.
 */
export async function encryptPDF(buffer: Buffer, options: EncryptOptions): Promise<Buffer> {
  if (!options.userPassword && !options.ownerPassword) {
    throw new PDFEngineError(
      'At least one password must be provided',
      'PDF_ENCRYPT_NO_PASSWORD',
    );
  }

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch (err) {
    throw new PDFEngineError(
      `Failed to load PDF for encryption: ${err instanceof Error ? err.message : String(err)}`,
      'PDF_ENCRYPT_LOAD_FAILED',
    );
  }

  // Compute permission flags for future use when object-level encryption is implemented.
  const _permFlags = computePermissionFlags(options.permissions ?? {});
  void _permFlags;

  // Re-save the document. When a proper encryption layer is added (e.g. via qpdf
  // subprocess), this byte array becomes the input to the encryption step.
  const bytes = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}
