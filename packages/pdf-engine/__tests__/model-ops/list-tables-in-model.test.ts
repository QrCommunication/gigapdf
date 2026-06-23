import { describe, it, expect } from 'vitest';
import type { GigaDocument } from '@qrcommunication/gigapdf-lib';
import { listTablesInModel } from '../../src/model-ops';

// `listTablesInModel` is the table-address bridge: it walks the unified document
// model (sections → pages → blocks) and reports every `table` block with its
// positional handle `(pageNumber, tableIndexOnPage)`, resolved `[section, page,
// index]` address, grid size and placement frame. Unlike the paragraph/list
// bridge it does NOT key off `source_index` (table cell runs carry none) — it
// addresses tables positionally. Pure & deterministic — no WASM needed.

/** A cell spec: its `col_span` and the `source_index`es of its (single) run. */
interface CellSpec {
  colSpan?: number;
  rowSpan?: number;
  src?: Array<number>;
}

/** Build one cell's blocks (a paragraph carrying the given source indices). */
function cellBlocks(src: number[] | undefined): unknown[] {
  if (!src || src.length === 0) return [];
  return [
    {
      id: 0,
      frame: null,
      rotation: { t: 'd0' },
      kind: {
        t: 'paragraph',
        v: {
          style: {},
          style_ref: null,
          runs: src.map((source_index) => ({ t: 'run', source_index })),
        },
      },
    },
  ];
}

/**
 * Minimal table block. `rows` is an array of rows, each an array of cells given
 * either as a `col_span` number (no content) or a {@link CellSpec} (spans +
 * source indices). An optional `frame` mirrors the engine's placement rectangle.
 */
function table(
  rows: Array<Array<number | CellSpec>>,
  opts: { colWidths?: number[]; frame?: { x: number; y: number; w: number; h: number } } = {},
): unknown {
  const toCell = (c: number | CellSpec) => {
    const spec: CellSpec = typeof c === 'number' ? { colSpan: c } : c;
    return {
      blocks: cellBlocks(spec.src),
      col_span: spec.colSpan ?? 1,
      row_span: spec.rowSpan ?? 1,
      shading: null,
    };
  };
  return {
    id: 0,
    frame: opts.frame ?? null,
    rotation: { t: 'd0' },
    kind: {
      t: 'table',
      v: {
        col_widths: opts.colWidths ?? [],
        border: { width: 1, color: [0, 0, 0] },
        rows: rows.map((cells) => ({
          height: null,
          cells: cells.map(toCell),
        })),
      },
    },
  };
}

/** A paragraph block — carries no table, occupies a block index. */
function para(): unknown {
  return {
    id: 0,
    frame: null,
    rotation: { t: 'd0' },
    kind: {
      t: 'paragraph',
      v: { style: {}, style_ref: null, runs: [{ t: 'run', source_index: 1 }] },
    },
  };
}

/** Build a multi-section doc; `sections[k]` is a list of pages, each a block list. */
function doc(sections: unknown[][][]): GigaDocument {
  return {
    v: 1,
    meta: { title: null, author: null, subject: null, keywords: [], lang: null },
    styles: null,
    sections: sections.map((pages) => ({
      geometry: { width: 612, height: 792, margins: { top: 0, right: 0, bottom: 0, left: 0 } },
      header: null,
      footer: null,
      pages: pages.map((blocks) => ({ blocks, absolute: false })),
    })),
    outline: [],
    resources: null,
  } as unknown as GigaDocument;
}

/** Convenience: a one-section doc from a list of pages. */
function oneSection(pages: unknown[][]): GigaDocument {
  return doc([pages]);
}

