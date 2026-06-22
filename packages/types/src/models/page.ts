/**
 * Page models matching backend Pydantic schemas.
 */

import type { UUID, Dimensions } from "./common";
import type { Element } from "./elements";

export interface MediaBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PagePreview {
  thumbnailUrl: string | null;
  fullUrl: string | null;
}

/**
 * One cell of a {@link PageBlockTable}: the engine text-run indices of the runs
 * inside the cell (in reading order, `source_index` space → `TextElement.index`)
 * plus its grid placement. `sourceIndices` is EMPTY when the engine emitted no
 * `source_index` for the cell's runs (the common case today — the cell's glyphs
 * are still present as flat `TextElement`s and rendered element-by-element); the
 * renderer then leaves that cell to the element-based path (no regression).
 */
export interface PageBlockTableCell {
  /** 0-based row index in the table grid. */
  row: number;
  /** 0-based column index (leftmost spanned column for a merged cell). */
  col: number;
  /** Columns this cell spans (≥ 1). */
  colSpan: number;
  /** Rows this cell spans (≥ 1). */
  rowSpan: number;
  /** Engine run indices of the cell's editable runs, in reading order. */
  sourceIndices: number[];
}

/** Structural payload of a `table` block: grid geometry + per-cell run indices. */
export interface PageBlockTable {
  /** Number of grid rows. */
  rowCount: number;
  /** Number of grid columns. */
  colCount: number;
  /** Column widths in PDF points (length = `colCount`), left→right. */
  colWidths: number[];
  /** Row heights in PDF points (length = `rowCount`), top→bottom. */
  rowHeights: number[];
  /** The cells, in row-major reading order. */
  cells: PageBlockTableCell[];
}

/**
 * One item of a {@link PageBlockList}: its run indices (reading order) and nesting
 * level. `sourceIndices` is EMPTY when the engine emitted no `source_index` for
 * the item's runs (the item's glyphs stay flat `TextElement`s → element-based
 * render, no regression).
 */
export interface PageBlockListItem {
  /** Nesting depth (0 = top level). */
  level: number;
  /** Engine run indices of the item's editable runs, in reading order. */
  sourceIndices: number[];
}

/** Structural payload of a `list` block: ordering, marker glyph + its items. */
export interface PageBlockList {
  /** True for ordered (numbered) lists, false for bulleted. */
  ordered: boolean;
  /** The marker glyph to prefix each item with (e.g. "-", "•", "1."). */
  marker: string;
  /** The list items, in reading order. */
  items: PageBlockListItem[];
}

/**
 * A structural block group surfaced by the native engine's `pageBlocks` — the
 * lib being the authoritative source of the page's reading structure. Reduced
 * to what the editor needs to coalesce its flat text runs into Word-like blocks
 * losslessly:
 *
 *   - `kind`          — the engine block type. The editor coalesces
 *     `paragraph` / `heading` (via `sourceIndices`) and reconstructs
 *     `table` / `list` (via the `table` / `list` payloads); the other kinds are
 *     carried for forward compatibility but left to the element-based renderer.
 *   - `sourceIndices` — for `paragraph` / `heading`: the engine text-run indices
 *     (`source_index`) of the block's runs, in reading order. They map 1:1 onto
 *     `TextElement.index` (same engine index space used by `replaceText` /
 *     `moveElement`), so the editor resolves each run from its existing parsed
 *     element (correct bounds/style/embedded font) and the lossless in-place edit
 *     pipeline keeps working unchanged. For `table` / `list` the per-cell /
 *     per-item indices live in `table` / `list` instead, so this stays empty.
 *   - `table` / `list` — present only for the matching `kind`: the structural
 *     reconstruction (grid of cells / ordered items), each carrying its own run
 *     indices. A cell / item whose runs have no engine `source_index` carries an
 *     empty `sourceIndices`, and the renderer leaves it to the element-based path
 *     (zero regression vs today's flat rendering).
 */
export interface PageBlockGroup {
  kind:
    | "paragraph"
    | "heading"
    | "list"
    | "table"
    | "image"
    | "shape"
    | "textbox"
    | "sheet"
    | "slide";
  sourceIndices: number[];
  /** Structural payload when `kind === "table"`. */
  table?: PageBlockTable;
  /** Structural payload when `kind === "list"`. */
  list?: PageBlockList;
}

export interface PageObject {
  pageId: UUID;
  pageNumber: number;
  dimensions: Dimensions & { rotation: 0 | 90 | 180 | 270 };
  mediaBox: MediaBox;
  cropBox: MediaBox | null;
  elements: Element[];
  preview: PagePreview;
  /**
   * Optional structural grouping from the native engine's `pageBlocks`. When
   * present (editor load path), the renderer coalesces the page's flat text
   * runs into paragraph/heading Textboxes using THIS grouping (lib = source of
   * structure) instead of its own positional heuristic. Absent for read-only
   * viewers and any consumer that does not request blocks → the renderer falls
   * back to its heuristic grouping, so the shape stays backward compatible.
   */
  blockGroups?: PageBlockGroup[];
}

export interface PageSummary {
  pageNumber: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  thumbnailUrl: string | null;
}

export type PreviewFormat = "png" | "jpeg" | "webp" | "svg";

export interface PreviewOptions {
  format?: PreviewFormat;
  dpi?: number;
  quality?: number;
  scale?: number;
}
