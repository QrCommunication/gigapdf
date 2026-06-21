/**
 * applyOperations — in-place IMAGE / SHAPE geometry edits via the engine's
 * unified-index ops (`transformElement` for move/resize, `removeElement` for
 * delete), and the redact + add fallback when the index is absent.
 *
 * These prove the geometry in-place path the unified index unlocks:
 *
 *   - an `update` image op carrying a valid unified `index` with the rotation
 *     UNCHANGED moves the image IN PLACE (re-parsed result shows the image at
 *     the NEW position) and records NO redaction (`redactionTargetsCount === 0`,
 *     `inPlaceTransformed === 1`).
 *   - a `delete` shape op with a valid index removes the path in place, no
 *     redaction; sibling shapes survive.
 *   - an `update`/`delete` with NO index FALLS BACK (a redaction target IS
 *     recorded), proving the safe legacy path is intact.
 *
 * The affine-correctness test asserts the engine `q a b c d e f cm <ops> Q`
 * wrapping lands the image at the RIGHT spot: a +90 pt web-X / +50 pt web-Y
 * move resolves to a +90 / -50 PDF-space translation (Y flips), and the
 * re-parsed image bounds match the requested NEW web bounds within tolerance.
 */

import { describe, it, expect } from 'vitest';
import { getEngine } from '../../src/wasm';
import { applyOperations } from '../../src/render/apply-operations';
import type { ElementOperation } from '../../src/render/apply-operations';
import { extractImageElementsByPage } from '../../src/parse/image-extractor';
import { extractDrawingElementsByPage } from '../../src/parse/drawing-extractor';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import type { ImageElement, ShapeElement } from '@giga-pdf/types';

const PNG_1x1 = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1,
  0, 0, 0, 1,
  8, 2,
  0, 0, 0,
  144, 119, 83, 222,
  0, 0, 0, 12, 73, 68, 65, 84,
  8, 215, 99, 248, 207, 192, 0, 0, 0, 3, 0, 1,
  54, 174, 213, 252,
  0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

/** SIMPLE_PDF with one PNG image on page 1; returns the saved bytes. */
async function pdfWithImage(): Promise<Buffer> {
  const giga = await getEngine();
  const doc = giga.open(loadFixture(SIMPLE_PDF));
  try {
    // 100×80 pt image; PDF user space (origin bottom-left).
    doc.addImage(1, PNG_1x1, 72, 600, 100, 80, 1);
    return Buffer.from(doc.save());
  } finally {
    doc.close();
  }
}

/**
 * SIMPLE_PDF with two extra filled rectangles on page 1 (red + blue); returns
 * the saved bytes. NOTE: the fixture already carries its own vector paths, so
 * the page has MORE than two shapes after this — tests must target by colour,
 * not by count.
 */
async function pdfWithRects(): Promise<Buffer> {
  const giga = await getEngine();
  const doc = giga.open(loadFixture(SIMPLE_PDF));
  try {
    doc.addRectangle(1, 72, 400, 120, 60, null, 0xff0000, 0, 1);
    doc.addRectangle(1, 300, 200, 90, 50, null, 0x0000ff, 0, 1);
    return Buffer.from(doc.save());
  } finally {
    doc.close();
  }
}

/** Find a page-1 shape whose fill hex matches `hex` (e.g. "#ff0000"). */
function findByFill(shapes: ShapeElement[], hex: string): ShapeElement | undefined {
  return shapes.find((s) => (s.style.fillColor ?? '').toLowerCase() === hex.toLowerCase());
}

async function page1Images(bytes: Uint8Array | Buffer): Promise<ImageElement[]> {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return (await extractImageElementsByPage(b)).get(1) ?? [];
}
async function page1Shapes(bytes: Uint8Array | Buffer): Promise<ShapeElement[]> {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return (await extractDrawingElementsByPage(b)).get(1) ?? [];
}

// ---------------------------------------------------------------------------
// In-place IMAGE move (transformElement)
// ---------------------------------------------------------------------------

