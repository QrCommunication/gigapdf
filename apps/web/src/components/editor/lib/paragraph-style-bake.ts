"use client";

/**
 * paragraph-style-bake.ts
 *
 * Pure mapping between the editor's flat {@link TextStyle} patches (emitted by
 * the formatting toolbar / properties panel) and the engine's structural
 * model-op vocabulary ({@link ParagraphStylePatch} + {@link ListEdit}). No React
 * / Fabric / DOM — exported so the editor page and unit tests share ONE source
 * of truth for "which TextStyle fields bake natively, and how they map".
 *
 * The native bake path (`applyModelOps`, keyed by a run's `source_index`) covers
 * PARAGRAPH-level formatting — alignment, left indent and line spacing — plus
 * LIST level/marker/ordered. Character-level fields (bold/italic/colour/size/…)
 * and the list TOGGLE (creating/removing a list, which has no `setList*` op)
 * stay on the editor's flat redact+add path; {@link splitTextStylePatch}
 * separates the two so the caller routes each correctly.
 *
 * Field mapping (editor → engine, lengths already in PDF points):
 *   textAlign  → ParagraphStylePatch.align
 *   indentLeft → ParagraphStylePatch.indent_left
 *   lineHeight → ParagraphStylePatch.line_height = { t: 'multiple', v }
 *   list.level → ListEdit { kind: 'level' }
 *   list.type  → ListEdit { kind: 'marker' } + { kind: 'ordered' }
 */

import type { ListType, TextListStyle, TextStyle } from "@giga-pdf/types";
import type {
  ListEdit,
  ListMarkerSpec,
  ParagraphStylePatch,
} from "@giga-pdf/api";

/**
 * The {@link TextStyle} keys that bake natively as PARAGRAPH-level model ops
 * (`setParagraphStyle`). Everything else on a patch is character-level (runs)
 * or the list field (handled separately) and stays on the flat path.
 */
const PARAGRAPH_STYLE_KEYS = [
  "textAlign",
  "indentLeft",
  "lineHeight",
] as const satisfies readonly (keyof TextStyle)[];

/**
 * Map an editor list {@link ListType} to the engine's list marker + ordered
 * flag. Bullets are unordered; number/lettered/roman are ordered with their
 * respective marker family. The bullet glyph mirrors `list-format.ts`'s
 * first-level bullet so the baked PDF matches the editor's decoration.
 */
export function listTypeToMarker(type: ListType): {
  marker: ListMarkerSpec;
  ordered: boolean;
} {
  switch (type) {
    case "bullet":
      return { marker: { t: "bullet", v: "•" }, ordered: false };
    case "number":
      return { marker: { t: "decimal" }, ordered: true };
    case "lettered":
      return { marker: { t: "lower_alpha" }, ordered: true };
    case "roman":
      return { marker: { t: "lower_roman" }, ordered: true };
    default:
      return { marker: { t: "bullet", v: "•" }, ordered: false };
  }
}

/**
 * Build the engine paragraph patch from a partial {@link TextStyle}. Only the
 * paragraph-level fields PRESENT on `style` are emitted; returns `null` when the
 * patch carries no paragraph-level field (so the caller skips the paragraph op).
 */
export function buildParagraphPatch(
  style: Partial<TextStyle>,
): ParagraphStylePatch | null {
  const patch: ParagraphStylePatch = {};
  let hasField = false;

  if (style.textAlign != null) {
    patch.align = style.textAlign;
    hasField = true;
  }
  if (typeof style.indentLeft === "number" && Number.isFinite(style.indentLeft)) {
    // Never negative — the toolbar clamps, but guard the bake too.
    patch.indent_left = Math.max(0, style.indentLeft);
    hasField = true;
  }
  if (typeof style.lineHeight === "number" && Number.isFinite(style.lineHeight)) {
    // Editor line spacing is a unitless multiple (Word's 1.0/1.15/1.5/…).
    patch.line_height = { t: "multiple", v: style.lineHeight };
    hasField = true;
  }

  return hasField ? patch : null;
}

/**
 * Build the list-level edits for a `source_index` from a list patch VALUE.
 *
 * `list` is the new value of `TextStyle.list` in the patch:
 *   - a {@link TextListStyle}  → emit `marker` + `ordered` (from its `type`) and
 *     `level` (its nesting depth), so the list block's family + depth bake.
 *   - `undefined`/`null`       → a list REMOVAL, which has no structural op
 *     (`setList*` only mutate an existing list block). Returns `[]` so the
 *     caller keeps the toggle on the flat decoration path.
 *
 * Returns the edits keyed by `sourceIndex` (empty when nothing to bake).
 */
export function buildListEdits(
  sourceIndex: number,
  list: TextListStyle | null | undefined,
): ListEdit[] {
  if (!list) return [];
  const { marker, ordered } = listTypeToMarker(list.type);
  const level = Math.max(0, Math.trunc(list.level ?? 0));
  return [
    { sourceIndex, kind: "marker", marker },
    { sourceIndex, kind: "ordered", ordered },
    { sourceIndex, kind: "level", level },
  ];
}

/** Whether `key` is a paragraph-level {@link TextStyle} field (bakes natively). */
function isParagraphKey(key: string): key is (typeof PARAGRAPH_STYLE_KEYS)[number] {
  return (PARAGRAPH_STYLE_KEYS as readonly string[]).includes(key);
}

/**
 * The result of classifying a {@link TextStyle} patch for the native bake:
 *   - `paragraphPatch`: paragraph-level fields to bake (or `null`)
 *   - `hasList`: whether the patch touches the `list` field
 *   - `listValue`: the new `list` value when `hasList` (for {@link buildListEdits})
 *   - `flat`: the leftover character-level fields that must stay on the flat
 *     redact+add path (bold/italic/colour/size/…), or `null` when none.
 * `bakeable` is true when there is anything to bake structurally.
 */
export interface SplitTextStylePatch {
  paragraphPatch: ParagraphStylePatch | null;
  hasList: boolean;
  listValue: TextListStyle | null | undefined;
  flat: Partial<TextStyle> | null;
  bakeable: boolean;
}

/**
 * Split a {@link TextStyle} patch into its native-bakeable paragraph/list parts
 * and the residual flat (character-level) part. Drives the editor's routing:
 * paragraph + list parts go to the structural bake; the flat part falls back to
 * the existing redact+add path (used as the fallback when the element is not
 * model-addressable, or for the character-level fields a single patch mixes in).
 */
export function splitTextStylePatch(
  style: Partial<TextStyle>,
): SplitTextStylePatch {
  const paragraphPatch = buildParagraphPatch(style);
  const hasList = Object.prototype.hasOwnProperty.call(style, "list");
  const listValue = hasList ? style.list : undefined;

  const flat: Partial<TextStyle> = {};
  let hasFlat = false;
  for (const [key, value] of Object.entries(style)) {
    if (isParagraphKey(key) || key === "list") continue;
    (flat as Record<string, unknown>)[key] = value;
    hasFlat = true;
  }

  // A list-removal toggle (`list: undefined`) is NOT structurally bakeable, so
  // it does not count toward `bakeable`; only a present list value does.
  const bakeable = paragraphPatch !== null || (hasList && listValue != null);

  return {
    paragraphPatch,
    hasList,
    listValue,
    flat: hasFlat ? flat : null,
    bakeable,
  };
}
