import { describe, it, expect } from 'vitest';
import type { GigaBlock } from '@qrcommunication/gigapdf-lib';
import { gigaBlocksToPageBlockGroups } from '../../src/parse/block-extractor';

// `gigaBlocksToPageBlockGroups` is a PURE mapper over the native engine's
// `pageBlocks` output — no WASM needed, so we drive it with synthetic blocks.

/** A run inline carrying the given `source_index` (flat typed shape). */
function run(source_index: number | null) {
  return {
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
  };
}

/** A nested paragraph `GigaBlock` (table cell / list item body), with runs. */
function paragraphInner(sourceIndices: Array<number | null>): unknown {
  return {
    id: 99,
    frame: null,
    rotation: { t: 'd0' },
    kind: { t: 'paragraph', v: { runs: sourceIndices.map(run) } },
  };
}

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
      v: { runs: sourceIndices.map(run) },
    },
  } as unknown as GigaBlock;
}

/**
 * A `table` block with `rows × cols` of cells; `grid[r][c]` is the array of
 * source indices of that cell's runs. Mirrors the engine runtime body
 * `{ rows: [{ cells: [{ blocks, col_span, row_span }], height }], col_widths }`.
 */
function tableBlock(grid: Array<Array<Array<number | null>>>): GigaBlock {
  const colCount = grid[0]?.length ?? 0;
  return {
    id: 64,
    frame: { x: 0, y: 0, w: 500, h: 200 },
    rotation: { t: 'd0' },
    kind: {
      t: 'table',
      v: {
        col_widths: Array.from({ length: colCount }, () => 100),
        border: { width: 0, color: [0, 0, 0] },
        rows: grid.map((row) => ({
          height: 20,
          cells: row.map((cellIndices) => ({
            blocks: [paragraphInner(cellIndices)],
            col_span: 1,
            row_span: 1,
            shading: null,
          })),
        })),
      },
    },
  } as unknown as GigaBlock;
}

/**
 * A `list` block whose items carry the given source indices. Mirrors the engine
 * runtime body `{ ordered, marker:{t,v}, items: [{ blocks, level }] }`.
 */
function listBlock(
  items: Array<Array<number | null>>,
  opts: { ordered?: boolean; marker?: string } = {},
): GigaBlock {
  return {
    id: 39,
    frame: { x: 0, y: 0, w: 300, h: 100 },
    rotation: { t: 'd0' },
    kind: {
      t: 'list',
      v: {
        ordered: opts.ordered ?? false,
        marker: { t: 'bullet', v: opts.marker ?? '-' },
        items: items.map((idxs) => ({
          blocks: [paragraphInner(idxs)],
          level: 0,
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

  it('ignores image/shape/textbox kinds (kept element-rendered)', () => {
    const groups = gigaBlocksToPageBlockGroups([
      { id: 1, frame: null, rotation: { t: 'd0' }, kind: { t: 'image' } } as unknown as GigaBlock,
      { id: 2, frame: null, rotation: { t: 'd0' }, kind: { t: 'shape' } } as unknown as GigaBlock,
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
      // table with a `{runs}` body (no `rows`) is not a valid table → dropped.
      textBlock('table', [3]),
      textBlock('paragraph', [4, 5, 6]),
    ]);
    expect(groups).toEqual([
      { kind: 'heading', sourceIndices: [1, 2] },
      { kind: 'paragraph', sourceIndices: [4, 5, 6] },
    ]);
  });

  describe('table blocks', () => {
    it('reconstructs the grid with per-cell source indices', () => {
      const groups = gigaBlocksToPageBlockGroups([
        tableBlock([
          [[1, 2], [3]],
          [[4], [5, 6]],
        ]),
      ]);
      expect(groups).toHaveLength(1);
      const g = groups[0]!;
      expect(g.kind).toBe('table');
      expect(g.sourceIndices).toEqual([]);
      expect(g.list).toBeUndefined();
      const table = g.table!;
      expect(table.rowCount).toBe(2);
      expect(table.colCount).toBe(2);
      expect(table.colWidths).toEqual([100, 100]);
      expect(table.rowHeights).toEqual([20, 20]);
      expect(table.cells).toEqual([
        { row: 0, col: 0, colSpan: 1, rowSpan: 1, sourceIndices: [1, 2] },
        { row: 0, col: 1, colSpan: 1, rowSpan: 1, sourceIndices: [3] },
        { row: 1, col: 0, colSpan: 1, rowSpan: 1, sourceIndices: [4] },
        { row: 1, col: 1, colSpan: 1, rowSpan: 1, sourceIndices: [5, 6] },
      ]);
    });

    it('drops null source indices inside a cell', () => {
      const groups = gigaBlocksToPageBlockGroups([
        tableBlock([[[7, null, 8]]]),
      ]);
      expect(groups[0]!.table!.cells[0]!.sourceIndices).toEqual([7, 8]);
    });

    it('is dropped entirely when NO cell resolves an editable run (null path)', () => {
      // Mirrors real PDFs: every cell run carries `source_index: null`. The whole
      // table stays element-rendered → no group emitted (zero regression).
      const groups = gigaBlocksToPageBlockGroups([
        tableBlock([
          [[null], [null]],
          [[null], [null]],
        ]),
      ]);
      expect(groups).toHaveLength(0);
    });

    it('is emitted when at least one cell resolves a run', () => {
      const groups = gigaBlocksToPageBlockGroups([
        tableBlock([
          [[null], [42]],
          [[null], [null]],
        ]),
      ]);
      expect(groups).toHaveLength(1);
      expect(groups[0]!.kind).toBe('table');
    });
  });

  describe('list blocks', () => {
    it('reconstructs ordered items with marker + source indices', () => {
      const groups = gigaBlocksToPageBlockGroups([
        listBlock([[1, 2], [3]], { ordered: true, marker: '1.' }),
      ]);
      expect(groups).toHaveLength(1);
      const g = groups[0]!;
      expect(g.kind).toBe('list');
      expect(g.sourceIndices).toEqual([]);
      expect(g.table).toBeUndefined();
      expect(g.list).toEqual({
        ordered: true,
        marker: '1.',
        items: [
          { level: 0, sourceIndices: [1, 2] },
          { level: 0, sourceIndices: [3] },
        ],
      });
    });

    it('is dropped when NO item resolves an editable run (null path)', () => {
      const groups = gigaBlocksToPageBlockGroups([
        listBlock([[null], [null]]),
      ]);
      expect(groups).toHaveLength(0);
    });
  });

  it('mixes paragraph, table and list groups in document order', () => {
    const groups = gigaBlocksToPageBlockGroups([
      textBlock('paragraph', [1, 2]),
      tableBlock([[[3, 4]]]),
      listBlock([[5, 6]]),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['paragraph', 'table', 'list']);
  });
});
