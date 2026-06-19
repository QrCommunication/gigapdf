/**
 * Pure helpers for the P7 editing toolset (find & replace, clipboard,
 * format painter). These functions operate on the plain scene-graph model
 * (`PageObject[]` / `Element`) and contain ZERO React, Zustand, Fabric or DOM
 * dependencies so they can be unit-tested in isolation.
 *
 * The caller (editor page) is responsible for threading the results back
 * through the existing bake flow (`handleElementUpdate` / `handleElementAdded`)
 * — these helpers never mutate state or touch the network.
 */

import type {
  Element,
  PageObject,
  TextElement,
  TextStyle,
  UUID,
} from "@giga-pdf/types";

// ============= Find & Replace =============

/** Options controlling how a needle matches against text-run content. */
export interface FindOptions {
  /** Match upper/lower case exactly. Default: false (case-insensitive). */
  caseSensitive?: boolean;
  /** Require the needle to be bounded by word boundaries. Default: false. */
  wholeWord?: boolean;
}

/** A single match of the needle inside one text element. */
export interface FindOccurrence {
  /** 0-based index of the page in the document. */
  pageIndex: number;
  /** 1-based page number (for display / engine APIs). */
  pageNumber: number;
  /** The id of the text element carrying the match. */
  elementId: UUID;
  /** The full current content of that element (pre-replacement). */
  content: string;
  /** Character offset of the match start within `content`. */
  start: number;
  /** Character offset of the match end (exclusive) within `content`. */
  end: number;
}

const WORD_BOUNDARY = /[\p{L}\p{N}_]/u;

function isWordBoundaryAt(
  text: string,
  index: number,
  direction: -1 | 1,
): boolean {
  const neighbour = text[index + (direction === -1 ? -1 : 0)];
  // No neighbour (start/end of string) is always a boundary.
  return neighbour === undefined || !WORD_BOUNDARY.test(neighbour);
}

/**
 * Whether an element is an editable text run (the only kind find & replace
 * operates on). Narrows the union so callers get a typed `TextElement`.
 */
export function isTextElement(element: Element): element is TextElement {
  return element.type === "text";
}

/**
 * Find every occurrence of `needle` across the text elements of every page,
 * in document order (page, then element order, then offset within content).
 *
 * Returns an empty array for an empty / whitespace-only needle so the caller
 * can short-circuit without special-casing.
 */
export function findOccurrences(
  pages: PageObject[],
  needle: string,
  options: FindOptions = {},
): FindOccurrence[] {
  if (needle.length === 0) return [];

  const { caseSensitive = false, wholeWord = false } = options;
  const occurrences: FindOccurrence[] = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    if (!page) continue;

    for (const element of page.elements) {
      if (!isTextElement(element)) continue;

      const content = element.content;
      const haystack = caseSensitive ? content : content.toLowerCase();
      const probe = caseSensitive ? needle : needle.toLowerCase();

      let from = 0;
      // Linear scan via indexOf — robust against regex-special characters in
      // the needle (a literal match, never a pattern).
      for (;;) {
        const start = haystack.indexOf(probe, from);
        if (start === -1) break;
        const end = start + probe.length;

        const boundedOk =
          !wholeWord ||
          (isWordBoundaryAt(content, start, -1) &&
            isWordBoundaryAt(content, end, 1));

        if (boundedOk) {
          occurrences.push({
            pageIndex,
            pageNumber: pageIndex + 1,
            elementId: element.elementId,
            content,
            start,
            end,
          });
        }

        // Advance past this match start (allows overlapping matches to surface
        // for non-whole-word searches; never an infinite loop since probe.length
        // >= 1 here — empty needles already returned above).
        from = start + 1;
      }
    }
  }

  return occurrences;
}

/**
 * Replace a single matched occurrence inside its element content, returning the
 * new full content string. The match position is taken from the occurrence so
 * the right instance is replaced even when the same needle appears several
 * times in one element.
 *
 * Returns `null` if the occurrence no longer matches the live content (e.g. the
 * element changed underneath) so the caller can skip it safely.
 */
export function replaceOccurrence(
  occurrence: FindOccurrence,
  needle: string,
  replacement: string,
  options: FindOptions = {},
): string | null {
  const { caseSensitive = false } = options;
  const slice = occurrence.content.slice(occurrence.start, occurrence.end);
  const matches = caseSensitive
    ? slice === needle
    : slice.toLowerCase() === needle.toLowerCase();
  if (!matches) return null;

  return (
    occurrence.content.slice(0, occurrence.start) +
    replacement +
    occurrence.content.slice(occurrence.end)
  );
}

/** The new content for an element after replacing ALL matches of `needle`. */
export interface ReplacedContent {
  elementId: UUID;
  pageIndex: number;
  pageNumber: number;
  content: string;
  /** Number of replacements made in this element. */
  count: number;
}

/**
 * Compute the "replace all" result for the whole document: one entry per text
 * element that contained at least one match, with its fully-replaced content.
 * The caller applies each via the normal element-update bake flow.
 *
 * Replacing left-to-right with a running cursor means an empty needle is a
 * no-op (guarded by findOccurrences) and overlapping/self-similar replacements
 * never re-scan the inserted text.
 */
