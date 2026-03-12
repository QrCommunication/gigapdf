import { describe, it, expect } from 'vitest';
import {
  addPage,
  deletePage,
  movePage,
  rotatePage,
  copyPage,
  resizePage,
} from '../../src/engine/page-ops';
import {
  openDocument,
  getPageDimensions,
  type PDFDocumentHandle,
} from '../../src/engine/document-handle';
import { PDFPageOutOfRangeError } from '../../src/errors';
import { DEFAULT_PAGE_WIDTH, DEFAULT_PAGE_HEIGHT } from '../../src/constants';
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

async function openSimple(): Promise<PDFDocumentHandle> {
  return openDocument(fixtureBuffer(SIMPLE_PDF));
}

async function openMulti(): Promise<PDFDocumentHandle> {
  return openDocument(fixtureBuffer(MULTI_PAGE_PDF));
}

// ---------------------------------------------------------------------------
// addPage
// ---------------------------------------------------------------------------

describe('addPage', () => {
  it('increments pageCount by 1', async () => {
    const handle = await openSimple();
    const before = handle.pageCount;

    addPage(handle, 1);

    expect(handle.pageCount).toBe(before + 1);
  });

  it('returns the clamped insertion position', async () => {
    const handle = await openSimple();

    const pos = addPage(handle, 1);

    expect(pos).toBe(1);
  });

  it('new page has the default Letter dimensions when none are specified', async () => {
    const handle = await openSimple();

    addPage(handle, 1);
    const dims = getPageDimensions(handle, 1);

    expect(dims.width).toBeCloseTo(DEFAULT_PAGE_WIDTH, 1);
    expect(dims.height).toBeCloseTo(DEFAULT_PAGE_HEIGHT, 1);
  });

  it('new page has custom dimensions when provided', async () => {
    const handle = await openSimple();

    addPage(handle, 1, 500, 700);
    const dims = getPageDimensions(handle, 1);

    expect(dims.width).toBeCloseTo(500, 1);
    expect(dims.height).toBeCloseTo(700, 1);
  });

  it('appends to the end when position exceeds pageCount', async () => {
    const handle = await openSimple(); // 1 page

    const pos = addPage(handle, 999);

    expect(pos).toBe(2); // clamped to pageCount + 1
    expect(handle.pageCount).toBe(2);
  });

  it('inserts at position 1 when position is 0 or negative', async () => {
    const handle = await openSimple();

    const pos = addPage(handle, 0);

    expect(pos).toBe(1);
  });

  it('marks the document as dirty', async () => {
    const handle = await openSimple();

    addPage(handle, 1);

    expect(handle.isDirty).toBe(true);
  });

  it('can add multiple pages sequentially', async () => {
    const handle = await openSimple();

    addPage(handle, 1);
    addPage(handle, 2);
    addPage(handle, 3);

    expect(handle.pageCount).toBe(4);
  });

  it('inserts in the middle of a multi-page document', async () => {
    const handle = await openMulti(); // 5 pages
    const before = handle.pageCount;

    addPage(handle, 3);

    expect(handle.pageCount).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// deletePage
// ---------------------------------------------------------------------------

describe('deletePage', () => {
  it('removes a page, decrementing pageCount by 1', async () => {
    const handle = await openMulti(); // 5 pages

    deletePage(handle, 2);

    expect(handle.pageCount).toBe(4);
  });

  it('can remove the first page', async () => {
    const handle = await openMulti();

    deletePage(handle, 1);

    expect(handle.pageCount).toBe(4);
  });

  it('can remove the last page', async () => {
    const handle = await openMulti();

    deletePage(handle, 5);

    expect(handle.pageCount).toBe(4);
  });

  it('throws PDFPageOutOfRangeError for page 0', async () => {
    const handle = await openMulti();

    expect(() => deletePage(handle, 0)).toThrow(PDFPageOutOfRangeError);
  });

  it('throws PDFPageOutOfRangeError for page exceeding pageCount', async () => {
    const handle = await openMulti(); // 5 pages

    expect(() => deletePage(handle, 6)).toThrow(PDFPageOutOfRangeError);
  });

  it('error code is PDF_PAGE_OUT_OF_RANGE', async () => {
    const handle = await openMulti();

    try {
      deletePage(handle, 99);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as PDFPageOutOfRangeError).code).toBe('PDF_PAGE_OUT_OF_RANGE');
    }
  });

  it('marks the document as dirty', async () => {
    const handle = await openMulti();

    deletePage(handle, 1);

    expect(handle.isDirty).toBe(true);
  });

  it('does not mutate an unrelated second handle', async () => {
    const a = await openMulti();
    const b = await openMulti();

    deletePage(a, 1);

    expect(a.pageCount).toBe(4);
    expect(b.pageCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// movePage
// ---------------------------------------------------------------------------

describe('movePage', () => {
  it('keeps pageCount the same after a move', async () => {
    const handle = await openMulti();

    await movePage(handle, 5, 1);

    expect(handle.pageCount).toBe(5);
  });

  it('moves page 5 to position 1', async () => {
    const handle = await openMulti();
    const originalLastDims = getPageDimensions(handle, 5);

    await movePage(handle, 5, 1);

    // The page that was last is now first.
    const newFirstDims = getPageDimensions(handle, 1);
    expect(newFirstDims.width).toBeCloseTo(originalLastDims.width, 1);
    expect(newFirstDims.height).toBeCloseTo(originalLastDims.height, 1);
  });

  it('moving a page to its own position is a no-op', async () => {
    const handle = await openMulti();
    const dimsBefore = getPageDimensions(handle, 3);

    await movePage(handle, 3, 3);

    const dimsAfter = getPageDimensions(handle, 3);
    expect(dimsAfter.width).toBeCloseTo(dimsBefore.width, 1);
    expect(dimsAfter.height).toBeCloseTo(dimsBefore.height, 1);
    expect(handle.pageCount).toBe(5);
  });

  it('throws PDFPageOutOfRangeError when fromPage is out of range', async () => {
    const handle = await openMulti();

    await expect(movePage(handle, 0, 1)).rejects.toThrow(PDFPageOutOfRangeError);
  });

  it('throws PDFPageOutOfRangeError when toPage is out of range', async () => {
    const handle = await openMulti();

    await expect(movePage(handle, 1, 99)).rejects.toThrow(PDFPageOutOfRangeError);
  });

  it('marks the document as dirty after a successful move', async () => {
    const handle = await openMulti();

    await movePage(handle, 1, 5);

    expect(handle.isDirty).toBe(true);
  });

  it('can move page 1 to the last position', async () => {
    const handle = await openMulti();

    await movePage(handle, 1, 5);

    expect(handle.pageCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// rotatePage
// ---------------------------------------------------------------------------

describe('rotatePage', () => {
  it('rotates page 1 by 90 degrees', async () => {
    const handle = await openSimple();

    rotatePage(handle, 1, 90);

    expect(getPageDimensions(handle, 1).rotation).toBe(90);
  });

  it('rotates page 1 by 180 degrees', async () => {
    const handle = await openSimple();

    rotatePage(handle, 1, 180);

    expect(getPageDimensions(handle, 1).rotation).toBe(180);
  });

  it('rotates page 1 by 270 degrees', async () => {
    const handle = await openSimple();

    rotatePage(handle, 1, 270);

    expect(getPageDimensions(handle, 1).rotation).toBe(270);
  });

  it('rotating by 360 normalizes to 0', async () => {
    const handle = await openSimple();

    rotatePage(handle, 1, 360);

    expect(getPageDimensions(handle, 1).rotation).toBe(0);
  });

  it('rotating by 0 keeps rotation at 0', async () => {
    const handle = await openSimple();

    rotatePage(handle, 1, 0);

    expect(getPageDimensions(handle, 1).rotation).toBe(0);
  });

  it('throws PDFPageOutOfRangeError for an invalid page number', async () => {
    const handle = await openSimple();

    expect(() => rotatePage(handle, 0, 90)).toThrow(PDFPageOutOfRangeError);
  });

  it('throws for page beyond pageCount', async () => {
    const handle = await openSimple();

    expect(() => rotatePage(handle, 5, 90)).toThrow(PDFPageOutOfRangeError);
  });

  it('marks the document as dirty', async () => {
    const handle = await openSimple();

    rotatePage(handle, 1, 90);

    expect(handle.isDirty).toBe(true);
  });

  it('can rotate different pages independently in a multi-page doc', async () => {
    const handle = await openMulti();

    rotatePage(handle, 1, 90);
    rotatePage(handle, 2, 180);
    rotatePage(handle, 3, 270);

    expect(getPageDimensions(handle, 1).rotation).toBe(90);
    expect(getPageDimensions(handle, 2).rotation).toBe(180);
    expect(getPageDimensions(handle, 3).rotation).toBe(270);
  });
});

// ---------------------------------------------------------------------------
// copyPage
// ---------------------------------------------------------------------------

describe('copyPage', () => {
  it('increases pageCount by 1 when copying within the same document', async () => {
    const handle = await openMulti(); // 5 pages
    const before = handle.pageCount;

    await copyPage(handle, 1);

    expect(handle.pageCount).toBe(before + 1);
  });

  it('copy is appended to the end by default', async () => {
    const handle = await openSimple(); // 1 page

    const pos = await copyPage(handle, 1);

    expect(pos).toBe(2);
    expect(handle.pageCount).toBe(2);
  });

  it('copy has the same dimensions as the source page', async () => {
    const handle = await openSimple();
    const srcDims = getPageDimensions(handle, 1);

    await copyPage(handle, 1);
    const copyDims = getPageDimensions(handle, 2);

    expect(copyDims.width).toBeCloseTo(srcDims.width, 1);
    expect(copyDims.height).toBeCloseTo(srcDims.height, 1);
  });

  it('inserts the copy at a specific position', async () => {
    const handle = await openMulti();

    const pos = await copyPage(handle, 1, undefined, 2);

    expect(pos).toBe(2);
    expect(handle.pageCount).toBe(6);
  });

  it('throws PDFPageOutOfRangeError for an out-of-range source page', async () => {
    const handle = await openSimple();

    await expect(copyPage(handle, 99)).rejects.toThrow(PDFPageOutOfRangeError);
  });

  it('throws for source page 0', async () => {
    const handle = await openSimple();

    await expect(copyPage(handle, 0)).rejects.toThrow(PDFPageOutOfRangeError);
  });

  it('marks the source document as dirty', async () => {
    const handle = await openSimple();

    await copyPage(handle, 1);

    expect(handle.isDirty).toBe(true);
  });

  it('copies a page from one document into another', async () => {
    const source = await openSimple();
    const target = await openMulti(); // 5 pages
    const targetBefore = target.pageCount;

    await copyPage(source, 1, target);

    expect(target.pageCount).toBe(targetBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// resizePage
// ---------------------------------------------------------------------------

describe('resizePage', () => {
  it('changes the page dimensions to the specified values', async () => {
    const handle = await openSimple();

    resizePage(handle, 1, 400, 600);

    const dims = getPageDimensions(handle, 1);
    expect(dims.width).toBeCloseTo(400, 1);
    expect(dims.height).toBeCloseTo(600, 1);
  });

  it('throws PDFPageOutOfRangeError for page 0', async () => {
    const handle = await openSimple();

    expect(() => resizePage(handle, 0, 400, 600)).toThrow(PDFPageOutOfRangeError);
  });

  it('throws for a page number beyond pageCount', async () => {
    const handle = await openSimple();

    expect(() => resizePage(handle, 99, 400, 600)).toThrow(PDFPageOutOfRangeError);
  });

  it('marks the document as dirty', async () => {
    const handle = await openSimple();

    resizePage(handle, 1, 400, 600);

    expect(handle.isDirty).toBe(true);
  });

  it('resizes to A4 dimensions (595×842)', async () => {
    const handle = await openSimple();

    resizePage(handle, 1, 595, 842);

    const dims = getPageDimensions(handle, 1);
    expect(dims.width).toBeCloseTo(595, 1);
    expect(dims.height).toBeCloseTo(842, 1);
  });

  it('accepts scaleContent flag without throwing', async () => {
    const handle = await openSimple();

    expect(() => resizePage(handle, 1, 400, 600, true)).not.toThrow();
  });

  it('can resize different pages independently', async () => {
    const handle = await openMulti();

    resizePage(handle, 1, 300, 400);
    resizePage(handle, 2, 500, 700);

    expect(getPageDimensions(handle, 1).width).toBeCloseTo(300, 1);
    expect(getPageDimensions(handle, 2).width).toBeCloseTo(500, 1);
  });
});
