"use client";

/**
 * text-runs.ts
 *
 * SINGLE source of truth for converting between our model-level
 * {@link TextStyleRun}[] (character-level style overrides on a `TextElement`)
 * and Fabric.js IText's native per-character `styles` map.
 *
 * Fabric stores per-character styling as a NESTED map keyed by *visual* line
 * then char-in-line:  `{ [lineIndex]: { [charIndex]: TextStyleDeclaration } }`.
 * Our model stores FLAT runs over the element's `content` (UTF-16 code units,
 * the same indexing IText's `selectionStart`/`selectionEnd` use). These helpers
 * bridge the two and own the (small, fixed) mapping of which style fields are
 * per-character:
 *
 *   bold/italic/underline/strikethrough/colour/size/font-family.
 *
 * Both directions are pure and exported so the renderer (`render-elements.ts`)
 * and the serialiser (`fabric-element-io.ts`) round-trip IDENTICALLY — no
 * second, divergent implementation.
 */

import type { TextStyle, TextStyleRun } from "@giga-pdf/types";

/**
 * The subset of Fabric per-character style props we map to/from our model.
 * Fabric names differ from ours: `fill`←color, `linethrough`←strikethrough.
 */
export interface FabricCharStyle {
  fontWeight?: string;
  fontStyle?: string;
  underline?: boolean;
  linethrough?: boolean;
  fill?: string;
  fontSize?: number;
  fontFamily?: string;
}

/** Fabric's nested per-character styles map: `{ line: { char: style } }`. */
export type FabricStylesMap = Record<number, Record<number, FabricCharStyle>>;

/** True when a partial style carries at least one per-character field. */
function hasCharStyle(style: Partial<TextStyle>): boolean {
  return (
    style.fontWeight !== undefined ||
    style.fontStyle !== undefined ||
    style.underline !== undefined ||
    style.strikethrough !== undefined ||
    style.color !== undefined ||
    style.fontSize !== undefined ||
    style.fontFamily !== undefined
  );
}

/**
 * Map one model partial-style → the Fabric per-character declaration (exported
 * so the canvas can `setSelectionStyles` a sub-range with the same field
 * mapping the renderer uses).
 */
export function modelStyleToFabricChar(
  style: Partial<TextStyle>,
): FabricCharStyle {
  const out: FabricCharStyle = {};
  if (style.fontWeight !== undefined) out.fontWeight = style.fontWeight;
  if (style.fontStyle !== undefined) out.fontStyle = style.fontStyle;
  if (style.underline !== undefined) out.underline = style.underline;
  if (style.strikethrough !== undefined) out.linethrough = style.strikethrough;
  if (style.color !== undefined) out.fill = style.color;
  if (style.fontSize !== undefined) out.fontSize = style.fontSize;
  if (style.fontFamily !== undefined) out.fontFamily = style.fontFamily;
  return out;
}

/**
 * Map one Fabric per-character declaration → a model partial-style (exported so
 * the canvas can normalise an aggregated selection style for the toolbar's
 * active-state, with the same field mapping the serialiser uses).
 */
export function fabricCharToModelStyle(
  style: FabricCharStyle,
): Partial<TextStyle> {
  const out: Partial<TextStyle> = {};
  if (style.fontWeight !== undefined) {
    // Numeric weights (600/700) and "bold" both normalise to "bold".
    const w = style.fontWeight;
    const isBold =
      w === "bold" || w === "bolder" || (typeof w === "number" && w >= 600) ||
      (typeof w === "string" && /^\d+$/.test(w) && Number(w) >= 600);
    out.fontWeight = isBold ? "bold" : "normal";
  }
  if (style.fontStyle !== undefined) {
    out.fontStyle = style.fontStyle === "italic" ? "italic" : "normal";
  }
  if (style.underline !== undefined) out.underline = style.underline;
  if (style.linethrough !== undefined) out.strikethrough = style.linethrough;
  if (style.fill !== undefined) out.color = style.fill;
  if (style.fontSize !== undefined) out.fontSize = style.fontSize;
  if (style.fontFamily !== undefined) out.fontFamily = style.fontFamily;
  return out;
}

/** Stable key for grouping consecutive chars sharing the same style. */
function charStyleKey(style: Partial<TextStyle>): string {
  return JSON.stringify([
    style.fontWeight ?? null,
    style.fontStyle ?? null,
    style.underline ?? null,
    style.strikethrough ?? null,
    style.color ?? null,
    style.fontSize ?? null,
    style.fontFamily ?? null,
  ]);
}

