/**
 * applyOperations — true in-place text editing (replaceText / moveElement /
 * removeElement) vs. the redact + add fallback.
 *
 * These tests prove the in-place path the engine foundation introduces:
 *
 *   - an `update` text op carrying a valid run `index` with an UNCHANGED style
 *     edits the run IN PLACE (re-parsed result has the new text at the SAME run
 *     index) and records NO redaction (`redactionTargetsCount === 0`).
 *   - a `delete` text op with a valid index removes the run in place, no
 *     redaction.
 *   - an `update` with a STYLE change (different colour/size) — or with no
 *     index — FALLS BACK (a redaction target IS recorded), proving the safe
 *     legacy path is intact for everything the in-place ops can't express.
 *   - a batch with two deletes on one page (indices 1 and 3) removes both
 *     correctly, exercising the descending-index ordering that keeps a remove
 *     from invalidating a not-yet-processed lower index.
 *
 * Fixtures are built natively via the engine's `txtToPdf` (one run per line,
 * each addressable by `TextElementInfo.index`). Editor `TextElement`s are
 * obtained from the real `extractTextElementsByPage` extractor so their style
 * matches the underlying run exactly — the same end-to-end shape production
 * uses (parse → edit → apply).
 */

import { describe, it, expect } from 'vitest';
import { getEngine } from '../../src/wasm';
import { applyOperations } from '../../src/render/apply-operations';
import type { ElementOperation } from '../../src/render/apply-operations';
import { extractTextElementsByPage } from '../../src/parse/text-extractor';
import type { TextElement } from '@giga-pdf/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A single-page PDF whose lines become one engine text run each. */
async function makeMultiLinePdf(lines: string[]): Promise<Buffer> {
  const giga = await getEngine();
  const bytes = giga.txtToPdf(lines.join('\n'));
  return Buffer.from(bytes);
}

/** Re-parse PDF bytes into page-1 text elements (carrying run `index`). */
async function page1Texts(bytes: Uint8Array | Buffer): Promise<TextElement[]> {
  const byPage = await extractTextElementsByPage(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  );
  return byPage.get(1) ?? [];
}

/** Find a page-1 text element whose content matches `text` exactly. */
async function findText(bytes: Uint8Array | Buffer, text: string): Promise<TextElement> {
  const el = (await page1Texts(bytes)).find((e) => e.content === text);
  if (!el) throw new Error(`fixture text "${text}" not found on page 1`);
  return el;
}

// ---------------------------------------------------------------------------
// In-place UPDATE (text-content only, unchanged style)
// ---------------------------------------------------------------------------

