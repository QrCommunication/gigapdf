"use client";

/**
 * list-format.ts
 *
 * SINGLE source of truth for Word-like list + paragraph-indentation rendering
 * on a `TextElement`. Pure (no React / Fabric / DOM), exported so the overlay
 * renderer (`render-elements.ts`) and the serialiser (`fabric-element-io.ts`)
 * compose and decompose the displayed text IDENTICALLY — no second, divergent
 * implementation (same discipline as `text-runs.ts`).
 *
 * Design (mirrors the engine's lossless-edit constraint): the list marker is a
 * render-time DECORATION. It is shown as a prefix on the Fabric text object but
 * is NEVER stored in the element's editable `content`. The renderer prepends
 * `<marker>\t`; the serialiser strips exactly that prefix back off before
 * persisting `content`. The model's per-character `runs` indices stay relative
 * to the CLEAN content; this module only exposes the prefix length so the
 * caller can shift Fabric's per-character styles map by it (and unshift on
 * read-back), keeping styling aligned with the marker present.
 */

import type { TextListStyle, TextStyle } from "@giga-pdf/types";
import type { FabricStylesMap } from "./text-runs";

/**
 * Indentation step per nesting level, in PDF points. Also the base gutter a
 * list marker sits in. 18pt ≈ 0.25in, Word's default list indent.
 */
export const INDENT_STEP_PT = 18;

/** Cycling bullet glyphs by nesting level (Word-like: •, ◦, ▪, then repeat). */
const BULLET_GLYPHS = ["•", "◦", "▪"] as const;

/** The separator placed between the marker and the text (a tab reads cleanly). */
const MARKER_SEPARATOR = "\t";

/** lower-case latin letters for "lettered" lists (a, b, …, z, aa, ab, …). */
function toLowerAlpha(n: number): string {
  // n is 1-based.
  let out = "";
  let v = n;
  while (v > 0) {
    const rem = (v - 1) % 26;
    out = String.fromCharCode(97 + rem) + out;
    v = Math.floor((v - 1) / 26);
  }
  return out || "a";
}

/** lower-case roman numerals for "roman" lists (i, ii, iii, iv, …). */
function toLowerRoman(n: number): string {
  if (n <= 0) return "i";
  const table: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let v = n;
  let out = "";
  for (const [value, sym] of table) {
    while (v >= value) {
      out += sym;
      v -= value;
    }
  }
  return out;
}

/**
 * Derive the marker GLYPH for a list paragraph. `ordinal` is the 1-based
 * position of this item within its (current) list for ordered families; bullets
 * ignore it. Absent/invalid ordinal defaults to 1 — a single paragraph toggled
 * to a numbered list reads "1." which is the expected single-item behaviour.
 */
export function listMarkerGlyph(list: TextListStyle, ordinal = 1): string {
  const n = Number.isFinite(ordinal) && ordinal > 0 ? Math.floor(ordinal) : 1;
  switch (list.type) {
    case "bullet": {
      const level = Math.max(0, list.level | 0);
      return BULLET_GLYPHS[level % BULLET_GLYPHS.length]!;
    }
    case "number":
      return `${n}.`;
    case "lettered":
      return `${toLowerAlpha(n)}.`;
    case "roman":
      return `${toLowerRoman(n)}.`;
    default:
      return BULLET_GLYPHS[0]!;
  }
}

/** The full decorative prefix (`<glyph><tab>`) for a list paragraph. */
export function listMarkerPrefix(list: TextListStyle, ordinal = 1): string {
  return `${listMarkerGlyph(list, ordinal)}${MARKER_SEPARATOR}`;
}

/**
 * Total left offset (PDF points) the text box is shifted right by, combining the
 * explicit `indentLeft` with one extra indent step per list nesting level so a
 * list always reserves a gutter for its marker.
 */
export function leftIndentOffset(style: Pick<TextStyle, "indentLeft" | "list">): number {
  const explicit = Math.max(0, style.indentLeft ?? 0);
  const listLevels = style.list ? Math.max(0, style.list.level | 0) + 1 : 0;
  return explicit + listLevels * INDENT_STEP_PT;
}

/**
 * Compose the text actually shown on the Fabric object from the element's clean
 * `content`. When the paragraph is a list, the marker prefix is prepended;
 * otherwise the content is returned unchanged.
 *
 * Returns the displayed string AND the length of the prepended marker prefix
 * (0 when not a list) so the caller can shift the per-character `styles` map.
 */
export function composeDisplayText(
  content: string,
  style: Pick<TextStyle, "list">,
  ordinal = 1,
): { display: string; prefixLen: number } {
  if (!style.list) return { display: content, prefixLen: 0 };
  const prefix = listMarkerPrefix(style.list, ordinal);
  return { display: prefix + content, prefixLen: prefix.length };
}

/**
 * Inverse of {@link composeDisplayText}: given the text read back off the Fabric
 * object and the element's known list style, strip the marker prefix to recover
 * the clean `content`. Tolerant — if the displayed text does not actually start
 * with the expected prefix (user edited inside the marker, or no list), it
 * returns the text unchanged with `prefixLen: 0`.
 */
export function stripDisplayText(
  display: string,
  style: Pick<TextStyle, "list">,
  ordinal = 1,
): { content: string; prefixLen: number } {
  if (!style.list) return { content: display, prefixLen: 0 };
  const prefix = listMarkerPrefix(style.list, ordinal);
  if (display.startsWith(prefix)) {
    return { content: display.slice(prefix.length), prefixLen: prefix.length };
  }
  return { content: display, prefixLen: 0 };
}

/**
 * Shift a clean-content Fabric per-character `styles` map RIGHT by `prefixLen`
 * char positions on the FIRST visual line (where the marker is prepended). The
 * marker glyph itself is left unstyled (it is decoration). A no-op when
 * `prefixLen <= 0` or the map is empty. Returns a new map (never mutates input).
 */
export function shiftStylesForMarker(
  styles: FabricStylesMap,
  prefixLen: number,
): FabricStylesMap {
  if (prefixLen <= 0) return styles;
  const out: FabricStylesMap = {};
  for (const [lineKey, lineMap] of Object.entries(styles)) {
    const line = Number(lineKey);
    const shifted: Record<number, (typeof lineMap)[number]> = {};
    for (const [charKey, style] of Object.entries(lineMap)) {
      const char = Number(charKey);
      // Only line 0 carries the marker prefix; other lines are unchanged.
      shifted[line === 0 ? char + prefixLen : char] = style;
    }
    out[line] = shifted;
  }
  return out;
}

/**
 * Inverse of {@link shiftStylesForMarker}: shift a Fabric per-character `styles`
 * map LEFT by `prefixLen` on the first visual line, DROPPING any style that
 * lands inside the marker prefix (those belong to the decoration, not the
 * content). A no-op when `prefixLen <= 0`. Returns a new map.
 */
export function unshiftStylesForMarker(
  styles: FabricStylesMap,
  prefixLen: number,
): FabricStylesMap {
  if (prefixLen <= 0) return styles;
  const out: FabricStylesMap = {};
  for (const [lineKey, lineMap] of Object.entries(styles)) {
    const line = Number(lineKey);
    const shifted: Record<number, (typeof lineMap)[number]> = {};
    for (const [charKey, style] of Object.entries(lineMap)) {
      const char = Number(charKey);
      if (line === 0) {
        const target = char - prefixLen;
        if (target < 0) continue; // inside the marker → drop
        shifted[target] = style;
      } else {
        shifted[char] = style;
      }
    }
    if (Object.keys(shifted).length > 0) out[line] = shifted;
  }
  return out;
}
