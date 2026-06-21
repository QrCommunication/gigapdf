/**
 * Smoke tests for the image/text/RTF → PDF wrappers and the universal merge,
 * all running against the real in-house WASM engine (`@qrcommunication/gigapdf-lib`).
 *
 *  - imageToPdf(pngBytes)            → valid 1-page PDF
 *  - textToPdf / rtfToPdf            → valid PDF
 *  - mergeUniversal([pdf, png])     → valid PDF, pageCount = sum of parts
 *  - single-file shortcut           → returns the conversion directly
 *  - detection by extension + magic → both paths exercised
 *  - unknown type                   → throws
 */
import { describe, it, expect } from 'vitest';
import { imageToPdf } from '../../src/convert/image-to-pdf';
import { textToPdf, rtfToPdf } from '../../src/convert/text-to-pdf';
import { mergeUniversal } from '../../src/convert/merge-universal';
import { getEngine } from '../../src/wasm';

/** Does a buffer start with the PDF magic `%PDF-`? */
function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
}

/** Re-open a produced PDF and return its page count. */
async function pageCount(bytes: Uint8Array): Promise<number> {
  const giga = await getEngine();
  const doc = giga.open(bytes);
  try {
    return doc.pageCount();
  } finally {
    doc.close();
  }
}

/**
 * A 1×1 RGB PNG (color type 2) — a real, decodable image payload the engine's
 * image decoder accepts. (Greyscale/alpha PNGs are not decoded by this build,
 * so we use the same RGB fixture as the image-renderer tests.)
 */
const PNG_1x1 = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, // PNG magic
  0, 0, 0, 13, 73, 72, 68, 82, // IHDR length + type
  0, 0, 0, 1, // width: 1
  0, 0, 0, 1, // height: 1
  8, 2, // bit depth 8, color type 2 (RGB)
  0, 0, 0, // compression, filter, interlace
  144, 119, 83, 222, // IHDR CRC
  0, 0, 0, 12, 73, 68, 65, 84, // IDAT length + type
  8, 215, 99, 248, 207, 192, 0, 0, 0, 3, 0, 1,
  54, 174, 213, 252, // IDAT CRC
  0, 0, 0, 0, 73, 69, 78, 68, // IEND
  174, 66, 96, 130, // IEND CRC
]);

describe('imageToPdf', () => {
  it('turns a PNG into a non-empty, valid 1-page PDF', async () => {
    const pdf = await imageToPdf(PNG_1x1);
    expect(pdf.length).toBeGreaterThan(0);
    expect(isPdf(pdf)).toBe(true);
    expect(await pageCount(pdf)).toBe(1);
  });

  it('throws on non-image bytes', async () => {
    await expect(imageToPdf(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/could not convert image/i);
  });
});

describe('textToPdf / rtfToPdf', () => {
  it('renders plain text (string) into a valid PDF', async () => {
    const pdf = await textToPdf('Hello universal merge');
    expect(isPdf(pdf)).toBe(true);
  });

  it('accepts UTF-8 bytes as text input', async () => {
    const pdf = await textToPdf(new TextEncoder().encode('bytes input'));
    expect(isPdf(pdf)).toBe(true);
  });

  it('renders RTF into a valid PDF', async () => {
    const pdf = await rtfToPdf('{\\rtf1\\ansi Hello RTF}');
    expect(isPdf(pdf)).toBe(true);
  });
});

describe('mergeUniversal', () => {
  it('throws when given no files', async () => {
    await expect(mergeUniversal([])).rejects.toThrow(/at least one file/i);
  });

  it('returns the single conversion directly for one file (no merge step)', async () => {
    const out = await mergeUniversal([{ bytes: PNG_1x1, filename: 'pic.png' }]);
    expect(isPdf(out)).toBe(true);
    expect(await pageCount(out)).toBe(1);
  });

  it('merges a PDF + a PNG into one PDF whose page count is the sum', async () => {
    // Build a 1-page PDF from the image, then merge [that PDF] + [the PNG].
    const onePagePdf = await imageToPdf(PNG_1x1);
    expect(await pageCount(onePagePdf)).toBe(1);

    const merged = await mergeUniversal([
      { bytes: onePagePdf, filename: 'doc.pdf' },
      { bytes: PNG_1x1, filename: 'pic.png' },
    ]);

    expect(isPdf(merged)).toBe(true);
    expect(merged.length).toBeGreaterThan(onePagePdf.length);
    expect(await pageCount(merged)).toBe(2);
  });

  it('detects types by magic bytes when no filename is supplied', async () => {
    const onePagePdf = await imageToPdf(PNG_1x1); // %PDF magic → passthrough
    const merged = await mergeUniversal([
      { bytes: onePagePdf }, // sniffed as PDF
      { bytes: PNG_1x1 }, // sniffed as PNG image
    ]);
    expect(isPdf(merged)).toBe(true);
    expect(await pageCount(merged)).toBe(2);
  });

  it('aggregates and reports files whose type cannot be determined', async () => {
    const onePagePdf = await imageToPdf(PNG_1x1);
    await expect(
      mergeUniversal([
        { bytes: onePagePdf, filename: 'ok.pdf' },
        { bytes: new Uint8Array([0x00, 0x01, 0x02]), filename: 'mystery.bin' },
      ]),
    ).rejects.toThrow(/mystery\.bin/);
  });
});
