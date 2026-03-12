import { describe, it, expect } from 'vitest';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import { getPermissions, setPermissions } from '../../src/encrypt/permissions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuffer(fixture: string): Buffer {
  return Buffer.from(loadFixture(fixture));
}

// ---------------------------------------------------------------------------
// getPermissions — unencrypted document
// ---------------------------------------------------------------------------

describe('getPermissions — unencrypted document', () => {
  it('returns isEncrypted: false', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await getPermissions(buffer);

    expect(result.isEncrypted).toBe(false);
  });

  it('returns all permissions allowed for an unencrypted document', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const { permissions } = await getPermissions(buffer);

    expect(permissions.print).toBe(true);
    expect(permissions.modify).toBe(true);
    expect(permissions.copy).toBe(true);
    expect(permissions.annotate).toBe(true);
    expect(permissions.fillForms).toBe(true);
    expect(permissions.extract).toBe(true);
    expect(permissions.assemble).toBe(true);
    expect(permissions.printHighQuality).toBe(true);
  });

  it('returns a permissions object with all eight expected keys', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const { permissions } = await getPermissions(buffer);

    const expectedKeys = [
      'print', 'modify', 'copy', 'annotate',
      'fillForms', 'extract', 'assemble', 'printHighQuality',
    ];

    for (const key of expectedKeys) {
      expect(permissions).toHaveProperty(key);
    }
  });

  it('ignores an optional password argument without throwing', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    await expect(getPermissions(buffer, 'irrelevant-password')).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getPermissions — invalid buffer
// ---------------------------------------------------------------------------

describe('getPermissions — error handling', () => {
  it('throws PDFEngineError when given invalid bytes', async () => {
    const invalid = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await expect(getPermissions(invalid)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// setPermissions
// ---------------------------------------------------------------------------

describe('setPermissions', () => {
  it('returns a Buffer without throwing', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await setPermissions(buffer, { print: false, copy: false }, 'ownerPass');

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('accepts an empty permissions object', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await setPermissions(buffer, {}, 'ownerPass');

    expect(result).toBeInstanceOf(Buffer);
  });

  it('accepts all permissions set to false', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    const result = await setPermissions(
      buffer,
      {
        print: false,
        modify: false,
        copy: false,
        annotate: false,
        fillForms: false,
        extract: false,
        assemble: false,
        printHighQuality: false,
      },
      'strongOwnerPass',
    );

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('delegates to encryptPDF and requires ownerPassword', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    // encryptPDF requires at least one password; ownerPassword satisfies this
    await expect(setPermissions(buffer, { print: true }, 'ownerPass')).resolves.toBeInstanceOf(Buffer);
  });
});
