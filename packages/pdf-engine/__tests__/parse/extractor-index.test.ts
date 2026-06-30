/**
 * Extractor unified-index + deterministic-id contract.
 *
 * Both the image and drawing extractors must:
 *   1. populate `element.index` with the engine's UNIFIED element index — the
 *      exact value `imageElements()[k].index` / `vectorPaths()[k].index` report,
 *      NOT a local 0,1,2 counter. This is the value `removeElement` /
 *      `transformElement` accept, so it is what enables lossless in-place edits.
 *   2. derive a DETERMINISTIC `elementId` seeded by `(page, type, index)` — two
 *      parses of the SAME bytes must produce identical ids (cross-session layer
 *      persistence keying + diff/incremental updates depend on this).
 *
 * Fixtures are built natively: a page-1 raster image via the engine's `addImage`
 * and a page-1 rectangle via `addRectangle`, so the engine assigns each a real
 * unified index we can compare the extractor output against.
 */

import { describe, it, expect } from 'vitest';
import { getEngine } from '../../src/wasm';
import { extractImageElementsByPage } from '../../src/parse/image-extractor';
import { extractDrawingElementsByPage } from '../../src/parse/drawing-extractor';
import { loadFixture, SIMPLE_PDF } from '../helpers';

/** Minimal 1×1 RGB PNG (magic 0x89 'PNG' …), enough for the engine to embed. */
const PNG_1x1 = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1,
  0, 0, 0, 1,
  8, 2,
  0, 0, 0,
  144, 119, 83, 222,
  0, 0, 0, 12, 73, 68, 65, 84,
  8, 215, 99, 248, 207, 192, 0, 0, 3, 1, 1, 0,
  24, 221, 141, 176,
  0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

/** A red packed-RGB value (0xRRGGBB) for the rectangle fill. */
const RED = 0xff0000;

/** SIMPLE_PDF with one PNG image placed on page 1; returns the saved bytes. */
async function pdfWithImage(): Promise<Uint8Array> {
  const giga = await getEngine();
  const doc = giga.open(loadFixture(SIMPLE_PDF));
  try {
    // 100×80 pt image near the top-left in PDF user space.
    doc.addImage(1, PNG_1x1, 72, 600, 100, 80, 1);
    return doc.save();
  } finally {
    doc.close();
  }
}

/** SIMPLE_PDF with one filled rectangle on page 1; returns the saved bytes. */
async function pdfWithRect(): Promise<Uint8Array> {
  const giga = await getEngine();
  const doc = giga.open(loadFixture(SIMPLE_PDF));
  try {
    // A 120×60 pt filled rectangle.
    doc.addRectangle(1, 72, 400, 120, 60, null, RED, 0, 1);
    return doc.save();
  } finally {
    doc.close();
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('image-extractor — unified index + deterministic id', () => {
  it('ImageElement.index equals the engine imageElements().index', async () => {
    const bytes = await pdfWithImage();
    const giga = await getEngine();

    // Engine ground truth: the unified index of the embedded image on page 1.
    const doc = giga.open(bytes);
    let engineIndex: number;
    try {
      const infos = doc.imageElements(1);
      expect(infos.length).toBeGreaterThanOrEqual(1);
      engineIndex = infos[0]!.index;
    } finally {
      doc.close();
    }

    const byPage = await extractImageElementsByPage(bytes);
    const images = byPage.get(1) ?? [];
    expect(images.length).toBeGreaterThanOrEqual(1);

    // The extractor must carry the UNIFIED index verbatim (not a local counter).
    expect(images[0]!.index).toBe(engineIndex);
    expect(images.map((i) => i.index)).toContain(engineIndex);
  });

  it('produces a stable, UUID-shaped elementId across two parses', async () => {
    const bytes = await pdfWithImage();
    const a = (await extractImageElementsByPage(bytes)).get(1) ?? [];
    const b = (await extractImageElementsByPage(bytes)).get(1) ?? [];

    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.elementId).toMatch(UUID);
      // Deterministic: same bytes → same id for the same element.
      expect(a[i]!.elementId).toBe(b[i]!.elementId);
    }
  });
});

describe('drawing-extractor — unified index + deterministic id', () => {
  it('ShapeElement.index equals the engine vectorPaths().index', async () => {
    const bytes = await pdfWithRect();
    const giga = await getEngine();

    const doc = giga.open(bytes);
    let engineIndices: number[];
    try {
      engineIndices = doc.vectorPaths(1).map((p) => p.index);
      expect(engineIndices.length).toBeGreaterThanOrEqual(1);
    } finally {
      doc.close();
    }

    const shapes = (await extractDrawingElementsByPage(bytes)).get(1) ?? [];
    expect(shapes.length).toBeGreaterThanOrEqual(1);

    // Every extracted shape's index must be a real engine vector-path index.
    for (const shape of shapes) {
      expect(typeof shape.index).toBe('number');
      expect(engineIndices).toContain(shape.index);
    }
  });

  it('produces a stable, UUID-shaped elementId across two parses', async () => {
    const bytes = await pdfWithRect();
    const a = (await extractDrawingElementsByPage(bytes)).get(1) ?? [];
    const b = (await extractDrawingElementsByPage(bytes)).get(1) ?? [];

    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.elementId).toMatch(UUID);
      expect(a[i]!.elementId).toBe(b[i]!.elementId);
    }
  });
});
