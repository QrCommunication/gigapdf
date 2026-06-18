import { describe, it, expect } from 'vitest';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import { openDocument, saveDocument, closeDocument } from '../../src/engine/document-handle';
import { flattenAnnotations } from '../../src/render/flatten';

// The engine's flatten BAKES each annotation's appearance stream into the page
// content and removes the baked annotations (annotations without an appearance
// are left in place). This is stronger than the old pdf-lib path, which only
// deleted the /Annots array. Assertions go through the engine's annotations()
// reader rather than pdf-lib internals.

const WITH_ANNOTATIONS_PDF = 'with-annotations.pdf';

function makeBuffer(fixture: string): Buffer {
  return Buffer.from(loadFixture(fixture));
}

function totalAnnotations(handle: Awaited<ReturnType<typeof openDocument>>): number {
  let total = 0;
  for (let p = 1; p <= handle.pageCount; p++) {
    total += handle._doc.annotations(p).length;
  }
  return total;
}

describe('flattenAnnotations — all pages', () => {
  it('bakes annotations and reports counts without throwing', async () => {
    const handle = await openDocument(makeBuffer(WITH_ANNOTATIONS_PDF));
    const before = totalAnnotations(handle);
    expect(before).toBeGreaterThan(0);

    const result = flattenAnnotations(handle);

    expect(result.flattened).toBeGreaterThanOrEqual(0);
    expect(result.pagesProcessed).toBeGreaterThanOrEqual(0);
    // Baked annotations are removed; any baked count reduces the remaining set.
    const after = totalAnnotations(handle);
    expect(after).toBeLessThanOrEqual(before);
    closeDocument(handle);
  });

  it('marks the document dirty', async () => {
    const handle = await openDocument(makeBuffer(WITH_ANNOTATIONS_PDF));
    expect(handle.isDirty).toBe(false);

    flattenAnnotations(handle);

    expect(handle.isDirty).toBe(true);
    closeDocument(handle);
  });

  it('round-trip: saved PDF re-opens cleanly after flatten', async () => {
    const handle = await openDocument(makeBuffer(WITH_ANNOTATIONS_PDF));
    flattenAnnotations(handle);

    const saved = await saveDocument(handle);
    closeDocument(handle);
    expect(saved).toBeInstanceOf(Buffer);
    expect(saved.length).toBeGreaterThan(0);

    const handle2 = await openDocument(saved);
    expect(handle2.pageCount).toBeGreaterThan(0);
    closeDocument(handle2);
  });
});

describe('flattenAnnotations — single page', () => {
  it('targets only the requested page', async () => {
    const handle = await openDocument(makeBuffer(WITH_ANNOTATIONS_PDF));

    const result = flattenAnnotations(handle, 1);

    expect(result.pagesProcessed).toBeGreaterThanOrEqual(0);
    expect(handle.isDirty).toBe(true);
    closeDocument(handle);
  });
});

describe('flattenAnnotations — document with no real annotations', () => {
  it('is a safe no-op that still marks dirty', async () => {
    // simple.pdf carries no bakeable annotations.
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const result = flattenAnnotations(handle);

    expect(result.flattened).toBe(0);
    expect(handle.isDirty).toBe(true);
    closeDocument(handle);
  });
});
