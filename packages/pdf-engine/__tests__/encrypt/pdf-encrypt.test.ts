import { describe, it, expect } from 'vitest';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import { encryptPDF, computePermissionFlags } from '../../src/encrypt/pdf-encrypt';
import { decryptPDF } from '../../src/encrypt/pdf-decrypt';
import { openDocument, closeDocument } from '../../src/engine/document-handle';

// ---------------------------------------------------------------------------
// computePermissionFlags — ISO 32000-1 Table 22 `/P` conformance
//
// Bit layout (1-based): 3 print, 4 modify, 5 copy, 6 annotate, 9 fillForms,
// 10 extract, 11 assemble, 12 printHighQuality. Bits 1–2 and the reserved
// bits 7–8 MUST be 0; high bits 13–32 MUST be 1. The value is a 32-bit signed
// integer. This mirrors the engine's canonical `permissionsToP()`, which
// yields -196 when every permission is granted.
// ---------------------------------------------------------------------------

describe('computePermissionFlags — ISO 32000-1 /P conformance', () => {
  /** Bit positions reserved by the spec that MUST always read 0. */
  const RESERVED_BITS = [0x1, 0x2, 0x40, 0x80]; // bits 1, 2, 7, 8

  it('yields /P = -196 when every permission is granted (matches permissionsToP)', () => {
    expect(computePermissionFlags({})).toBe(-196);
  });

  it('treats an explicit all-true object identically to the default (-196)', () => {
    const flags = computePermissionFlags({
      print: true,
      modify: true,
      copy: true,
      annotate: true,
      fillForms: true,
      extract: true,
      assemble: true,
      printHighQuality: true,
    });
    expect(flags).toBe(-196);
  });

  it('never sets the spec-reserved bits 1, 2, 7, 8 — even when all permissions are denied', () => {
    const allDenied = computePermissionFlags({
      print: false,
      modify: false,
      copy: false,
      annotate: false,
      fillForms: false,
      extract: false,
      assemble: false,
      printHighQuality: false,
    });
    for (const bit of RESERVED_BITS) {
      expect(allDenied & bit).toBe(0);
    }
    // All-denied keeps only the high reserved bits set ⇒ 0xFFFFF000 = -4096.
    expect(allDenied).toBe(-4096);
  });

  it('clears exactly the print bit (3) when printing is disallowed', () => {
    const noPrint = computePermissionFlags({ print: false });
    // -196 with bit 3 (0x4) cleared.
    expect(noPrint).toBe(-196 & ~0x4);
    expect(noPrint & 0x4).toBe(0);
    // Other permission bits stay granted.
    expect(noPrint & 0x10).toBe(0x10); // copy still on
  });

  it('clears exactly the copy bit (5) when copying is disallowed', () => {
    const noCopy = computePermissionFlags({ copy: false });
    expect(noCopy).toBe(-196 & ~0x10);
    expect(noCopy & 0x10).toBe(0);
    expect(noCopy & 0x4).toBe(0x4); // print still on
  });

  it('keeps the high reserved bits (13–32) set for every combination', () => {
    const combos: Parameters<typeof computePermissionFlags>[0][] = [
      {},
      { print: false },
      { extract: false, assemble: false },
      { print: false, modify: false, copy: false, annotate: false },
    ];
    for (const combo of combos) {
      // 0xFFFFF000 = bits 13..32. They must all remain set.
      expect(computePermissionFlags(combo) & 0xfffff000).toBe(-4096 & 0xfffff000);
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuffer(fixture: string): Buffer {
  return Buffer.from(loadFixture(fixture));
}

// ---------------------------------------------------------------------------
// encryptPDF
// ---------------------------------------------------------------------------

describe('encryptPDF', () => {
  it('returns a Buffer without throwing when ownerPassword is provided', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await encryptPDF(buffer, { ownerPassword: 'ownerPass' });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a Buffer when only userPassword is provided', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await encryptPDF(buffer, { userPassword: 'userPass' });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a Buffer when both passwords are provided', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await encryptPDF(buffer, {
      userPassword: 'user',
      ownerPassword: 'owner',
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('throws PDFEngineError when no password is provided', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    await expect(encryptPDF(buffer, {})).rejects.toThrow();
  });

  it('throws with code PDF_ENCRYPT_NO_PASSWORD when no password is provided', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    try {
      await encryptPDF(buffer, {});
      expect.fail('Expected encryptPDF to throw');
    } catch (err: unknown) {
      expect((err as { code: string }).code).toBe('PDF_ENCRYPT_NO_PASSWORD');
    }
  });

  it('produces a structurally valid encrypted PDF (header + /Encrypt)', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await encryptPDF(buffer, { ownerPassword: 'owner' });

    const latin1 = result.toString('latin1');
    expect(latin1.startsWith('%PDF-')).toBe(true);
    expect(latin1).toContain('/Encrypt');
  });

  it('accepts a permissions object without throwing', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await encryptPDF(buffer, {
      ownerPassword: 'owner',
      permissions: { print: false, copy: false },
    });

    expect(result).toBeInstanceOf(Buffer);
  });

  it('accepts the AES-128 algorithm hint without throwing', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await encryptPDF(buffer, {
      ownerPassword: 'owner',
      algorithm: 'AES-128',
    });

    expect(result).toBeInstanceOf(Buffer);
  });

  it('accepts the AES-256 algorithm hint without throwing', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await encryptPDF(buffer, {
      ownerPassword: 'owner',
      algorithm: 'AES-256',
    });

    expect(result).toBeInstanceOf(Buffer);
  });

  it('throws PDFEngineError when given invalid PDF bytes', async () => {
    const invalid = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await expect(encryptPDF(invalid, { ownerPassword: 'owner' })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// decryptPDF
// ---------------------------------------------------------------------------

describe('decryptPDF', () => {
  it('returns a Buffer from an unencrypted document without throwing', async () => {
    // pdf-lib ignoreEncryption:true means this should succeed for non-encrypted docs
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await decryptPDF(buffer, 'anyPassword');

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('produces a valid PDF from an unencrypted source', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await decryptPDF(buffer, 'anyPassword');

    const handle = await openDocument(new Uint8Array(result));
    expect(handle.pageCount).toBeGreaterThan(0);
    closeDocument(handle);
  });

  it('returns same page count as the source document', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await decryptPDF(buffer, 'pass');

    const doc = await openDocument(new Uint8Array(result));
    const sourceDoc = await openDocument(new Uint8Array(buffer));
    expect(doc.pageCount).toBe(sourceDoc.pageCount);
    closeDocument(doc);
    closeDocument(sourceDoc);
  });

  it('throws an error when given invalid PDF bytes', async () => {
    const invalid = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await expect(decryptPDF(invalid, 'pass')).rejects.toThrow();
  });
});
