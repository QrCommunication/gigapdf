import { describe, it, expect } from 'vitest';
import { mergePDFs } from '../../src/merge-split/merge';
import { openDocument } from '../../src/engine/document-handle';
import { PDFParseError } from '../../src/errors';
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
// mergePDFs — basic behaviour
// ---------------------------------------------------------------------------

describe('mergePDFs', () => {
  it('merges 2 single-page PDFs and produces a 2-page result', async () => {
    const a = fixtureBuffer(SIMPLE_PDF); // 1 page
    const b = fixtureBuffer(SIMPLE_PDF); // 1 page

    const merged = await mergePDFs([a, b]);

    expect(await pageCountOf(merged)).toBe(2);
  });

  it('returns a Buffer', async () => {
    const a = fixtureBuffer(SIMPLE_PDF);
    const b = fixtureBuffer(SIMPLE_PDF);

    const merged = await mergePDFs([a, b]);

    expect(Buffer.isBuffer(merged)).toBe(true);
  });

  it('output starts with %PDF- header', async () => {
    const a = fixtureBuffer(SIMPLE_PDF);
    const b = fixtureBuffer(SIMPLE_PDF);

    const merged = await mergePDFs([a, b]);

    expect(merged.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('merges a 1-page and a 5-page PDF to get 6 pages total', async () => {
    const a = fixtureBuffer(SIMPLE_PDF);   // 1 page
    const b = fixtureBuffer(MULTI_PAGE_PDF); // 5 pages

    const merged = await mergePDFs([a, b]);

    expect(await pageCountOf(merged)).toBe(6);
  });

  it('merges 3 documents correctly', async () => {
    const a = fixtureBuffer(SIMPLE_PDF);    // 1
    const b = fixtureBuffer(MULTI_PAGE_PDF); // 5
    const c = fixtureBuffer(SIMPLE_PDF);    // 1

    const merged = await mergePDFs([a, b, c]);

    expect(await pageCountOf(merged)).toBe(7);
  });

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------

  it('throws PDFParseError when given an empty array', async () => {
    await expect(mergePDFs([])).rejects.toBeInstanceOf(PDFParseError);
  });

  it('throws PDFParseError when given a single buffer', async () => {
    await expect(mergePDFs([fixtureBuffer(SIMPLE_PDF)])).rejects.toBeInstanceOf(PDFParseError);
  });

  it('error message from < 2 buffers mentions the requirement', async () => {
    try {
      await mergePDFs([fixtureBuffer(SIMPLE_PDF)]);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as PDFParseError).message).toMatch(/2/);
    }
  });

  it('throws PDFParseError when one buffer contains corrupt data', async () => {
    const good = fixtureBuffer(SIMPLE_PDF);
    const bad = Buffer.from('not a pdf at all');

    await expect(mergePDFs([good, bad])).rejects.toBeInstanceOf(PDFParseError);
  });

  it('PDFParseError code is PDF_PARSE_ERROR', async () => {
    try {
      await mergePDFs([]);
    } catch (err) {
      expect((err as PDFParseError).code).toBe('PDF_PARSE_ERROR');
    }
  });

  // -------------------------------------------------------------------------
  // Page ranges
  // -------------------------------------------------------------------------

  it('merges with page ranges — selects only the specified pages', async () => {
    const a = fixtureBuffer(MULTI_PAGE_PDF); // 5 pages
    const b = fixtureBuffer(MULTI_PAGE_PDF); // 5 pages

    // Take pages 1-2 from a and pages 4-5 from b  →  4 pages total
    const merged = await mergePDFs([a, b], {
      pageRanges: [
        [{ start: 1, end: 2 }],
        [{ start: 4, end: 5 }],
      ],
    });

    expect(await pageCountOf(merged)).toBe(4);
  });

  it('null pageRange entry includes all pages from that document', async () => {
    const a = fixtureBuffer(SIMPLE_PDF);    // 1 page  (range = null → all)
    const b = fixtureBuffer(MULTI_PAGE_PDF); // 5 pages (range = [2,2] → 1)

    const merged = await mergePDFs([a, b], {
      pageRanges: [
        null,
        [{ start: 2, end: 2 }],
      ],
    });

    expect(await pageCountOf(merged)).toBe(2); // 1 + 1
  });

  it('single-page range from a 5-page doc produces 1-page output', async () => {
    const a = fixtureBuffer(MULTI_PAGE_PDF);
    const b = fixtureBuffer(MULTI_PAGE_PDF);

    const merged = await mergePDFs([a, b], {
      pageRanges: [
        [{ start: 3, end: 3 }],
        [{ start: 3, end: 3 }],
      ],
    });

    expect(await pageCountOf(merged)).toBe(2);
  });

  it('merging with all pages via explicit range matches merging without ranges', async () => {
    const a = fixtureBuffer(MULTI_PAGE_PDF);
    const b = fixtureBuffer(MULTI_PAGE_PDF);

    const withoutRanges = await mergePDFs([a, b]);
    const withAllRanges = await mergePDFs([a, b], {
      pageRanges: [
        [{ start: 1, end: 5 }],
        [{ start: 1, end: 5 }],
      ],
    });

    expect(await pageCountOf(withoutRanges)).toBe(await pageCountOf(withAllRanges));
  });

  it('supports multiple disjoint ranges per document', async () => {
    const a = fixtureBuffer(MULTI_PAGE_PDF); // 5 pages
    const b = fixtureBuffer(MULTI_PAGE_PDF); // 5 pages

    // From a: pages 1 + pages 3-4 = 3 pages; from b: all 5 → total 8
    const merged = await mergePDFs([a, b], {
      pageRanges: [
        [{ start: 1, end: 1 }, { start: 3, end: 4 }],
        null,
      ],
    });

    expect(await pageCountOf(merged)).toBe(8);
  });
});
