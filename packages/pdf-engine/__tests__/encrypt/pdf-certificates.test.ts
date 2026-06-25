import { describe, it, expect } from 'vitest';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import {
  encryptPDFForCertificates,
  decryptPDFWithPrivateKey,
  normalizeToDer,
} from '../../src/encrypt/pdf-certificates';

function makeBuffer(fixture: string): Buffer {
  return Buffer.from(loadFixture(fixture));
}

// A short, non-PEM byte sequence that looks like the start of a DER SEQUENCE.
const FAKE_DER = new Uint8Array([0x30, 0x82, 0x01, 0x02, 0xde, 0xad, 0xbe, 0xef]);

// ---------------------------------------------------------------------------
// normalizeToDer — DER passthrough + PEM decode
// ---------------------------------------------------------------------------

describe('normalizeToDer', () => {
  it('returns non-PEM (DER) bytes unchanged (same reference)', () => {
    expect(normalizeToDer(FAKE_DER)).toBe(FAKE_DER);
  });

  it('decodes a PEM block back to its exact DER payload', () => {
    const base64 = Buffer.from(FAKE_DER).toString('base64');
    const pem = `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
    const pemBytes = new Uint8Array(Buffer.from(pem, 'latin1'));

    const out = normalizeToDer(pemBytes);
    expect(Buffer.from(out).equals(Buffer.from(FAKE_DER))).toBe(true);
  });

  it('throws PDFInvalidCertificateError on a PEM header with no decodable block', () => {
    const broken = new Uint8Array(
      Buffer.from('-----BEGIN CERTIFICATE-----\n\n', 'latin1'),
    );
    try {
      normalizeToDer(broken);
      expect.fail('Expected normalizeToDer to throw');
    } catch (err: unknown) {
      expect((err as { code: string }).code).toBe('PDF_INVALID_CERTIFICATE');
    }
  });
});

// ---------------------------------------------------------------------------
// encryptPDFForCertificates
// ---------------------------------------------------------------------------

describe('encryptPDFForCertificates', () => {
  it('throws PDFInvalidCertificateError when no certificate is provided', async () => {
    const buffer = makeBuffer(SIMPLE_PDF);
    try {
      await encryptPDFForCertificates(buffer, { certificates: [] });
      expect.fail('Expected encryptPDFForCertificates to throw');
    } catch (err: unknown) {
      expect((err as { code: string }).code).toBe('PDF_INVALID_CERTIFICATE');
    }
  });

  it('throws when given invalid PDF bytes (with a certificate present)', async () => {
    const invalid = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await expect(
      encryptPDFForCertificates(invalid, {
        certificates: [new Uint8Array([0x30, 0x10, 0x01, 0x02])],
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// decryptPDFWithPrivateKey
// ---------------------------------------------------------------------------

describe('decryptPDFWithPrivateKey', () => {
  // A full round-trip (encryptForRecipients → openWithPrivateKey) needs a real
  // X.509 cert + PKCS#1 RSA key fixture; the deterministic checks below cover
  // the wrapper's failure paths (the engine returns null / throws, which the
  // wrapper surfaces as a thrown error).
  it('throws on invalid PDF bytes', async () => {
    const invalid = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await expect(
      decryptPDFWithPrivateKey(
        invalid,
        new Uint8Array([0x30, 0x10, 0x01, 0x02]),
        new Uint8Array([0x30, 0x10, 0x03, 0x04]),
      ),
    ).rejects.toThrow();
  });
});
