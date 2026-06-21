/**
 * applyOperations — in-place SHAPE restyle (P3 "vector restyle") via the
 * engine's `setPathStyle`, plus the redact + add fallback for the cases
 * `setPathStyle` cannot express.
 *
 * These prove the vector-restyle path the unified index unlocks:
 *
 *   - a STYLE-ONLY `update` shape op (geometry unchanged) carrying a valid
 *     unified `index` re-styles the path IN PLACE — the re-parsed result shows
 *     the NEW fill colour — and records NO redaction (`redactionTargetsCount`
 *     === 0, `inPlaceRestyled === 1`, `inPlaceTransformed === 0`).
 *   - a combined geometry + style `update` does BOTH in place on the same index
 *     (`inPlaceTransformed === 1` AND `inPlaceRestyled === 1`), still NO redaction.
 *   - an OPACITY-only change FALLS BACK (a redaction target IS recorded,
 *     `inPlaceRestyled === 0`) — `setPathStyle` can't emit `/ca`/`/CA`.
 *   - a shape op whose `index` does NOT resolve to a path (non-path / stale
 *     index) FALLS BACK, proving the safe legacy path is intact.
 */

import { describe, it, expect } from 'vitest';
import { getEngine } from '../../src/wasm';
import { applyOperations } from '../../src/render/apply-operations';
import type { ElementOperation } from '../../src/render/apply-operations';
import { extractDrawingElementsByPage } from '../../src/parse/drawing-extractor';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import type { ShapeElement } from '@giga-pdf/types';

/**
 * SIMPLE_PDF with one RED filled rectangle on page 1; returns the saved bytes.
 * NOTE: the fixture already carries its own vector paths, so the page has MORE
 * than one shape after this — tests target by colour, not by count.
 */
async function pdfWithRedRect(): Promise<Buffer> {
  const giga = await getEngine();
  const doc = giga.open(loadFixture(SIMPLE_PDF));
  try {
    // 120×60 pt filled rect; PDF user space (origin bottom-left). No stroke,
    // opacity 1 (so fillAlpha === 1 for the opacity-change test).
    doc.addRectangle(1, 72, 400, 120, 60, null, 0xff0000, 0, 1);
    return Buffer.from(doc.save());
  } finally {
    doc.close();
  }
}

/** Find a page-1 shape whose fill hex matches `hex` (e.g. "#ff0000"). */
function findByFill(shapes: ShapeElement[], hex: string): ShapeElement | undefined {
  return shapes.find((s) => (s.style.fillColor ?? '').toLowerCase() === hex.toLowerCase());
}

async function page1Shapes(bytes: Uint8Array | Buffer): Promise<ShapeElement[]> {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return (await extractDrawingElementsByPage(b)).get(1) ?? [];
}

// ---------------------------------------------------------------------------
// Style-only restyle (setPathStyle)
// ---------------------------------------------------------------------------

describe('applyOperations — in-place shape restyle (setPathStyle)', () => {
  it('changes the fill colour in place at the SAME index, with NO redaction', async () => {
    const input = await pdfWithRedRect();
    const before = await page1Shapes(input);
    const target = findByFill(before, '#ff0000');
    expect(target).toBeDefined();
    expect(target!.index).toBeTypeOf('number');
    expect(target!.index!).toBeGreaterThanOrEqual(0);

    // Style-only change: same bounds, new fill (green).
    const restyled: ShapeElement = {
      ...target!,
      style: { ...target!.style, fillColor: '#00ff00' },
    };
    const ops: ElementOperation[] = [
      {
        action: 'update',
        pageNumber: 1,
        element: restyled as unknown as Record<string, unknown>,
        oldBounds: { ...target!.bounds },
      },
    ];

    const result = await applyOperations(input, ops);

    // In-place restyle path taken: one setPathStyle, no transform, no redaction.
    expect(result.inPlaceRestyled).toBe(1);
    expect(result.inPlaceTransformed).toBe(0);
    expect(result.redactionTargetsCount).toBe(0);
    expect(result.addsApplied).toBe(0);

    // The re-parsed path now has the NEW (green) fill — and the old red is gone.
    const after = await page1Shapes(result.bytes);
    expect(findByFill(after, '#00ff00')).toBeDefined();
    expect(findByFill(after, '#ff0000')).toBeUndefined();
  });

  it('bakes geometry + style together in place (transform AND setPathStyle)', async () => {
    const input = await pdfWithRedRect();
    const before = await page1Shapes(input);
    const target = findByFill(before, '#ff0000');
    expect(target).toBeDefined();

    const oldBounds = { ...target!.bounds };
    const newBounds = { ...oldBounds, x: oldBounds.x + 40, y: oldBounds.y + 30 };
    const movedRestyled: ShapeElement = {
      ...target!,
      bounds: newBounds,
      style: { ...target!.style, fillColor: '#0000ff' },
    };
    const ops: ElementOperation[] = [
      {
        action: 'update',
        pageNumber: 1,
        element: movedRestyled as unknown as Record<string, unknown>,
        oldBounds,
      },
    ];

    const result = await applyOperations(input, ops);

    expect(result.inPlaceTransformed).toBe(1);
    expect(result.inPlaceRestyled).toBe(1);
    expect(result.redactionTargetsCount).toBe(0);
    expect(result.addsApplied).toBe(0);

    const after = await page1Shapes(result.bytes);
    const blue = findByFill(after, '#0000ff');
    expect(blue).toBeDefined();
    expect(findByFill(after, '#ff0000')).toBeUndefined();
    // Moved to the requested NEW web bounds (within tolerance).
    expect(blue!.bounds.x).toBeCloseTo(newBounds.x, 0);
    expect(blue!.bounds.y).toBeCloseTo(newBounds.y, 0);
  });

  it('falls back (records a redaction target) for an OPACITY-only change', async () => {
    const input = await pdfWithRedRect();
    const before = await page1Shapes(input);
    const target = findByFill(before, '#ff0000');
    expect(target).toBeDefined();

    // Only the fill opacity changes — setPathStyle cannot emit /ca, so this
    // must route to redact + add (which re-adds the shape with the new opacity).
    const dimmed: ShapeElement = {
      ...target!,
      style: { ...target!.style, fillOpacity: 0.5 },
    };
    const ops: ElementOperation[] = [
      {
        action: 'update',
        pageNumber: 1,
        element: dimmed as unknown as Record<string, unknown>,
        oldBounds: { ...target!.bounds },
      },
    ];

    const result = await applyOperations(input, ops);

    expect(result.inPlaceRestyled).toBe(0);
    expect(result.inPlaceTransformed).toBe(0);
    expect(result.redactionTargetsCount).toBe(1);
  });

  it('falls back when the shape index does NOT resolve to a path (non-path / stale)', async () => {
    const input = await pdfWithRedRect();
    const before = await page1Shapes(input);
    const target = findByFill(before, '#ff0000');
    expect(target).toBeDefined();

    // A bogus high index that resolves to no vector path → classification can't
    // find the original path → safe redact + add fallback.
    const bogus: ShapeElement = {
      ...target!,
      index: 999_999,
      style: { ...target!.style, fillColor: '#00ff00' },
    };
    const ops: ElementOperation[] = [
      {
        action: 'update',
        pageNumber: 1,
        element: bogus as unknown as Record<string, unknown>,
        oldBounds: { ...target!.bounds },
      },
    ];

    const result = await applyOperations(input, ops);

    expect(result.inPlaceRestyled).toBe(0);
    expect(result.redactionTargetsCount).toBe(1);
  });
});
