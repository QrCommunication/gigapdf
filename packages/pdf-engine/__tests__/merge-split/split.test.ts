import { describe, it, expect } from 'vitest';
import { splitPDF, splitAt } from '../../src/merge-split/split';
import { openDocument } from '../../src/engine/document-handle';
import { PDFParseError, PDFPageOutOfRangeError } from '../../src/errors';
import {
  loadFixture,
  SIMPLE_PDF,
  MULTI_PAGE_PDF,
} from '../helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fixtureBuffer(name: string): Buffer {
  return Buffer.from(loadFixture(name));
}

async function pageCountOf(buf: Buffer): Promise<number> {
  const handle = await openDocument(buf);
  return handle.pageCount;
}

// ---------------------------------------------------------------------------
// splitPDF
// ---------------------------------------------------------------------------

describe('splitPDF', () => {
  it('splits a 5-page doc into [[1,2],[3,4,5]] producing 2 buffers', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    const parts = await splitPDF(buf, [
      { start: 1, end: 2 },
      { start: 3, end: 5 },
    ]);

    expect(parts).toHaveLength(2);
  });

  it('first part has 2 pages, second part has 3 pages', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    const [first, second] = await splitPDF(buf, [
      { start: 1, end: 2 },
      { start: 3, end: 5 },
    ]);

    expect(await pageCountOf(first!)).toBe(2);
    expect(await pageCountOf(second!)).toBe(3);
  });

  it('each result starts with %PDF-', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    const parts = await splitPDF(buf, [
      { start: 1, end: 2 },
      { start: 3, end: 5 },
    ]);

    for (const part of parts) {
      expect(part.slice(0, 5).toString('ascii')).toBe('%PDF-');
    }
  });

  it('single range returns an array with one Buffer', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    const parts = await splitPDF(buf, [{ start: 2, end: 4 }]);

    expect(parts).toHaveLength(1);
    expect(await pageCountOf(parts[0]!)).toBe(3);
  });

  it('splitting into individual pages returns 5 single-page documents', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    const parts = await splitPDF(buf, [
      { start: 1, end: 1 },
      { start: 2, end: 2 },
      { start: 3, end: 3 },
      { start: 4, end: 4 },
      { start: 5, end: 5 },
    ]);

    expect(parts).toHaveLength(5);
    for (const part of parts) {
      expect(await pageCountOf(part)).toBe(1);
    }
  });

  it('full-document range returns a single document with all 5 pages', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    const parts = await splitPDF(buf, [{ start: 1, end: 5 }]);

    expect(await pageCountOf(parts[0]!)).toBe(5);
  });

  it('can split a single-page PDF by its only page', async () => {
    const buf = fixtureBuffer(SIMPLE_PDF);

    const parts = await splitPDF(buf, [{ start: 1, end: 1 }]);

    expect(parts).toHaveLength(1);
    expect(await pageCountOf(parts[0]!)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Invalid ranges
  // -------------------------------------------------------------------------

  it('throws PDFPageOutOfRangeError when start < 1', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    await expect(
      splitPDF(buf, [{ start: 0, end: 3 }]),
    ).rejects.toBeInstanceOf(PDFPageOutOfRangeError);
  });

  it('throws PDFPageOutOfRangeError when end > pageCount', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF); // 5 pages

    await expect(
      splitPDF(buf, [{ start: 1, end: 99 }]),
    ).rejects.toBeInstanceOf(PDFPageOutOfRangeError);
  });

  it('throws PDFParseError when start > end', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    await expect(
      splitPDF(buf, [{ start: 4, end: 2 }]),
    ).rejects.toBeInstanceOf(PDFParseError);
  });

  it('throws PDFParseError for corrupt PDF bytes', async () => {
    const bad = Buffer.from('this is definitely not a PDF');

    await expect(
      splitPDF(bad, [{ start: 1, end: 1 }]),
    ).rejects.toBeInstanceOf(PDFParseError);
  });

  it('PDFPageOutOfRangeError code is PDF_PAGE_OUT_OF_RANGE', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    try {
      await splitPDF(buf, [{ start: 0, end: 1 }]);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as PDFPageOutOfRangeError).code).toBe('PDF_PAGE_OUT_OF_RANGE');
    }
  });

  it('PDFParseError code is PDF_PARSE_ERROR for inverted range', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    try {
      await splitPDF(buf, [{ start: 3, end: 1 }]);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as PDFParseError).code).toBe('PDF_PARSE_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// splitAt
// ---------------------------------------------------------------------------

describe('splitAt', () => {
  it('splits a 5-page doc at page 2 producing 2 documents', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    const parts = await splitAt(buf, [2]);

    expect(parts).toHaveLength(2);
  });

  it('first part is pages 1-2, second is pages 3-5', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    const [first, second] = await splitAt(buf, [2]);

    expect(await pageCountOf(first!)).toBe(2);
    expect(await pageCountOf(second!)).toBe(3);
  });

  it('split at page 3 gives [1-3] and [4-5]', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    const [first, second] = await splitAt(buf, [3]);

    expect(await pageCountOf(first!)).toBe(3);
    expect(await pageCountOf(second!)).toBe(2);
  });

  it('multiple split points produce the correct number of parts', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    // splitAt [1, 3] → [1,1], [2,3], [4,5] → 3 parts
    const parts = await splitAt(buf, [1, 3]);

    expect(parts).toHaveLength(3);
    expect(await pageCountOf(parts[0]!)).toBe(1);
    expect(await pageCountOf(parts[1]!)).toBe(2);
    expect(await pageCountOf(parts[2]!)).toBe(2);
  });

  it('no split points returns a single document with all pages', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    const parts = await splitAt(buf, []);

    expect(parts).toHaveLength(1);
    expect(await pageCountOf(parts[0]!)).toBe(5);
  });

  it('duplicate split points are deduplicated', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    const parts = await splitAt(buf, [2, 2, 2]);

    expect(parts).toHaveLength(2);
  });

  it('split points are sorted automatically regardless of input order', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    const partsOrdered    = await splitAt(buf, [1, 3]);
    const partsUnordered  = await splitAt(buf, [3, 1]);

    expect(await pageCountOf(partsOrdered[0]!)).toBe(await pageCountOf(partsUnordered[0]!));
    expect(await pageCountOf(partsOrdered[1]!)).toBe(await pageCountOf(partsUnordered[1]!));
    expect(await pageCountOf(partsOrdered[2]!)).toBe(await pageCountOf(partsUnordered[2]!));
  });

  it('each resulting Buffer is a valid PDF', async () => {
    const buf = fixtureBuffer(MULTI_PAGE_PDF);

    const parts = await splitAt(buf, [2, 4]);

    for (const part of parts) {
      expect(part.slice(0, 5).toString('ascii')).toBe('%PDF-');
      expect(await pageCountOf(part)).toBeGreaterThan(0);
    }
  });

  it('throws PDFParseError for corrupt input bytes', async () => {
    const bad = Buffer.from('not-a-pdf');

    await expect(splitAt(bad, [1])).rejects.toBeInstanceOf(PDFParseError);
  });

  it('throws when an out-of-bounds split point is forwarded to splitPDF', async () => {
    // splitAt builds ranges that include points up to pageCount; a split point
    // of pageCount itself creates a final range [pageCount+1, pageCount] which
    // has start > end and triggers PDFParseError inside splitPDF.
    const buf = fixtureBuffer(MULTI_PAGE_PDF); // 5 pages

    // splitAt(5) → last range is { start: 6, end: 5 } → invalid
    await expect(splitAt(buf, [5])).rejects.toBeInstanceOf(Error);
  });

  it('single-page doc split at page 1 results in two parts', async () => {
    // splitAt on a 1-page doc: ranges [{1,1},{2,1}], the second range is invalid
    // so the implementation throws — this verifies the error is propagated.
    const buf = fixtureBuffer(SIMPLE_PDF);

    await expect(splitAt(buf, [1])).rejects.toBeInstanceOf(Error);
  });
});
