import { describe, it, expect } from "vitest";
import type { TableStructureInfo } from "@giga-pdf/api";
import {
  actionToTableEdit,
  buildSourceIndexToCellMap,
  type TableEditTarget,
} from "../table-edit";

// `actionToTableEdit` is the pure overlay-action → engine-op mapping. It resolves
// each grid-relative action to a positional TableEdit (`pageNumber` +
// `tableIndexOnPage`), choosing the grid edge `at` index. No WASM, no DOM.

const target = (
  over: Partial<TableEditTarget> = {},
): TableEditTarget => ({
  pageNumber: 1,
  tableIndexOnPage: 0,
  rowCount: 3,
  colCount: 4,
  ...over,
});

describe("actionToTableEdit", () => {
  it("insertRowAbove prepends a row at index 0", () => {
    expect(actionToTableEdit(target(), "insertRowAbove")).toEqual({
      pageNumber: 1,
      tableIndexOnPage: 0,
      kind: "insertRow",
      at: 0,
    });
  });

  it("insertRowBelow appends a row at rowCount", () => {
    expect(actionToTableEdit(target({ rowCount: 3 }), "insertRowBelow")).toEqual({
      pageNumber: 1,
      tableIndexOnPage: 0,
      kind: "insertRow",
      at: 3,
    });
  });

  it("insertColumnLeft prepends a column at index 0", () => {
    expect(actionToTableEdit(target(), "insertColumnLeft")).toEqual({
      pageNumber: 1,
      tableIndexOnPage: 0,
      kind: "insertColumn",
      at: 0,
    });
  });

  it("insertColumnRight appends a column at colCount", () => {
    expect(
      actionToTableEdit(target({ colCount: 4 }), "insertColumnRight"),
    ).toEqual({
      pageNumber: 1,
      tableIndexOnPage: 0,
      kind: "insertColumn",
      at: 4,
    });
  });

  it("deleteRow removes the last row (rowCount - 1)", () => {
    expect(actionToTableEdit(target({ rowCount: 3 }), "deleteRow")).toEqual({
      pageNumber: 1,
      tableIndexOnPage: 0,
      kind: "deleteRow",
      at: 2,
    });
  });

  it("deleteColumn removes the last column (colCount - 1)", () => {
    expect(actionToTableEdit(target({ colCount: 4 }), "deleteColumn")).toEqual({
      pageNumber: 1,
      tableIndexOnPage: 0,
      kind: "deleteColumn",
      at: 3,
    });
  });

  it("returns null for deleteRow on a single-row table (would empty it)", () => {
    expect(actionToTableEdit(target({ rowCount: 1 }), "deleteRow")).toBeNull();
  });

  it("returns null for deleteColumn on a single-column table (would empty it)", () => {
    expect(
      actionToTableEdit(target({ colCount: 1 }), "deleteColumn"),
    ).toBeNull();
  });

  it("carries the table's positional handle (page + index) through", () => {
    const edit = actionToTableEdit(
      target({ pageNumber: 5, tableIndexOnPage: 2 }),
      "insertRowAbove",
    );
    expect(edit).toMatchObject({ pageNumber: 5, tableIndexOnPage: 2 });
  });

  it("clamps a degenerate (negative) count to a non-negative at", () => {
    // Defensive: rowCount should never be < 0, but the mapping must not emit a
    // negative `at` (the route rejects it).
    const edit = actionToTableEdit(target({ rowCount: -2 }), "insertRowBelow");
    expect(edit).toMatchObject({ kind: "insertRow", at: 0 });
  });

  // ── Precise positioning when an active cell is known ──
  const cellTarget = (
    activeCell: { row: number; col: number },
    over: Partial<TableEditTarget> = {},
  ): TableEditTarget => target({ activeCell, ...over });

  it("insertRowAbove targets the active cell's row", () => {
    expect(
      actionToTableEdit(cellTarget({ row: 1, col: 2 }), "insertRowAbove"),
    ).toMatchObject({ kind: "insertRow", at: 1 });
  });

  it("insertRowBelow targets the row after the active cell", () => {
    expect(
      actionToTableEdit(cellTarget({ row: 1, col: 2 }), "insertRowBelow"),
    ).toMatchObject({ kind: "insertRow", at: 2 });
  });

  it("insertColumnLeft targets the active cell's column", () => {
    expect(
      actionToTableEdit(cellTarget({ row: 1, col: 2 }), "insertColumnLeft"),
    ).toMatchObject({ kind: "insertColumn", at: 2 });
  });

  it("insertColumnRight targets the column after the active cell", () => {
    expect(
      actionToTableEdit(cellTarget({ row: 1, col: 2 }), "insertColumnRight"),
    ).toMatchObject({ kind: "insertColumn", at: 3 });
  });

  it("deleteRow targets the active cell's row (not the last)", () => {
    expect(
      actionToTableEdit(cellTarget({ row: 0, col: 1 }, { rowCount: 4 }), "deleteRow"),
    ).toMatchObject({ kind: "deleteRow", at: 0 });
  });

  it("deleteColumn targets the active cell's column (not the last)", () => {
    expect(
      actionToTableEdit(cellTarget({ row: 2, col: 1 }, { colCount: 4 }), "deleteColumn"),
    ).toMatchObject({ kind: "deleteColumn", at: 1 });
  });
});

