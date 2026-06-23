"use client";

/**
 * table-edit-overlay.tsx
 *
 * The Word-like table-editing layer: a per-page overlay that draws a selectable
 * rectangle over every table the engine reconstructed (frames come from
 * `/api/pdf/table-structure` in PDF user-space, origin bottom-left), and a small
 * floating toolbar — appearing above the selected table — to add / remove a row
 * or column. Each action bakes the structural edit natively through the engine
 * (`applyModelOps` with `tableOps`) and the page re-parses, so the change is real
 * (a true model edit + reload), not an overlay decoration.
 *
 * Why a POSITIONAL handle, not `source_index`. The editor's in-place text edits
 * key off a run's flat `source_index`; table CELL runs carry none (the engine
 * reconstructs a cell as a single text-only run with `source_index: null`). A
 * table is therefore selected by HIT-TESTING a click against its frame and
 * addressed by its position — `(pageNumber, tableIndexOnPage)` — which the bake
 * resolves back to the table block. Geometry is the only viable seam here.
 *
 * Coordinate model
 * ────────────────
 * Frames are PDF points, origin bottom-left (Y-up). The sheet renders at `zoom`
 * (1pt → 1px at zoom 1), origin top-left (Y-down). Each frame is flipped to
 * displayed-point space (rotation-aware, mirroring the engine's `webToPdf`
 * inverse) and scaled by `zoom`: `px = pt * zoom`. The overlay fills the page
 * sheet absolutely; only the table rectangles + toolbar are pointer-interactive
 * (the rest is `pointer-events-none`), so it never steals clicks from the page.
 */

import React, { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
} from "lucide-react";
import type { TableStructureInfo } from "@giga-pdf/api";

/** Which add/remove action a toolbar button triggers, in grid terms. */
export type TableEditAction =
  | "insertRowAbove"
  | "insertRowBelow"
  | "insertColumnLeft"
  | "insertColumnRight"
  | "deleteRow"
  | "deleteColumn";

export interface TableEditOverlayProps {
  /** Tables on THIS page (already filtered to `pageNumber`), in reading order. */
  tables: TableStructureInfo[];
  /** Page width in PDF points, on the intrinsic (un-rotated) media box. */
  pageWidthPts: number;
  /** Page height in PDF points, on the intrinsic (un-rotated) media box. */
  pageHeightPts: number;
  /** Page `/Rotate` (CW): frames are flipped to displayed space accordingly. */
  rotation: 0 | 90 | 180 | 270;
  /** Current zoom factor (1 = 100%): points → px. */
  zoom: number;
  /** The selected table's `tableIndexOnPage`, or `null` when none is selected. */
  selectedTableIndex: number | null;
  /**
   * The active cell within the selected table (`row`/`col`), when a cell was
   * resolved (e.g. a cell's text was clicked) — drives precise insertion + shows
   * a hint on the toolbar. `null` ⇒ the table is selected by its frame only and
   * actions act on the table's edges.
   */
  activeCell: { row: number; col: number } | null;
  /** Select (or, with `null`, clear) a table by its `tableIndexOnPage`. */
  onSelectTable: (tableIndexOnPage: number | null) => void;
  /** Run an add/remove action on the selected table. */
  onAction: (tableIndexOnPage: number, action: TableEditAction) => void;
  /** Disables the toolbar buttons while a bake is in flight. */
  busy?: boolean;
}

/** A table's on-screen rectangle (CSS px within the displayed sheet). */
interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Flip a PDF-user-space frame (origin bottom-left) to displayed-point space
 * (origin top-left), rotation-aware, then scale by `zoom` to CSS px. Mirrors the
 * engine's `webToPdf` inverse: at rotation 0 the displayed height is the page
 * height and Y flips against it; at 90/270 the displayed box is swapped (height =
 * page WIDTH); at 180 X also flips. Returns `null` when the table has no frame.
 */
function frameToScreenRect(
  frame: TableStructureInfo["frame"],
  pageWidthPts: number,
  pageHeightPts: number,
  rotation: 0 | 90 | 180 | 270,
  zoom: number,
): ScreenRect | null {
  if (!frame) return null;
  const { x, y, w, h } = frame;

  // Displayed point-space top-left (Y-down) before zoom. The displayed height
  // used for the Y-flip is the page width on a 90/270 rotation (dims swapped).
  let left: number;
  let top: number;
  let width: number;
  let height: number;

  if (rotation === 90 || rotation === 270) {
    const displayedHeight = pageWidthPts;
    left = x;
    top = displayedHeight - y - h;
    width = w;
    height = h;
  } else if (rotation === 180) {
    left = pageHeightPts - x - w; // X flips on 180° (mirrors webToPdf)
    top = y;
    width = w;
    height = h;
  } else {
    left = x;
    top = pageHeightPts - y - h;
    width = w;
    height = h;
  }

  return {
    left: left * zoom,
    top: top * zoom,
    width: width * zoom,
    height: height * zoom,
  };
}

/** One add/remove toolbar button (icon + accessible label + handler). */
function ToolbarButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "text-destructive hover:bg-destructive/10"
          : "text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The floating add/remove toolbar, positioned just above a table's screen rect
 * (or below it when the table starts near the top of the sheet so the toolbar
 * stays visible). Pointer-interactive.
 */