describe('listTablesInModel', () => {
  it('reports a single table with its address, grid size and 1-based page', () => {
    const model = oneSection([[table([[1, 1, 1], [1, 1, 1]], { colWidths: [10, 10, 10] })]]);
    const tables = listTablesInModel(model);

    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({
      pageNumber: 1,
      tableIndexOnPage: 0,
      addr: [0, 0, 0],
      rowCount: 2,
      colCount: 3,
    });
  });

  it('addresses a table by its block index (paragraph before → table at index 1)', () => {
    const model = oneSection([[para(), table([[1, 1]])]]);
    const tables = listTablesInModel(model);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.addr).toEqual([0, 0, 1]);
    // colCount comes from the widest row's cumulative span.
    expect(tables[0]!.colCount).toBe(2);
  });

  it('numbers multiple tables on one page by reading order', () => {
    const model = oneSection([[table([[1]]), para(), table([[1, 1]])]]);
    const tables = listTablesInModel(model);
    expect(tables.map((t) => t.tableIndexOnPage)).toEqual([0, 1]);
    expect(tables.map((t) => t.addr)).toEqual([
      [0, 0, 0],
      [0, 0, 2],
    ]);
  });

  it('counts the running page number across pages and sections', () => {
    // section 0: page 1 (table), page 2 (table); section 1: page 3 (table).
    const model = doc([
      [[table([[1]])], [table([[1, 1]])]],
      [[table([[1]])]],
    ]);
    const tables = listTablesInModel(model);
    expect(tables.map((t) => t.pageNumber)).toEqual([1, 2, 3]);
    // Each is the first (and only) table on its own page.
    expect(tables.map((t) => t.tableIndexOnPage)).toEqual([0, 0, 0]);
    // Addresses keep their real [section, page, index] coordinates.
    expect(tables.map((t) => t.addr)).toEqual([
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
    ]);
  });

  it('derives colCount from the widest row when rows have unequal spans', () => {
    // row 0 spans 1+1=2 columns, row 1 spans 3 columns → colCount = 3.
    const model = oneSection([[table([[1, 1], [3]])]]);
    const tables = listTablesInModel(model);
    expect(tables[0]!.colCount).toBe(3);
    expect(tables[0]!.rowCount).toBe(2);
  });

  it('falls back to col_widths length for colCount when rows are empty', () => {
    const model = oneSection([[table([], { colWidths: [10, 20, 30, 40] })]]);
    const tables = listTablesInModel(model);
    expect(tables[0]!.rowCount).toBe(0);
    expect(tables[0]!.colCount).toBe(4);
  });

  it('carries the placement frame when the block has one', () => {
    const frame = { x: 72, y: 100, w: 400, h: 200 };
    const model = oneSection([[table([[1, 1]], { frame })]]);
    const tables = listTablesInModel(model);
    expect(tables[0]!.frame).toEqual(frame);
  });

  it('reports a null frame when the block carries none', () => {
    const model = oneSection([[table([[1]])]]);
    expect(listTablesInModel(model)[0]!.frame).toBeNull();
  });

  it('returns an empty array for a document with no tables', () => {
    expect(listTablesInModel(oneSection([[para()]]))).toEqual([]);
    expect(listTablesInModel(oneSection([[]]))).toEqual([]);
  });

  it('tolerates a malformed model without throwing', () => {
    const broken = { sections: null } as unknown as GigaDocument;
    expect(() => listTablesInModel(broken)).not.toThrow();
    expect(listTablesInModel(broken)).toEqual([]);
  });

  it('extracts cells with grid position, spans and source indices', () => {
    const model = oneSection([
      [
        table([
          [{ src: [10] }, { src: [11] }],
          [{ src: [12] }, { src: [13] }],
        ]),
      ],
    ]);
    const [tbl] = listTablesInModel(model);
    expect(tbl!.cells).toHaveLength(4);
    expect(tbl!.cells[0]).toEqual({
      row: 0,
      col: 0,
      colSpan: 1,
      rowSpan: 1,
      sourceIndices: [10],
    });
    expect(tbl!.cells[3]).toEqual({
      row: 1,
      col: 1,
      colSpan: 1,
      rowSpan: 1,
      sourceIndices: [13],
    });
  });

  it("computes a merged cell's leftmost grid column from prior spans", () => {
    // Row 0: a 2-wide cell then a 1-wide cell → second cell starts at col 2.
    const model = oneSection([[table([[{ colSpan: 2, src: [1] }, { src: [2] }]])]]);
    const [tbl] = listTablesInModel(model);
    expect(tbl!.cells[0]).toMatchObject({ col: 0, colSpan: 2 });
    expect(tbl!.cells[1]).toMatchObject({ col: 2, colSpan: 1 });
  });

  it('reports an empty cell with no source indices', () => {
    const model = oneSection([[table([[{ src: [5] }, {}]])]]);
    const [tbl] = listTablesInModel(model);
    expect(tbl!.cells[0]!.sourceIndices).toEqual([5]);
    expect(tbl!.cells[1]!.sourceIndices).toEqual([]);
  });

  it('reads the runtime-wrapped run shape inside a cell', () => {
    // A cell paragraph run in the `{ t:'run', v:{ source_index } }` form.
    const model = oneSection([
      [
        {
          id: 0,
          frame: null,
          rotation: { t: 'd0' },
          kind: {
            t: 'table',
            v: {
              col_widths: [],
              border: { width: 1, color: [0, 0, 0] },
              rows: [
                {
                  height: null,
                  cells: [
                    {
                      blocks: [
                        {
                          id: 0,
                          frame: null,
                          rotation: { t: 'd0' },
                          kind: {
                            t: 'paragraph',
                            v: {
                              style: {},
                              style_ref: null,
                              runs: [{ t: 'run', v: { source_index: 99 } }],
                            },
                          },
                        },
                      ],
                      col_span: 1,
                      row_span: 1,
                      shading: null,
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    ]);
    const [tbl] = listTablesInModel(model);
    expect(tbl!.cells[0]!.sourceIndices).toEqual([99]);
  });
});