describe("buildSourceIndexToCellMap", () => {
  const tbl = (
    tableIndexOnPage: number,
    cells: Array<{ row: number; col: number; sourceIndices: number[] }>,
  ): TableStructureInfo => ({
    pageNumber: 1,
    tableIndexOnPage,
    rowCount: 2,
    colCount: 2,
    frame: null,
    cells: cells.map((c) => ({ colSpan: 1, rowSpan: 1, ...c })),
  });

  it("maps each cell run index to its (table, row, col)", () => {
    const map = buildSourceIndexToCellMap([
      tbl(0, [
        { row: 0, col: 0, sourceIndices: [10] },
        { row: 0, col: 1, sourceIndices: [11, 12] },
        { row: 1, col: 0, sourceIndices: [13] },
      ]),
    ]);
    expect(map.get(10)).toEqual({ tableIndexOnPage: 0, row: 0, col: 0 });
    // Both runs of the second cell resolve to the same cell.
    expect(map.get(11)).toEqual({ tableIndexOnPage: 0, row: 0, col: 1 });
    expect(map.get(12)).toEqual({ tableIndexOnPage: 0, row: 0, col: 1 });
    expect(map.get(13)).toEqual({ tableIndexOnPage: 0, row: 1, col: 0 });
    expect(map.size).toBe(4);
  });

  it("disambiguates cells across multiple tables on the page", () => {
    const map = buildSourceIndexToCellMap([
      tbl(0, [{ row: 0, col: 0, sourceIndices: [1] }]),
      tbl(1, [{ row: 1, col: 1, sourceIndices: [2] }]),
    ]);
    expect(map.get(1)).toMatchObject({ tableIndexOnPage: 0 });
    expect(map.get(2)).toMatchObject({ tableIndexOnPage: 1, row: 1, col: 1 });
  });

  it("ignores cells with no source indices (empty cells)", () => {
    const map = buildSourceIndexToCellMap([
      tbl(0, [
        { row: 0, col: 0, sourceIndices: [] },
        { row: 0, col: 1, sourceIndices: [5] },
      ]),
    ]);
    expect(map.size).toBe(1);
    expect(map.get(5)).toMatchObject({ row: 0, col: 1 });
  });

  it("returns an empty map for tables with no addressable cells", () => {
    expect(buildSourceIndexToCellMap([]).size).toBe(0);
    expect(
      buildSourceIndexToCellMap([tbl(0, [{ row: 0, col: 0, sourceIndices: [] }])])
        .size,
    ).toBe(0);
  });
});
