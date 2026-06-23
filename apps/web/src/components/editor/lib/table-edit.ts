"use client";

/**
 * table-edit.ts
 *
 * Pure mapping between the table-edit overlay's grid-relative ACTION buttons
 * (insert row above/below, insert column left/right, delete row/column) and the
 * engine's positional {@link TableEdit} op, PLUS the resolver that maps a clicked
 * text element to its owning table cell. No React / Fabric / DOM — exported so
 * the editor page and unit tests share ONE source of truth.
 *
 * Tables are addressed positionally (`pageNumber` + `tableIndexOnPage`). The
 * engine now propagates each cell's first content-stream run index onto the cell
 * (`TableCellInfo.sourceIndices`), so a clicked `TextElement.index` resolves to a
 * specific cell `(row, col)` — enabling insertion at that EXACT grid index, not
 * just the table's edges:
 *   - insertRowAbove   → insertRow at `row`        (above the active cell's row)
 *   - insertRowBelow   → insertRow at `row + 1`    (below the active cell's row)
 *   - insertColumnLeft → insertColumn at `col`     (left of the active cell's col)
 *   - insertColumnRight→ insertColumn at `col + 1` (right of the active cell's col)
 *   - deleteRow        → deleteRow at `row`        (the active cell's row)
 *   - deleteColumn     → deleteColumn at `col`     (the active cell's column)
 *
 * When NO active cell is known (the table was selected by clicking its frame, not
 * a cell), the actions fall back to the table's edges (`at = 0` / count), a
 * predictable "add a row / column" default. The engine clamps out-of-range `at`.
 */

import type { TableEdit, TableStructureInfo } from "@giga-pdf/api";
import type { TableEditAction, TableStyleAction } from "../table-edit-overlay";

/** The selected table's identity + grid size, enough to resolve an action. */
export interface TableEditTarget {
  /** 1-based page number (matches `TextElement` pages). */
  pageNumber: number;
  /** 0-based index of the table among the tables on its page. */
  tableIndexOnPage: number;
  /** Current number of grid rows. */
  rowCount: number;
  /** Current number of grid columns. */
  colCount: number;
  /**
   * The active cell's grid position, when a cell (not just the table frame) is
   * selected — drives precise insertion at that row/column. Omitted ⇒ edge
   * fallback.
   */
  activeCell?: { row: number; col: number };
}

/**
 * Build the engine {@link TableEdit} for an overlay action on a table.
 *
 * Returns `null` for a delete that would empty the table (deleting the last row
 * of a 1-row table, or last column of a 1-column table) — the overlay also
 * disables those buttons, but guard here so a stray call is a no-op rather than
 * an edit that destroys the table.
 */
export function actionToTableEdit(
  target: TableEditTarget,
  action: TableEditAction,
): TableEdit | null {
  const { pageNumber, tableIndexOnPage, rowCount, colCount, activeCell } = target;
  const base = { pageNumber, tableIndexOnPage } as const;
  // Active cell drives precise positioning; without it, fall back to the edges.
  const row = activeCell?.row;
  const col = activeCell?.col;

  switch (action) {
    case "insertRowAbove":
      return { ...base, kind: "insertRow", at: row ?? 0 };
    case "insertRowBelow":
      return {
        ...base,
        kind: "insertRow",
        at: row != null ? row + 1 : Math.max(0, rowCount),
      };
    case "insertColumnLeft":
      return { ...base, kind: "insertColumn", at: col ?? 0 };
    case "insertColumnRight":
      return {
        ...base,
        kind: "insertColumn",
        at: col != null ? col + 1 : Math.max(0, colCount),
      };
    case "deleteRow":
      if (rowCount <= 1) return null;
      return { ...base, kind: "deleteRow", at: row ?? rowCount - 1 };
    case "deleteColumn":
      if (colCount <= 1) return null;
      return { ...base, kind: "deleteColumn", at: col ?? colCount - 1 };
  }
}

/**
 * Build the positional engine {@link TableEdit} for a table STYLE action
 * (shading, row height, column width, border, cell span). Unlike the grid
 * {@link actionToTableEdit}, the {@link TableStyleAction} already carries its
 * value(s) and target cell/row/column — this only stamps the table's
 * `(pageNumber, tableIndexOnPage)` handle onto it. Pure & deterministic.
 */
export function styleActionToTableEdit(
  target: Pick<TableEditTarget, "pageNumber" | "tableIndexOnPage">,
  action: TableStyleAction,
): TableEdit {
  const { pageNumber, tableIndexOnPage } = target;
  const base = { pageNumber, tableIndexOnPage } as const;
  switch (action.kind) {
    case "setCellShading":
      return {
        ...base,
        kind: "setCellShading",
        row: action.row,
        col: action.col,
        color: action.color,
      };
    case "setRowHeight":
      return { ...base, kind: "setRowHeight", row: action.row, height: action.height };
    case "setColWidth":
      return { ...base, kind: "setColWidth", col: action.col, width: action.width };
    case "setTableBorder":
      return { ...base, kind: "setTableBorder", border: action.border };
    case "setCellSpan":
      return {
        ...base,
        kind: "setCellSpan",
        row: action.row,
        col: action.col,
        colSpan: action.colSpan,
        rowSpan: action.rowSpan,
      };
  }
}

/** Where a clicked text element lives: which table on the page, and which cell. */
export interface CellLocation {
  /** 0-based index of the table among the tables on its page. */
  tableIndexOnPage: number;
  /** 0-based grid row of the cell. */
  row: number;
  /** 0-based leftmost grid column of the cell. */
  col: number;
}

/**
 * Build a map from a run's `source_index` (= `TextElement.index`) to its cell
 * location, across all `tables` on a page. Lets the editor resolve a clicked text
 * element to `(table, row, col)` so a cell click selects its table and targets a
 * precise insertion. A cell may own several run indices (all map to that cell);
 * cells with no runs contribute nothing. Pure & deterministic.
 */
export function buildSourceIndexToCellMap(
  tables: TableStructureInfo[],
): Map<number, CellLocation> {
  const map = new Map<number, CellLocation>();
  for (const table of tables) {
    for (const cell of table.cells) {
      for (const sourceIndex of cell.sourceIndices) {
        // First-writer-wins: a source index belongs to exactly one cell; guard
        // against any accidental duplicate so the location stays stable.
        if (!map.has(sourceIndex)) {
          map.set(sourceIndex, {
            tableIndexOnPage: table.tableIndexOnPage,
            row: cell.row,
            col: cell.col,
          });
        }
      }
    }
  }
  return map;
}
