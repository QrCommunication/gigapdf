/**
 * signPdf — PKCS#7 detached signature with a user-provided P12/PFX.
 *
 * Fully native: the P12 import + CMS are built by the in-house Rust→WASM engine
 * (no node-forge, no pdf-lib, no @signpdf). The fixture `signer.p12` is a real
 * OpenSSL-3 container (PBES2/AES-256 + HMAC-SHA256), password "gigapdf".
 */

import { describe, it, expect } from 'vitest';
import { signPdf, PdfSignInvalidCertificateError } from '../../src/sign';
import { PDFCorruptedError } from '../../src/errors';
import { openDocument, closeDocument } from '../../src/engine/document-handle';
import { loadFixture, SIMPLE_PDF } from '../helpers';

const PASSPHRASE = 'gigapdf';
const p12 = loadFixture('signer.p12');
const pdfBytes = loadFixture(SIMPLE_PDF);

describe('signPdf', () => {
  it('produces a PKCS#7 detached signature with ByteRange and adbe.pkcs7.detached', async () => {
    const result = await signPdf(pdfBytes, {
      p12,
      passphrase: PASSPHRASE,
      reason: 'Validation test',
      location: 'Paris',
      contactInfo: 'signer@example.com',
      signerName: 'GigaPDF Test Signer',
    });

    expect(result.bytes.byteLength).toBeGreaterThan(pdfBytes.byteLength);

    const latin1 = Buffer.from(result.bytes).toString('latin1');
    expect(latin1).toContain('/ByteRange');
    expect(latin1).toContain('/SubFilter /adbe.pkcs7.detached');
    // The fixed-width ByteRange placeholder (ten 9s) must have been patched
    // with real offsets.
    expect(latin1).not.toContain('9999999999');
    // Metadata fields are embedded as PDF literal strings.
    expect(latin1).toContain('(Validation test)');
    expect(latin1).toContain('(Paris)');
  });

  it('fills /Contents with a real CMS container (not the zero placeholder)', async () => {
    const result = await signPdf(pdfBytes, { p12, passphrase: PASSPHRASE });

    const latin1 = Buffer.from(result.bytes).toString('latin1');
    const contents = latin1.match(/\/Contents\s*<([0-9a-fA-F]+)>/);
    expect(contents).not.toBeNull();
    // A signed CMS container starts with a DER SEQUENCE (0x30…), never 00.
    expect(contents![1].replace(/0/g, '').length).toBeGreaterThan(100);
    expect(contents![1].startsWith('00')).toBe(false);
  });

  it('keeps the document loadable with the same page count', async () => {
    const before = await openDocument(pdfBytes);
    const originalPages = before.pageCount;
    closeDocument(before);

    const result = await signPdf(pdfBytes, { p12, passphrase: PASSPHRASE });

    const after = await openDocument(result.bytes);
    expect(after.pageCount).toBe(originalPages);
    closeDocument(after);
  });

  it('rejects a wrong passphrase with the business error', async () => {
    await expect(
      signPdf(pdfBytes, { p12, passphrase: 'definitely-wrong-secret' }),
    ).rejects.toBeInstanceOf(PdfSignInvalidCertificateError);
  });

  it('never leaks the passphrase in the error message', async () => {
    const err: unknown = await signPdf(pdfBytes, {
      p12,
      passphrase: 'super-secret-leak-canary',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PdfSignInvalidCertificateError);
    expect(String((err as Error).message)).not.toContain('super-secret-leak-canary');
    expect(String((err as Error).stack ?? '')).not.toContain('super-secret-leak-canary');
  });

  it('rejects garbage P12 bytes with the business error', async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]);
    await expect(
      signPdf(pdfBytes, { p12: garbage, passphrase: PASSPHRASE }),
    ).rejects.toBeInstanceOf(PdfSignInvalidCertificateError);
  });

  it('rejects an empty P12 with the business error', async () => {
    await expect(
      signPdf(pdfBytes, { p12: new Uint8Array(0), passphrase: '' }),
    ).rejects.toBeInstanceOf(PdfSignInvalidCertificateError);
  });

  it('rejects non-PDF input with PDFCorruptedError', async () => {
    const notAPdf = new TextEncoder().encode('definitely not a pdf');
    await expect(signPdf(notAPdf, { p12, passphrase: PASSPHRASE })).rejects.toBeInstanceOf(
      PDFCorruptedError,
    );
  });
});