export function replaceAllInDocument(
  pages: PageObject[],
  needle: string,
  replacement: string,
  options: FindOptions = {},
): ReplacedContent[] {
  if (needle.length === 0) return [];

  const { caseSensitive = false, wholeWord = false } = options;
  const results: ReplacedContent[] = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    if (!page) continue;

    for (const element of page.elements) {
      if (!isTextElement(element)) continue;

      const content = element.content;
      const haystack = caseSensitive ? content : content.toLowerCase();
      const probe = caseSensitive ? needle : needle.toLowerCase();

      let out = "";
      let cursor = 0;
      let count = 0;

      for (;;) {
        const start = haystack.indexOf(probe, cursor);
        if (start === -1) break;
        const end = start + probe.length;

        const boundedOk =
          !wholeWord ||
          (isWordBoundaryAt(content, start, -1) &&
            isWordBoundaryAt(content, end, 1));

        if (boundedOk) {
          out += content.slice(cursor, start) + replacement;
          cursor = end;
          count += 1;
        } else {
          // Keep the unmatched char and advance by one so we don't drop text.
          out += content.slice(cursor, start + 1);
          cursor = start + 1;
        }
      }

      if (count > 0) {
        out += content.slice(cursor);
        results.push({
          elementId: element.elementId,
          pageIndex,
          pageNumber: pageIndex + 1,
          content: out,
          count,
        });
      }
    }
  }

  return results;
}

// ============= Clipboard (copy / cut / paste) =============

/** Pixels added to x/y when pasting so the copy is visibly offset. */
export const PASTE_OFFSET = 12;

/**
 * Generate a fresh element id. Uses `crypto.randomUUID` when available
 * (browsers + Node 19+/jsdom) and falls back to a timestamped random string
 * in environments without it.
 */
export function newElementId(): UUID {
  const c =
    typeof globalThis !== "undefined"
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `el_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Clone an element for pasting: deep-copies it, assigns a fresh `elementId`,
 * offsets its bounds by `offset` px (clamped to a non-negative origin) and
 * strips the engine `index` (a paste is a brand-new element, never an in-place
 * edit of an existing PDF run, so it must go through the redact+add path).
 *
 * The returned element is unselected/unlocked-agnostic: the caller injects it
 * via `handleElementAdded` which auto-selects it.
 */
export function clonePastedElement(
  element: Element,
  offset: number = PASTE_OFFSET,
): Element {
  // Deep clone to fully detach from the source (nested style/source objects).
  const clone = JSON.parse(JSON.stringify(element)) as Element & {
    index?: number;
  };

  clone.elementId = newElementId();
  clone.bounds = {
    ...clone.bounds,
    x: Math.max(0, clone.bounds.x + offset),
    y: Math.max(0, clone.bounds.y + offset),
  };

  // A pasted copy is not an in-place edit of a parsed PDF run.
  if ("index" in clone) {
    delete clone.index;
  }

  return clone as Element;
}

/** Clone a whole clipboard buffer for a paste, each offset by `offset`. */
export function clonePastedElements(
  elements: Element[],
  offset: number = PASTE_OFFSET,
): Element[] {
  return elements.map((el) => clonePastedElement(el, offset));
}

// ============= Format Painter =============

/**
 * The subset of text style that the format painter copies between text
 * elements. Deliberately excludes positional/identity fields (bounds,
 * content, originalFont) so only presentation is transferred.
 */
export type PaintableTextStyle = Pick<
  TextStyle,
  | "fontFamily"
  | "fontSize"
  | "fontWeight"
  | "fontStyle"
  | "color"
  | "textAlign"
  | "lineHeight"
  | "underline"
  | "strikethrough"
>;

/**
 * Extract the paintable style from a text element, or `null` if the element is
 * not text (the format painter only operates on text).
 */
export function extractPaintableStyle(
  element: Element,
): PaintableTextStyle | null {
  if (!isTextElement(element)) return null;
  const s = element.style;
  return {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    fontStyle: s.fontStyle,
    color: s.color,
    textAlign: s.textAlign,
    lineHeight: s.lineHeight,
    underline: s.underline,
    strikethrough: s.strikethrough,
  };
}

/**
 * Merge a copied paintable style onto a target text element's existing style,
 * returning the FULL new `TextStyle`. Non-text targets return `null` so the
 * caller skips them. The merge keeps every non-paintable field of the target
 * (opacity, letterSpacing, originalFont, etc.) untouched.
 */
export function applyPaintableStyle(
  target: Element,
  paint: PaintableTextStyle,
): TextStyle | null {
  if (!isTextElement(target)) return null;
  // Spreading `paint` over the existing style overwrites exactly the paintable
  // fields (PaintableTextStyle is a strict subset of TextStyle) while keeping
  // every other field (opacity, letterSpacing, originalFont, …) untouched.
  return { ...target.style, ...paint };
}
