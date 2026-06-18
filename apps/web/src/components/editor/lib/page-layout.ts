/**
 * Pure page-layout geometry for the Word-like continuous editor view.
 *
 * Computes, for a list of pages and a zoom factor, the vertical slot of each
 * page in the scrolling document (top offset + rendered size) and helpers to
 * map a scroll position back to the page index in focus. Rotation-aware: a
 * 90/270 rotated page swaps width and height.
 *
 * All inputs/outputs are in CSS pixels at the given zoom. Page dimensions are
 * PDF points (1pt = 1/72in); zoom 1 means 1pt -> 1px.
 *
 * No DOM, no React — trivially unit-testable.
 */

import type { PageObject } from "@giga-pdf/types";

/** Vertical gap between consecutive pages, in CSS pixels (zoom-independent). */
export const PAGE_GAP_PX = 24;

/** Top/bottom padding of the document scroll area, in CSS pixels. */
export const PAGE_V_PADDING_PX = 16;

/**
 * Minimal page shape this module needs. The real {@link PageObject} satisfies
 * it, but tests (and other callers) can pass a bare object.
 */
export interface PageLayoutInput {
  dimensions: { width: number; height: number; rotation: 0 | 90 | 180 | 270 };
}

/** Vertical slot of a single page in the document, in CSS pixels. */
export interface PageSlot {
  /** Top offset of the page from the top of the scroll content. */
  top: number;
  /** Rendered page height. */
  height: number;
  /** Rendered page width. */
  width: number;
}

export interface PageLayout {
  /** One slot per input page, in order. */
  slots: PageSlot[];
  /** Total scroll-content height (last slot bottom + bottom padding). */
  totalHeight: number;
  /** Width of the widest rendered page (for centring / horizontal sizing). */
  contentWidth: number;
}

/**
 * Effective page size in points, swapping width/height for 90/270 rotations.
 * `PageObject` provides `dimensions` (post-... raw page box); we apply the
 * rotation flag here so a landscape-rotated portrait page lays out landscape.
 */
export function effectivePagePoints(p: PageLayoutInput): { w: number; h: number } {
  const { width, height, rotation } = p.dimensions;
  const swap = rotation === 90 || rotation === 270;
  return {
    w: swap ? height : width,
    h: swap ? width : height,
  };
}

/**
 * Compute the stacked vertical layout of every page.
 *
 * Pages are laid out top-to-bottom: first slot starts at `PAGE_V_PADDING_PX`,
 * each subsequent slot is `PAGE_GAP_PX` below the previous one.
 */
export function computePageLayout(
  pages: readonly PageLayoutInput[],
  zoom: number
): PageLayout {
  const scale = zoom > 0 ? zoom : 1;
  const slots: PageSlot[] = [];
  let cursor = PAGE_V_PADDING_PX;
  let contentWidth = 0;

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    if (!page) {
      continue;
    }
    const { w, h } = effectivePagePoints(page);
    const width = w * scale;
    const height = h * scale;
    slots.push({ top: cursor, height, width });
    if (width > contentWidth) {
      contentWidth = width;
    }
    cursor += height + PAGE_GAP_PX;
  }

  // `cursor` overshot by one PAGE_GAP_PX after the last page; replace that gap
  // with the bottom padding. When there are no pages, fall back to symmetric
  // padding so the scroll area is never negative.
  const totalHeight =
    slots.length > 0
      ? cursor - PAGE_GAP_PX + PAGE_V_PADDING_PX
      : PAGE_V_PADDING_PX * 2;

  return { slots, totalHeight, contentWidth };
}

/**
 * Index of the page whose centre is nearest the centre of the viewport.
 *
 * Binary search over slot centres (slots are sorted by `top`). Returns 0 for an
 * empty layout. `viewportH` defaults to 0, in which case the comparison point
 * is simply `scrollTop`.
 */
export function pageIndexAtScroll(
  slots: readonly PageSlot[],
  scrollTop: number,
  viewportH = 0
): number {
  if (slots.length === 0) {
    return 0;
  }
  const target = scrollTop + viewportH / 2;

  const centreOf = (slot: PageSlot): number => slot.top + slot.height / 2;

  let lo = 0;
  let hi = slots.length - 1;
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const slot = slots[mid];
    // `slot` is always defined here (mid within bounds) but
    // noUncheckedIndexedAccess widens the type — guard for the compiler.
    if (!slot) {
      break;
    }
    const centre = centreOf(slot);
    const dist = Math.abs(centre - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = mid;
    }
    if (centre === target) {
      return mid;
    }
    if (centre < target) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

// Re-export the canonical page type so callers can pass real pages directly.
export type { PageObject };