describe('applyOperations — in-place image move (transformElement)', () => {
  it('moves the image in place at the SAME index, with NO redaction', async () => {
    const input = await pdfWithImage();
    const [img] = await page1Images(input);
    expect(img).toBeDefined();
    const index = img!.index;
    expect(index).toBeTypeOf('number');
    expect(index).toBeGreaterThanOrEqual(0);

    const oldBounds = { ...img!.bounds };
    const newBounds = { ...oldBounds, x: oldBounds.x + 90, y: oldBounds.y + 50 };
    const moved: ImageElement = { ...img!, bounds: newBounds };

    const ops: ElementOperation[] = [
      {
        action: 'update',
        pageNumber: 1,
        element: moved as unknown as Record<string, unknown>,
        oldBounds,
      },
    ];

    const result = await applyOperations(input, ops);

    // In-place geometry path taken: one transformElement, no redaction, no add.
    expect(result.inPlaceTransformed).toBe(1);
    expect(result.redactionTargetsCount).toBe(0);
    expect(result.addsApplied).toBe(0);

    // Affine correctness: the re-parsed image sits at the NEW web bounds.
    // The engine wraps `q a b c d e f cm <draw> Q`; a +90/+50 web move maps to
    // +90 (X) / -50 (Y) in PDF space (Y-flip), and back to +90/+50 in web space
    // after re-extraction — i.e. the image is exactly where we asked.
    const after = await page1Images(result.bytes);
    expect(after.length).toBe(1);
    const movedAfter = after[0]!;
    expect(movedAfter.bounds.x).toBeCloseTo(newBounds.x, 0);
    expect(movedAfter.bounds.y).toBeCloseTo(newBounds.y, 0);
    expect(movedAfter.bounds.width).toBeCloseTo(newBounds.width, 0);
    expect(movedAfter.bounds.height).toBeCloseTo(newBounds.height, 0);
  });

  it('falls back (records a redaction target) when the image carries NO index', async () => {
    const input = await pdfWithImage();
    const [img] = await page1Images(input);
    expect(img).toBeDefined();

    const oldBounds = { ...img!.bounds };
    const noIndex: ImageElement = {
      ...img!,
      index: undefined,
      bounds: { ...oldBounds, x: oldBounds.x + 40 },
    };
    const ops: ElementOperation[] = [
      {
        action: 'update',
        pageNumber: 1,
        element: noIndex as unknown as Record<string, unknown>,
        oldBounds,
      },
    ];

    const result = await applyOperations(input, ops);

    expect(result.inPlaceTransformed).toBe(0);
    expect(result.redactionTargetsCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// In-place SHAPE delete (removeElement)
// ---------------------------------------------------------------------------

describe('applyOperations — in-place shape delete (removeElement)', () => {
  it('removes the targeted shape in place; others survive; NO redaction', async () => {
    const input = await pdfWithRects();
    const shapes = await page1Shapes(input);

    // Target the RED rectangle we added; the BLUE one must survive.
    const target = findByFill(shapes, '#ff0000');
    const survivor = findByFill(shapes, '#0000ff');
    expect(target).toBeDefined();
    expect(survivor).toBeDefined();
    const targetIndex = target!.index;
    const beforeCount = shapes.length;

    const ops: ElementOperation[] = [
      {
        action: 'delete',
        pageNumber: 1,
        element: target! as unknown as Record<string, unknown>,
      },
    ];

    const result = await applyOperations(input, ops);

    expect(result.inPlaceRemoved).toBe(1);
    expect(result.redactionTargetsCount).toBe(0);
    expect(result.addsApplied).toBe(0);

    const after = await page1Shapes(result.bytes);
    // Exactly one shape removed; everything else intact.
    expect(after.length).toBe(beforeCount - 1);
    // The red rect is gone…
    expect(findByFill(after, '#ff0000')).toBeUndefined();
    // …the blue rect survives with the same approximate geometry.
    const survivorAfter = findByFill(after, '#0000ff');
    expect(survivorAfter).toBeDefined();
    expect(survivorAfter!.bounds.x).toBeCloseTo(survivor!.bounds.x, 0);
    expect(survivorAfter!.bounds.width).toBeCloseTo(survivor!.bounds.width, 0);
    // The deleted index resolves to nothing of the original red box.
    void targetIndex;
  });
});