/**
 * Per-visual-line lengths of `content`, matching how Fabric splits an IText
 * into `_textLines` (we treat each `\n`-separated segment as one line; soft
 * wrapping is not used by our single-run overlays, so this is exact).
 */
function lineLengths(content: string): number[] {
  return content.split("\n").map((l) => l.length);
}

/**
 * Build Fabric's nested per-character `styles` map from our flat model runs.
 * Returns an empty object when there are no runs (⇒ uniform element, Fabric
 * renders it with the object-level fontWeight/fill/… exactly as before).
 *
 * The newline char itself consumes one flat index between lines (Fabric does
 * not store a style for it); indices therefore advance by `len + 1` per line.
 */
export function runsToFabricStyles(
  content: string,
  runs: TextStyleRun[] | undefined,
): FabricStylesMap {
  if (!runs || runs.length === 0) return {};
  const map: FabricStylesMap = {};
  const lens = lineLengths(content);

  for (const run of runs) {
    if (!hasCharStyle(run.style)) continue;
    const fabricStyle = modelStyleToFabricChar(run.style);
    const start = Math.max(0, run.start);
    const end = Math.max(start, run.end);

    // Walk the requested flat range and scatter it across visual lines.
    let flat = 0; // flat index at the START of the current line
    for (let line = 0; line < lens.length; line++) {
      const len = lens[line]!;
      const lineStart = flat;
      const lineEnd = flat + len; // exclusive (the '\n' is at lineEnd)
      // Intersect [start, end) with this line's [lineStart, lineEnd).
      const from = Math.max(start, lineStart);
      const to = Math.min(end, lineEnd);
      if (from < to) {
        const lineMap = (map[line] ??= {});
        for (let i = from; i < to; i++) {
          lineMap[i - lineStart] = { ...lineMap[i - lineStart], ...fabricStyle };
        }
      }
      flat = lineEnd + 1; // +1 skips the newline separator
      if (flat > end) break;
    }
  }
  return map;
}

/**
 * Inverse of {@link runsToFabricStyles}: read Fabric's nested per-character
 * `styles` map back into our flat, coalesced model runs. Consecutive chars
 * carrying the SAME style collapse into one `[start, end)` run. Returns
 * `undefined` when no per-character styling is present (so the element stays
 * "uniform" and the `runs` field is omitted — preserving legacy shape).
 */
export function fabricStylesToRuns(
  content: string,
  styles: FabricStylesMap | undefined | null,
): TextStyleRun[] | undefined {
  if (!styles) return undefined;
  const lens = lineLengths(content);

  // Flatten the nested map into a sparse flat-index → model-style lookup.
  const flatStyles = new Map<number, Partial<TextStyle>>();
  let flat = 0;
  for (let line = 0; line < lens.length; line++) {
    const len = lens[line]!;
    const lineMap = styles[line];
    if (lineMap) {
      for (const [charKey, fabricStyle] of Object.entries(lineMap)) {
        const charIndex = Number(charKey);
        if (!Number.isFinite(charIndex) || charIndex < 0 || charIndex >= len) {
          continue;
        }
        const modelStyle = fabricCharToModelStyle(fabricStyle);
        if (Object.keys(modelStyle).length > 0) {
          flatStyles.set(flat + charIndex, modelStyle);
        }
      }
    }
    flat += len + 1; // +1 for the newline separator
  }

  if (flatStyles.size === 0) return undefined;

  // Coalesce consecutive equal styles into runs.
  const sortedIndices = [...flatStyles.keys()].sort((a, b) => a - b);
  const runs: TextStyleRun[] = [];
  let runStart = sortedIndices[0]!;
  let prevIndex = runStart;
  let prevKey = charStyleKey(flatStyles.get(runStart)!);
  let prevStyle = flatStyles.get(runStart)!;

  for (let i = 1; i < sortedIndices.length; i++) {
    const idx = sortedIndices[i]!;
    const key = charStyleKey(flatStyles.get(idx)!);
    if (idx === prevIndex + 1 && key === prevKey) {
      prevIndex = idx;
      continue;
    }
    runs.push({ start: runStart, end: prevIndex + 1, style: prevStyle });
    runStart = idx;
    prevIndex = idx;
    prevKey = key;
    prevStyle = flatStyles.get(idx)!;
  }
  runs.push({ start: runStart, end: prevIndex + 1, style: prevStyle });
  return runs;
}