function TableToolbar({
  rect,
  tableIndexOnPage,
  canDeleteRow,
  canDeleteColumn,
  activeCell,
  onAction,
  busy,
}: {
  rect: ScreenRect;
  tableIndexOnPage: number;
  canDeleteRow: boolean;
  canDeleteColumn: boolean;
  activeCell: { row: number; col: number } | null;
  onAction: (tableIndexOnPage: number, action: TableEditAction) => void;
  busy: boolean;
}) {
  const t = useTranslations("editor.tableEdit");
  const TOOLBAR_HEIGHT = 36; // approx; used to decide above/below placement
  const placeBelow = rect.top < TOOLBAR_HEIGHT + 8;
  const top = placeBelow ? rect.top + rect.height + 6 : rect.top - TOOLBAR_HEIGHT - 6;

  const run = (action: TableEditAction) => () =>
    onAction(tableIndexOnPage, action);

  // When a cell is active the actions act AT that cell (precise); otherwise on
  // the table edges. Surface that in each button's title so the behaviour is
  // discoverable (e.g. "Insert row above (row 2)").
  const at = activeCell
    ? { r: activeCell.row + 1, c: activeCell.col + 1 }
    : null;
  const label = (key: string) =>
    at ? `${t(key)} — ${t("atCell", { row: at.r, col: at.c })}` : t(key);

  return (
    <div
      className="pointer-events-auto absolute z-30 flex items-center gap-0.5 rounded-lg border border-border bg-background p-1 shadow-lg"
      style={{ left: rect.left, top }}
      // Prevent the page-body deselect handler from firing when using the bar.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ToolbarButton label={label("insertRowAbove")} onClick={run("insertRowAbove")} disabled={busy}>
        <ArrowUpToLine size={15} />
      </ToolbarButton>
      <ToolbarButton label={label("insertRowBelow")} onClick={run("insertRowBelow")} disabled={busy}>
        <ArrowDownToLine size={15} />
      </ToolbarButton>
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
      <ToolbarButton
        label={label("insertColumnLeft")}
        onClick={run("insertColumnLeft")}
        disabled={busy}
      >
        <ArrowLeftToLine size={15} />
      </ToolbarButton>
      <ToolbarButton
        label={label("insertColumnRight")}
        onClick={run("insertColumnRight")}
        disabled={busy}
      >
        <ArrowRightToLine size={15} />
      </ToolbarButton>
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
      <ToolbarButton
        label={label("deleteRow")}
        onClick={run("deleteRow")}
        disabled={busy || !canDeleteRow}
        danger
      >
        <span className="relative flex items-center">
          <Trash2 size={15} />
        </span>
      </ToolbarButton>
      <ToolbarButton
        label={label("deleteColumn")}
        onClick={run("deleteColumn")}
        disabled={busy || !canDeleteColumn}
        danger
      >
        <ArrowRightToLine size={15} className="rotate-90" />
      </ToolbarButton>
    </div>
  );
}

/**
 * The table-editing overlay: a selectable rectangle per reconstructed table plus
 * the floating add/remove toolbar for the selected one. Renders nothing useful
 * when no table on the page has a frame (the rectangles are skipped).
 */
export function TableEditOverlay({
  tables,
  pageWidthPts,
  pageHeightPts,
  rotation,
  zoom,
  selectedTableIndex,
  activeCell,
  onSelectTable,
  onAction,
  busy = false,
}: TableEditOverlayProps) {
  const t = useTranslations("editor.tableEdit");

  // Precompute each table's screen rect once per geometry change.
  const rects = useMemo(
    () =>
      tables.map((table) => ({
        table,
        rect: frameToScreenRect(
          table.frame,
          pageWidthPts,
          pageHeightPts,
          rotation,
          zoom,
        ),
      })),
    [tables, pageWidthPts, pageHeightPts, rotation, zoom],
  );

  const selected = rects.find(
    (r) => r.table.tableIndexOnPage === selectedTableIndex && r.rect !== null,
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {rects.map(({ table, rect }) => {
        if (!rect) return null;
        const isSelected = table.tableIndexOnPage === selectedTableIndex;
        return (
          <button
            key={table.tableIndexOnPage}
            type="button"
            aria-label={t("selectTable", {
              rows: table.rowCount,
              cols: table.colCount,
            })}
            aria-pressed={isSelected}
            onMouseDown={(e) => {
              // Claim the click so the page body doesn't deselect underneath.
              e.stopPropagation();
            }}
            onClick={() =>
              onSelectTable(isSelected ? null : table.tableIndexOnPage)
            }
            className={`pointer-events-auto absolute rounded-sm transition-colors ${
              isSelected
                ? "border-2 border-primary bg-primary/5"
                : "border border-dashed border-primary/40 bg-transparent hover:border-primary/70 hover:bg-primary/5"
            }`}
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
          />
        );
      })}

      {selected && selected.rect ? (
        <TableToolbar
          rect={selected.rect}
          tableIndexOnPage={selected.table.tableIndexOnPage}
          canDeleteRow={selected.table.rowCount > 1}
          canDeleteColumn={selected.table.colCount > 1}
          activeCell={activeCell}
          onAction={onAction}
          busy={busy}
        />
      ) : null}
    </div>
  );
}
