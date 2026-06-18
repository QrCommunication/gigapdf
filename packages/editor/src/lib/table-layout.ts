/**
 * Pure layout helpers for the editor "Insert" menu.
 *
 * The editor has no grouped-element / table primitive in the model
 * (`ElementBase` only carries `layerId`, not a parent/group id), so a table is
 * laid out as a coherent grid of INDIVIDUAL elements: one editable
 * {@link TextElement} per cell plus a set of `line` {@link ShapeElement} borders.
 * Every element is positioned in web coordinates (origin top-left, Y down, PDF
 * points) — the same convention the apply-elements bake pipeline already
 * consumes — so the produced elements flow through the normal element-add path
 * unchanged.
 *
 * These helpers are intentionally framework-free (no React, no Zustand) so they
 * are unit-testable in isolation.
 */

import type {
  Bounds,
  Element,
  ShapeElement,
  TextElement,
  TextStyle,
  Transform,
} from "@giga-pdf/types";

/** Element with no id yet — the create/add pipeline assigns `elementId`. */
export type NewElement = Omit<Element, "elementId">;

/** Identity transform shared by every freshly-inserted element. */
const IDENTITY_TRANSFORM: Transform = {
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
};

/** Sensible defaults for a freshly-inserted text run (matches editor defaults). */
const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: "Helvetica",
  fontSize: 12,
  fontWeight: "normal",
  fontStyle: "normal",
  color: "#000000",
  opacity: 1,
  textAlign: "left",
  lineHeight: 1.2,
  letterSpacing: 0,
  writingMode: "horizontal-tb",
  underline: false,
  strikethrough: false,
  backgroundColor: null,
  verticalAlign: "baseline",
  originalFont: null,
};

export interface BuildTableOptions {
  rows: number;
  cols: number;
  /**
   * Rectangle (web coords, PDF points) the table is laid out within — typically
   * the page content area (page size minus margins). Cells share its width/height
   * evenly.
   */
  area: Bounds;
  /** Border stroke colour (hex). Defaults to a light grey. */
  borderColor?: string;
  /** Border stroke width in points. Defaults to 1. */
  borderWidth?: number;
  /** Per-cell text padding in points (applied to the inner text bounds). Defaults to 4. */
  cellPadding?: number;
  /** Font size for cell text. Defaults to 12. */
  fontSize?: number;
}

/** Build one `line` shape element spanning two points (web coords). */
function lineElement(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
): Omit<ShapeElement, "elementId"> {
  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  const bounds: Bounds = {
    x: minX,
    y: minY,
    width: Math.max(Math.abs(x2 - x1), 1),
    height: Math.max(Math.abs(y2 - y1), 1),
  };
  return {
    type: "shape",
    shapeType: "line",
    bounds,
    transform: { ...IDENTITY_TRANSFORM },
    layerId: null,
    locked: false,
    visible: true,
    geometry: {
      points: [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ],
      pathData: null,
      cornerRadius: 0,
    },
    style: {
      fillColor: null,
      fillOpacity: 1,
      strokeColor: color,
      strokeWidth: width,
      strokeOpacity: 1,
      strokeDashArray: [],
    },
  };
}

/** Build one empty cell text element (web coords). */
function cellElement(
  bounds: Bounds,
  fontSize: number,
): Omit<TextElement, "elementId"> {
  return {
    type: "text",
    content: "",
    bounds,
    transform: { ...IDENTITY_TRANSFORM },
    layerId: null,
    locked: false,
    visible: true,
    style: { ...DEFAULT_TEXT_STYLE, fontSize },
    ocrConfidence: null,
    linkUrl: null,
    linkPage: null,
  };
}

/**
 * Build the full set of elements that make up an `rows`×`cols` table laid out
 * within `area`. The result is a flat list ready to feed one-by-one through the
 * editor's element-add pipeline.
 *
 * Layout: cells are evenly spaced; borders are drawn as `rows+1` horizontal and
 * `cols+1` vertical lines. Cell text sits inside its cell with `cellPadding`.
 */
export function buildTableElements(options: BuildTableOptions): NewElement[] {
  const {
    rows,
    cols,
    area,
    borderColor = "#9ca3af",
    borderWidth = 1,
    cellPadding = 4,
    fontSize = 12,
  } = options;

  if (rows < 1 || cols < 1) {
    throw new Error("buildTableElements: rows and cols must both be >= 1");
  }

  const cellW = area.width / cols;
  const cellH = area.height / rows;
  const left = area.x;
  const top = area.y;
  const right = area.x + area.width;
  const bottom = area.y + area.height;

  const elements: NewElement[] = [];

  // Cell text boxes (inner padded bounds, clamped so padding never inverts).
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const pad = Math.min(cellPadding, cellW / 2 - 1, cellH / 2 - 1);
      const safePad = Math.max(pad, 0);
      const bounds: Bounds = {
        x: left + c * cellW + safePad,
        y: top + r * cellH + safePad,
        width: Math.max(cellW - safePad * 2, 1),
        height: Math.max(cellH - safePad * 2, 1),
      };
      elements.push(cellElement(bounds, fontSize));
    }
  }

  // Horizontal border lines (top edge of each row + the bottom edge).
  for (let r = 0; r <= rows; r += 1) {
    const y = top + r * cellH;
    elements.push(lineElement(left, y, right, y, borderColor, borderWidth));
  }

  // Vertical border lines (left edge of each column + the right edge).
  for (let c = 0; c <= cols; c += 1) {
    const x = left + c * cellW;
    elements.push(lineElement(x, top, x, bottom, borderColor, borderWidth));
  }

  return elements;
}

/**
 * Prefix each non-empty line of `content` with a bullet ("• ") or a 1-based
 * ordinal ("1. ", "2. ", …). Lines already starting with the same marker are
 * left untouched (idempotent toggle-friendly). Blank lines are preserved as-is.
 */
export function buildListContent(
  content: string,
  kind: "bullet" | "numbered",
): string {
  const lines = content.split("\n");
  let ordinal = 0;
  return lines
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.length === 0) return line;
      if (kind === "bullet") {
        if (trimmed.startsWith("• ")) return line;
        return `• ${trimmed}`;
      }
      ordinal += 1;
      // Strip an existing "N. " prefix before renumbering.
      const withoutPrefix = trimmed.replace(/^\d+\.\s+/, "");
      return `${ordinal}. ${withoutPrefix}`;
    })
    .join("\n");
}
