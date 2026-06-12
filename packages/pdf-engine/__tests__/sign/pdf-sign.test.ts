/**
 * signPdf — PKCS#7 detached signature with a user-provided P12/PFX.
 *
 * A self-signed certificate + P12 container is generated in-test with
 * node-forge (already an engine dependency), so no binary fixture and no
 * external CA is needed. RSA-2048 keygen is synchronous (~1-3 s) and runs
 * once in beforeAll.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { signPdf, PdfSignInvalidCertificateError } from '../../src/sign';
import { PDFCorruptedError } from '../../src/errors';
import { loadFixture, SIMPLE_PDF } from '../helpers';

const PASSPHRASE = 'test-passphrase-1234';

/** Builds a self-signed X.509 certificate + private key wrapped in a P12. */
function createSelfSignedP12(passphrase: string): Uint8Array {
  const keys = forge.pki.rsa.generateKeyPair(2048);

  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);

  const attrs = [
    { name: 'commonName', value: 'GigaPDF Test Signer' },
    { name: 'countryName', value: 'FR' },
    { name: 'organizationName', value: 'GigaPDF Tests' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyCertSign: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: '3des',
  });
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  return new Uint8Array(Buffer.from(der, 'binary'));
}

describe('signPdf', () => {
  let p12: Uint8Array;
  let pdfBytes: Uint8Array;

  beforeAll(() => {
    p12 = createSelfSignedP12(PASSPHRASE);
    pdfBytes = loadFixture(SIMPLE_PDF);
  }, 30_000);

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
    // The ByteRange placeholder (ten asterisks) must have been patched
    // with real offsets by @signpdf.
    expect(latin1).not.toContain('/**********');
    // Metadata fields are embedded as PDF strings.
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

  it('keeps the document loadable by pdf-lib with the same page count', async () => {
    const original = await PDFDocument.load(pdfBytes);
    const result = await signPdf(pdfBytes, { p12, passphrase: PASSPHRASE });

    const reloaded = await PDFDocument.load(result.bytes);
    expect(reloaded.getPageCount()).toBe(original.getPageCount());
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

  it('signs a minimal in-memory pdf-lib document', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const minimal = await doc.save();

    const result = await signPdf(new Uint8Array(minimal), { p12, passphrase: PASSPHRASE });
    const latin1 = Buffer.from(result.bytes).toString('latin1');
    expect(latin1).toContain('/SubFilter /adbe.pkcs7.detached');
  });
});