describe('applyOperations — in-place text update (replaceText)', () => {
  it('replaces the run text in place at the SAME index, with NO redaction', async () => {
    const input = await makeMultiLinePdf(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    const bravo = await findText(input, 'Bravo');
    const originalIndex = bravo.index;
    expect(originalIndex).toBeTypeOf('number');
    expect(originalIndex).toBeGreaterThanOrEqual(0);

    // Edit content only — keep bounds + style identical (no move, no restyle).
    const edited: TextElement = { ...bravo, content: 'ZULU88' };
    const ops: ElementOperation[] = [
      {
        action: 'update',
        pageNumber: 1,
        element: edited as unknown as Record<string, unknown>,
        oldBounds: bravo.bounds,
      },
    ];

    const result = await applyOperations(input, ops);

    // In-place path taken: one replaceText, no redaction target, no add.
    expect(result.inPlaceReplaced).toBe(1);
    expect(result.inPlaceMoved).toBe(0);
    expect(result.redactionTargetsCount).toBe(0);
    expect(result.addsApplied).toBe(0);

    // The run at the SAME index now carries the new text; the others are intact.
    const after = await page1Texts(result.bytes);
    const sameRun = after.find((e) => e.index === originalIndex);
    expect(sameRun?.content).toBe('ZULU88');
    expect(after.find((e) => e.content === 'Alpha')).toBeDefined();
    expect(after.find((e) => e.content === 'Charlie')).toBeDefined();
    // The old text is gone (no leftover duplicate from an overlay).
    expect(after.find((e) => e.content === 'Bravo')).toBeUndefined();
  });

  it('also moves the run in place when the bounds shifted beyond tolerance', async () => {
    const input = await makeMultiLinePdf(['Alpha', 'Bravo', 'Charlie']);
    const alpha = await findText(input, 'Alpha');

    // New text + a real positional shift (web space): right 12, down 10.
    const moved: TextElement = {
      ...alpha,
      content: 'MOVED',
      bounds: { ...alpha.bounds, x: alpha.bounds.x + 12, y: alpha.bounds.y + 10 },
    };
    const ops: ElementOperation[] = [
      {
        action: 'update',
        pageNumber: 1,
        element: moved as unknown as Record<string, unknown>,
        oldBounds: alpha.bounds,
      },
    ];

    const result = await applyOperations(input, ops);

    expect(result.inPlaceReplaced).toBe(1);
    expect(result.inPlaceMoved).toBe(1);
    expect(result.redactionTargetsCount).toBe(0);

    const after = await page1Texts(result.bytes);
    expect(after.find((e) => e.content === 'MOVED')).toBeDefined();
    expect(after.find((e) => e.content === 'Alpha')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// In-place DELETE (removeElement)
// ---------------------------------------------------------------------------

describe('applyOperations — in-place text delete (removeElement)', () => {
  it('removes the run in place with NO redaction', async () => {
    const input = await makeMultiLinePdf(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    const charlie = await findText(input, 'Charlie');

    const ops: ElementOperation[] = [
      {
        action: 'delete',
        pageNumber: 1,
        element: charlie as unknown as Record<string, unknown>,
      },
    ];

    const result = await applyOperations(input, ops);

    expect(result.inPlaceRemoved).toBe(1);
    expect(result.redactionTargetsCount).toBe(0);
    expect(result.addsApplied).toBe(0);

    const after = await page1Texts(result.bytes);
    expect(after.find((e) => e.content === 'Charlie')).toBeUndefined();
    // Siblings survive.
    expect(after.find((e) => e.content === 'Alpha')).toBeDefined();
    expect(after.find((e) => e.content === 'Delta')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Fallback intact — style change, and missing index
// ---------------------------------------------------------------------------

describe('applyOperations — redact + add fallback (intact)', () => {
  it('falls back (records a redaction target) when the COLOUR changes', async () => {
    const input = await makeMultiLinePdf(['Alpha', 'Bravo', 'Charlie']);
    const bravo = await findText(input, 'Bravo');

    // Same text, but a colour `replaceText` cannot express → must fall back.
    const restyled: TextElement = {
      ...bravo,
      style: { ...bravo.style, color: '#ff0000' },
    };
    const ops: ElementOperation[] = [
      {
        action: 'update',
        pageNumber: 1,
        element: restyled as unknown as Record<string, unknown>,
        oldBounds: bravo.bounds,
      },
    ];

    const result = await applyOperations(input, ops);

    // Fallback path: NO in-place edit, a redaction target IS recorded, and the
    // new styled run is re-added.
    expect(result.inPlaceReplaced).toBe(0);
    expect(result.inPlaceMoved).toBe(0);
    expect(result.redactionTargetsCount).toBe(1);
    expect(result.addsApplied).toBe(1);
  });

  it('falls back when the element carries NO valid run index', async () => {
    const input = await makeMultiLinePdf(['Alpha', 'Bravo', 'Charlie']);
    const bravo = await findText(input, 'Bravo');

    // Strip the index (simulates a coalesced block / pre-plumbing element).
    const noIndex: TextElement = { ...bravo, content: 'NOIDX', index: undefined };
    const ops: ElementOperation[] = [
      {
        action: 'update',
        pageNumber: 1,
        element: noIndex as unknown as Record<string, unknown>,
        oldBounds: bravo.bounds,
      },
    ];

    const result = await applyOperations(input, ops);

    expect(result.inPlaceReplaced).toBe(0);
    expect(result.redactionTargetsCount).toBe(1);
    expect(result.addsApplied).toBe(1);
  });

  it('falls back for a delete whose index is a negative (FORM-XObject) sentinel', async () => {
    const input = await makeMultiLinePdf(['Alpha', 'Bravo', 'Charlie']);
    const bravo = await findText(input, 'Bravo');

    const sentinel: TextElement = { ...bravo, index: -1 };
    const ops: ElementOperation[] = [
      {
        action: 'delete',
        pageNumber: 1,
        element: sentinel as unknown as Record<string, unknown>,
        oldBounds: bravo.bounds,
      },
    ];

    const result = await applyOperations(input, ops);

    expect(result.inPlaceRemoved).toBe(0);
    expect(result.redactionTargetsCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Batch index-shift — two deletes on one page (descending-order handling)
// ---------------------------------------------------------------------------

describe('applyOperations — batch in-place deletes (index-shift safe)', () => {
  it('removes two runs on the same page (indices 1 and 3) correctly', async () => {
    const input = await makeMultiLinePdf(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    const texts = await page1Texts(input);

    // Pick the runs at index 1 and 3 (whatever text they hold).
    const idx1 = texts.find((e) => e.index === 1);
    const idx3 = texts.find((e) => e.index === 3);
    expect(idx1).toBeDefined();
    expect(idx3).toBeDefined();
    const text1 = idx1!.content;
    const text3 = idx3!.content;

    const ops: ElementOperation[] = [
      // Deliberately ascending in the batch — the pipeline must reorder to
      // descending internally so removing index 1 can't shift index 3 first.
      { action: 'delete', pageNumber: 1, element: idx1! as unknown as Record<string, unknown> },
      { action: 'delete', pageNumber: 1, element: idx3! as unknown as Record<string, unknown> },
    ];

    const result = await applyOperations(input, ops);

    expect(result.inPlaceRemoved).toBe(2);
    expect(result.redactionTargetsCount).toBe(0);

    const after = await page1Texts(result.bytes);
    // Exactly the two targeted runs are gone; three survive.
    expect(after.length).toBe(3);
    expect(after.find((e) => e.content === text1)).toBeUndefined();
    expect(after.find((e) => e.content === text3)).toBeUndefined();
  });
});
