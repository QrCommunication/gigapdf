/**
 * applyOperations — in-place z-order (reorder) via the engine's
 * `reorderElement`. A `reorder` op carries an element's unified `index` and a
 * `toFront` flag and persists the new paint order into the PDF binary (not just
 * the editor scene-graph order).
 *
 * These prove:
 *   - a `reorder` op with `toFront: true` moves the element's op range to the
 *     END of the page content (painted last → on top): the element's unified
 *     index after re-parse becomes the LARGEST among the page's shapes, and the
 *     op records `inPlaceReordered === 1`, NO redaction, NO add.
 *   - a `reorder` op with `toFront: false` moves it to the START (painted first
 *     → behind): the element's index after re-parse becomes the SMALLEST.
 *   - a `reorder` op with NO valid index is dropped silently (no engine target):
 *     `inPlaceReordered === 0`, NO redaction.
 */

import { describe, it, expect } from 'vitest';
import { getEngine } from '../../src/wasm';
import { applyOperations } from '../../src/render/apply-operations';
import type { ElementOperation } from '../../src/render/apply-operations';
import { extractDrawingElementsByPage } from '../../src/parse/drawing-extractor';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import type { ShapeElement } from '@giga-pdf/types';

/**
 * SIMPLE_PDF with a RED then a BLUE filled rectangle on page 1 (added in that
 * order, so RED is painted before BLUE). Returns the saved bytes.
 */
async function pdfWithTwoRects(): Promise<Buffer> {
  const giga = await getEngine();
  const doc = giga.open(loadFixture(SIMPLE_PDF));
  try {
    doc.addRectangle(1, 72, 400, 120, 60, null, 0xff0000, 0, 1);
    doc.addRectangle(1, 100, 380, 120, 60, null, 0x0000ff, 0, 1);
    return Buffer.from(doc.save());
  } finally {
    doc.close();
  }
}

function findByFill(shapes: ShapeElement[], hex: string): ShapeElement | undefined {
  return shapes.find((s) => (s.style.fillColor ?? '').toLowerCase() === hex.toLowerCase());
}

/**
 * Locate a shape by its (rounded) top-left position — stable across a reorder,
 * which moves the op range and re-wraps it in `q … Q`. (The engine's reorder
 * re-wrap does not always carry the inline fill colour of an `addRectangle`
 * shape, so matching on geometry — not colour — is the robust identifier.)
 */
function findByPos(shapes: ShapeElement[], x: number, y: number): ShapeElement | undefined {
  return shapes.find(
    (s) => Math.abs(s.bounds.x - x) <= 1 && Math.abs(s.bounds.y - y) <= 1,
  );
}

async function page1Shapes(bytes: Uint8Array | Buffer): Promise<ShapeElement[]> {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return (await extractDrawingElementsByPage(b)).get(1) ?? [];
}

const maxIndex = (shapes: ShapeElement[]): number =>
  Math.max(...shapes.map((s) => s.index ?? -1));
const minIndex = (shapes: ShapeElement[]): number =>
  Math.min(...shapes.map((s) => s.index ?? Number.POSITIVE_INFINITY));

describe('applyOperations — in-place reorder (reorderElement)', () => {
  it('brings an element to the front (op range moved to the end → largest index)', async () => {
    const input = await pdfWithTwoRects();
    const before = await page1Shapes(input);
    const red = findByFill(before, '#ff0000');
    expect(red).toBeDefined();
    expect(red!.index).toBeTypeOf('number');
    // Not already the front-most, so the move is observable.
    expect(red!.index).not.toBe(maxIndex(before));
    const redX = red!.bounds.x;
    const redY = red!.bounds.y;

    const ops: ElementOperation[] = [
      {
        action: 'reorder',
        pageNumber: 1,
        element: red! as unknown as Record<string, unknown>,
        reorder: { toFront: true },
      },
    ];

    const result = await applyOperations(input, ops);

    expect(result.inPlaceReordered).toBe(1);
    expect(result.redactionTargetsCount).toBe(0);
    expect(result.addsApplied).toBe(0);

    // The same rect (matched by geometry) is now painted last → largest index.
    const after = await page1Shapes(result.bytes);
    const redAfter = findByPos(after, redX, redY);
    expect(redAfter).toBeDefined();
    expect(redAfter!.index).toBe(maxIndex(after));
  });

  it('sends an element to the back (op range moved to the start → smallest index)', async () => {
    const input = await pdfWithTwoRects();
    const before = await page1Shapes(input);
    const blue = findByFill(before, '#0000ff');
    expect(blue).toBeDefined();
    expect(blue!.index).not.toBe(minIndex(before));
    const blueX = blue!.bounds.x;
    const blueY = blue!.bounds.y;

    const ops: ElementOperation[] = [
      {
        action: 'reorder',
        pageNumber: 1,
        element: blue! as unknown as Record<string, unknown>,
        reorder: { toFront: false },
      },
    ];

    const result = await applyOperations(input, ops);

    expect(result.inPlaceReordered).toBe(1);
    expect(result.redactionTargetsCount).toBe(0);

    const after = await page1Shapes(result.bytes);
    const blueAfter = findByPos(after, blueX, blueY);
    expect(blueAfter).toBeDefined();
    expect(blueAfter!.index).toBe(minIndex(after));
  });

  it('drops a reorder with NO valid index silently (no engine target)', async () => {
    const input = await pdfWithTwoRects();
    const before = await page1Shapes(input);
    const red = findByFill(before, '#ff0000');
    expect(red).toBeDefined();

    const noIndex: ShapeElement = { ...red!, index: undefined };
    const ops: ElementOperation[] = [
      {
        action: 'reorder',
        pageNumber: 1,
        element: noIndex as unknown as Record<string, unknown>,
        reorder: { toFront: true },
      },
    ];

    const result = await applyOperations(input, ops);

    expect(result.inPlaceReordered).toBe(0);
    expect(result.redactionTargetsCount).toBe(0);
    expect(result.addsApplied).toBe(0);
  });
});
