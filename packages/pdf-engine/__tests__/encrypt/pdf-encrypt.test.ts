import { describe, it, expect } from 'vitest';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import { encryptPDF } from '../../src/encrypt/pdf-encrypt';
import { decryptPDF } from '../../src/encrypt/pdf-decrypt';
import { openDocument, closeDocument } from '../../src/engine/document-handle';

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
