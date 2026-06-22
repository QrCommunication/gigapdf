import { describe, it, expect } from 'vitest';
import type { GigaBlock } from '@qrcommunication/gigapdf-lib';
import { gigaBlocksToPageBlockGroups } from '../../src/parse/block-extractor';

// `gigaBlocksToPageBlockGroups` is a PURE mapper over the native engine's
// `pageBlocks` output — no WASM needed, so we drive it with synthetic blocks.

/** A paragraph/heading block carrying `runs` with the given source indices. */
function textBlock(
  kind: 'paragraph' | 'heading' | 'list' | 'table',
  sourceIndices: Array<number | null>,
): GigaBlock {
  return {
    id: 1,
    frame: { x: 0, y: 0, w: 100, h: 20 },
    rotation: { t: 'd0' },
    kind: {
      t: kind,
      v: {
        runs: sourceIndices.map((source_index) => ({
          t: 'run',
          text: source_index === null ? 'synthetic' : `run ${source_index}`,
          style: {
            family: 'Helvetica',
            generic: 'sans',
            size_pt: 12,
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            color: null,
            valign: 'baseline',
          },
          source_index,
        })),
      },
    },
  } as unknown as GigaBlock;
}

describe('gigaBlocksToPageBlockGroups', () => {
  it('maps a paragraph block to its ordered source indices', () => {
    const groups = gigaBlocksToPageBlockGroups([textBlock('paragraph', [3, 4, 5])]);
    expect(groups).toEqual([{ kind: 'paragraph', sourceIndices: [3, 4, 5] }]);
  });

  it('maps a heading block too', () => {
    const groups = gigaBlocksToPageBlockGroups([textBlock('heading', [1, 2])]);
    expect(groups).toEqual([{ kind: 'heading', sourceIndices: [1, 2] }]);
  });

  it('drops null source indices (synthesised, non-editable runs)', () => {
    const groups = gigaBlocksToPageBlockGroups([textBlock('paragraph', [7, null, 8])]);
    expect(groups).toEqual([{ kind: 'paragraph', sourceIndices: [7, 8] }]);
  });

  it('skips a block left with a single editable run (not worth a Textbox)', () => {
    const groups = gigaBlocksToPageBlockGroups([textBlock('paragraph', [9, null])]);
    expect(groups).toHaveLength(0);
  });

  it('ignores non-paragraph/heading kinds (tables/lists keep element render)', () => {
    const groups = gigaBlocksToPageBlockGroups([
      textBlock('table', [1, 2, 3]),
      textBlock('list', [4, 5]),
    ]);
    expect(groups).toHaveLength(0);
  });

  it('handles a malformed block body without throwing', () => {
    const broken = {
      id: 2,
      frame: null,
      rotation: { t: 'd0' },
      kind: { t: 'paragraph', v: { runs: 'not-an-array' } },
    } as unknown as GigaBlock;
    expect(gigaBlocksToPageBlockGroups([broken])).toHaveLength(0);
  });

  it('preserves multiple blocks in order', () => {
    const groups = gigaBlocksToPageBlockGroups([
      textBlock('heading', [1, 2]),
      textBlock('table', [3]),
      textBlock('paragraph', [4, 5, 6]),
    ]);
    expect(groups).toEqual([
      { kind: 'heading', sourceIndices: [1, 2] },
      { kind: 'paragraph', sourceIndices: [4, 5, 6] },
    ]);
  });
});
