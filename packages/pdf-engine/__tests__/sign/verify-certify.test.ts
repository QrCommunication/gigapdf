/**
 * verifyPdfSignatures + certifyPdf — list/verify signatures and DocMDP author
 * certification, all on the in-house Rust→WASM engine (no node-forge/pdf-lib).
 *
 * Verification is read-only and offline; certification uses a generated
 * self-signed identity. The fixtures are the same as the sign suite:
 * `signer.p12` (OpenSSL-3, password "gigapdf") and `simple.pdf` (unsigned).
 */

import { describe, it, expect } from 'vitest';
import { signPdf, certifyPdf, verifyPdfSignatures } from '../../src/sign';
import { PDFCorruptedError } from '../../src/errors';
import { openDocument, closeDocument } from '../../src/engine/document-handle';
import { loadFixture, SIMPLE_PDF } from '../helpers';

const PASSPHRASE = 'gigapdf';
const p12 = loadFixture('signer.p12');
const pdfBytes = loadFixture(SIMPLE_PDF);

describe('verifyPdfSignatures', () => {
  it('returns empty arrays for an unsigned PDF', async () => {
    const result = await verifyPdfSignatures(pdfBytes);
    expect(result.signatures).toEqual([]);
    expect(result.reports).toEqual([]);
  });

  it('reports a freshly P12-signed document as cryptographically valid', async () => {
    const signed = await signPdf(pdfBytes, {
      p12,
      passphrase: PASSPHRASE,
      reason: 'Verify round-trip',
      signerName: 'GigaPDF Test Signer',
    });

    const { signatures, reports } = await verifyPdfSignatures(signed.bytes);

    expect(signatures).toHaveLength(1);
    expect(reports).toHaveLength(1);

    const report = reports[0]!;
    expect(report.byteRangeOk).toBe(true);
    expect(report.digestOk).toBe(true);
    expect(report.signatureOk).toBe(true);
    expect(report.coversWholeDocument).toBe(true);

    // The two arrays join by /T field name.
    expect(signatures[0]!.fieldName).toBe(report.fieldName);
    expect(signatures[0]!.subFilter ?? '').toContain('adbe.pkcs7.detached');
  });

  it('flags a document modified after signing as no longer whole-covering', async () => {
    const signed = await signPdf(pdfBytes, { p12, passphrase: PASSPHRASE });
    // Append a byte after the signed region: the signature stays
    // cryptographically valid but no longer covers the whole file.
    const tampered = new Uint8Array(signed.bytes.byteLength + 1);
    tampered.set(signed.bytes, 0);
    tampered[signed.bytes.byteLength] = 0x20; // trailing space

    const { reports } = await verifyPdfSignatures(tampered);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.coversWholeDocument).toBe(false);
  });

  it('rejects non-PDF input with PDFCorruptedError', async () => {
    const notAPdf = new TextEncoder().encode('definitely not a pdf');
    await expect(verifyPdfSignatures(notAPdf)).rejects.toBeInstanceOf(PDFCorruptedError);
  });
});

describe('certifyPdf (DocMDP)', () => {
  it('produces a DocMDP-certified signature that verifies as valid', async () => {
    const certified = await certifyPdf(pdfBytes, {
      docmdpLevel: 2,
      reason: 'Certification test',
      signerName: 'GigaPDF Author',
    });

    expect(certified.bytes.byteLength).toBeGreaterThan(pdfBytes.byteLength);

    const latin1 = Buffer.from(certified.bytes).toString('latin1');
    expect(latin1).toContain('/ByteRange');
    expect(latin1).toContain('/DocMDP');

    // Still loadable with the same page count.
    const before = await openDocument(pdfBytes);
    const originalPages = before.pageCount;
    closeDocument(before);
    const after = await openDocument(certified.bytes);
    expect(after.pageCount).toBe(originalPages);
    closeDocument(after);

    // The self-signed certification verifies cryptographically.
    const { reports } = await verifyPdfSignatures(certified.bytes);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.byteRangeOk).toBe(true);
    expect(reports[0]!.digestOk).toBe(true);
    expect(reports[0]!.signatureOk).toBe(true);
    expect(reports[0]!.coversWholeDocument).toBe(true);
  });

  it('accepts every DocMDP level (1, 2, 3)', async () => {
    for (const level of [1, 2, 3] as const) {
      const certified = await certifyPdf(pdfBytes, { docmdpLevel: level });
      expect(certified.bytes.byteLength).toBeGreaterThan(pdfBytes.byteLength);
    }
  });

  it('rejects non-PDF input with PDFCorruptedError', async () => {
    const notAPdf = new TextEncoder().encode('definitely not a pdf');
    await expect(certifyPdf(notAPdf, { docmdpLevel: 1 })).rejects.toBeInstanceOf(
      PDFCorruptedError,
    );
  });
});
