/**
 * Chapter (heading) extraction from the engine's structural reconstruction.
 *
 * A PDF that ships no `/Outlines` still has visual structure: the native engine
 * `pageBlocks()` promotes large isolated lines to {@link GigaHeading} blocks and
 * (lib 0.99+) clusters their levels document-wide. This module distils those
 * page-level headings into a flat, navigable chapter list — the input both for
 * an on-screen table of contents and for baking real PDF bookmarks via
 * `setBookmarks`.
 *
 * Pure & engine-free: it takes already-reconstructed blocks, so it unit-tests
 * with synthetic {@link GigaBlock}s and never loads WASM.
 */

import type { GigaBlock, GigaInline } from '@qrcommunication/gigapdf-lib';

/**
 * One detected chapter — the exact `{ title, level, page }` shape the editor
 * consumes for navigation and that `setBookmarks` bakes (a `page` becomes a GoTo
 * destination). `level` is a normalised 0-based nesting depth (shallowest
 * heading → 0), so the hierarchy reads correctly whether the document's
 * headings start at H1 or H2.
 */
export interface DetectedChapter {
  title: string;
  /** Normalised nesting depth, 0 = top-level chapter. */
  level: number;
  /** 1-based destination page. */
  page: number;
}

/** A page's reconstructed blocks paired with its 1-based page number. */
export interface PageBlocks {
  page: number;
  blocks: readonly GigaBlock[];
}

/** Pathological documents could nominally hold thousands of headings; cap. */
const DEFAULT_MAX_CHAPTERS = 5000;

/** Heading levels are 1..=6 in the model; clamp anything out of band. */
const MIN_HEADING_LEVEL = 1;
const MAX_HEADING_LEVEL = 6;

/** Bookmark nesting is bounded by the engine writer (mirrors `links` route). */
const MAX_NEST_LEVEL = 32;

interface RawHeading {
  title: string;
  /** Raw model heading level (1..=6), pre-normalisation. */
  rawLevel: number;
  page: number;
}

/**
 * Flatten a paragraph's inline runs to plain text: concatenates `run` text,
 * turns a hard `br` into a space, and descends into `link` children. Inline
 * images carry no caption here and are skipped.
 */
function inlineRunsToText(runs: readonly GigaInline[]): string {
  let text = '';
  for (const inline of runs) {
    if (inline.t === 'run') {
      text += inline.v.text;
    } else if (inline.t === 'br') {
      text += ' ';
    } else if (inline.t === 'link') {
      text += inlineRunsToText(inline.children);
    }
    // 'image' inlines contribute no title text.
  }
  return text;
}

/** Collapse runs of whitespace and trim — a clean single-line bookmark label. */
function normaliseTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Clamp an untrusted numeric heading level into `[MIN, MAX]` (defaults to MIN). */
function clampHeadingLevel(level: number): number {
  if (!Number.isFinite(level)) return MIN_HEADING_LEVEL;
  return Math.min(Math.max(Math.trunc(level), MIN_HEADING_LEVEL), MAX_HEADING_LEVEL);
}

/**
 * Distil the heading blocks of a sequence of pages into a flat, navigable
 * {@link DetectedChapter}[] in reading order (page-ascending, then in-page
 * order). Only top-level `heading` blocks are considered — that is exactly what
 * the engine promotes from isolated display lines; descending into table cells
 * or list items would surface emphasised body text as false chapters.
 *
 * Levels are normalised so the shallowest detected heading becomes depth 0,
 * giving a sensible chapter/section hierarchy regardless of whether the source
 * used H1 or H2 as its top heading. Returns `[]` when no heading is found.
 */
export function extractChaptersFromPages(
  pages: ReadonlyArray<PageBlocks>,
  options: { maxChapters?: number } = {},
): DetectedChapter[] {
  const maxChapters = options.maxChapters ?? DEFAULT_MAX_CHAPTERS;

  const raw: RawHeading[] = [];
  for (const { page, blocks } of pages) {
    for (const block of blocks) {
      if (block.kind.t !== 'heading') continue;
      const title = normaliseTitle(inlineRunsToText(block.kind.v.para.runs));
      if (title.length === 0) continue;
      raw.push({ title, rawLevel: clampHeadingLevel(block.kind.v.level), page });
      if (raw.length >= maxChapters) break;
    }
    if (raw.length >= maxChapters) break;
  }

  if (raw.length === 0) return [];

  const minLevel = raw.reduce((min, h) => Math.min(min, h.rawLevel), MAX_HEADING_LEVEL);

  return raw.map((h) => ({
    title: h.title,
    level: Math.min(h.rawLevel - minLevel, MAX_NEST_LEVEL),
    page: h.page,
  }));
}
