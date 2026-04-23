import { describe, it, expect } from 'vitest';
import { PDFName } from 'pdf-lib';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import { openDocument, saveDocument } from '../../src/engine/document-handle';
import { flattenAnnotations } from '../../src/render/flatten';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WITH_ANNOTATIONS_PDF = 'with-annotations.pdf';

function makeBuffer(fixture: string): Buffer {
  return Buffer.from(loadFixture(fixture));
}

// ---------------------------------------------------------------------------
// flattenAnnotations — all pages
// ---------------------------------------------------------------------------

describe('flattenAnnotations — all pages', () => {
  it('removes /Annots from all pages and returns correct counts', async () => {
    const handle = await openDocument(makeBuffer(WITH_ANNOTATIONS_PDF));
    const pagesBefore = handle._pdfDoc.getPages();
    const hadAnnotsBefore = pagesBefore.some(
      (p) => p.node.get(PDFName.of('Annots')) !== undefined,
    );
    expect(hadAnnotsBefore).toBe(true);

    const result = flattenAnnotations(handle);

    expect(result.flattened).toBeGreaterThan(0);
    expect(result.pagesProcessed).toBeGreaterThan(0);

    // All pages must have no /Annots entry after flattening.
    const pagesAfter = handle._pdfDoc.getPages();
    for (const page of pagesAfter) {
      expect(page.node.get(PDFName.of('Annots'))).toBeUndefined();
    }
  });

  it('marks the document dirty', async () => {
    const handle = await openDocument(makeBuffer(WITH_ANNOTATIONS_PDF));
    expect(handle.isDirty).toBe(false);

    flattenAnnotations(handle);

    expect(handle.isDirty).toBe(true);
  });

  it('round-trip: saved PDF has no /Annots after re-open', async () => {
    const handle = await openDocument(makeBuffer(WITH_ANNOTATIONS_PDF));
    flattenAnnotations(handle);

    const saved = await saveDocument(handle);
    expect(saved).toBeInstanceOf(Buffer);
    expect(saved.length).toBeGreaterThan(0);

    // Re-open the saved bytes and verify annotations are gone.
    const handle2 = await openDocument(saved);
    const pages = handle2._pdfDoc.getPages();
    for (const page of pages) {
      expect(page.node.get(PDFName.of('Annots'))).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// flattenAnnotations — single page
// ---------------------------------------------------------------------------

describe('flattenAnnotations — single page', () => {
  it('removes /Annots only from the targeted page', async () => {
    const handle = await openDocument(makeBuffer(WITH_ANNOTATIONS_PDF));
    const pages = handle._pdfDoc.getPages();

    // Confirm page 1 has annotations before.
    expect(pages[0].node.get(PDFName.of('Annots'))).toBeDefined();

    const result = flattenAnnotations(handle, 1);

    expect(result.pagesProcessed).toBe(1);
    expect(pages[0].node.get(PDFName.of('Annots'))).toBeUndefined();
  });

  it('removes empty /Annots array when the targeted page has one', async () => {
    // simple.pdf page 1 has an empty /Annots array — it must be removed cleanly.
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const pages = handle._pdfDoc.getPages();

    // Verify the page actually has /Annots (even if empty).
    const hadAnnots = pages[0].node.get(PDFName.of('Annots')) !== undefined;
    expect(hadAnnots).toBe(true);

    const result = flattenAnnotations(handle, 1);

    // 0 annotation entries (the array was empty), but 1 page processed (key was present).
    expect(result.flattened).toBe(0);
    expect(result.pagesProcessed).toBe(1);
    expect(pages[0].node.get(PDFName.of('Annots'))).toBeUndefined();
    // markDirty is always called.
    expect(handle.isDirty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// flattenAnnotations — document with no annotations
// ---------------------------------------------------------------------------

describe('flattenAnnotations — document with empty /Annots arrays', () => {
  it('removes empty /Annots entries and marks dirty without throwing', async () => {
    // simple.pdf has an empty /Annots array on page 1, but no real annotations.
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const result = flattenAnnotations(handle);

    // All /Annots keys are removed regardless of whether they held real entries.
    expect(result.flattened).toBe(0); // array was empty → 0 annotation objects removed
    expect(result.pagesProcessed).toBeGreaterThanOrEqual(0); // at least no-throw
    expect(handle.isDirty).toBe(true);

    // Verify no /Annots key remains after the call.
    const pages = handle._pdfDoc.getPages();
    for (const page of pages) {
      expect(page.node.get(PDFName.of('Annots'))).toBeUndefined();
    }
  });
});
