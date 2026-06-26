/**
 * page-formats.ts
 *
 * Pure, framework-free table of paper formats × orientation, in PDF points
 * (1pt = 1/72in), for the editor's Word-like "Add page" picker (SL4). The
 * canonical sizes are stored PORTRAIT (width < height); `formatToPoints` swaps
 * width/height for landscape. A `custom` format carries caller-supplied
 * dimensions (falling back to A4 when omitted).
 *
 * The `/api/pdf/pages` "add" operation accepts `width?`/`height?` in points, so
 * these values feed straight through `runPageOperation('add', …)`.
 *
 * No DOM, no React — trivially unit-testable.
 */

/** A paper format the picker offers (`custom` = caller-supplied dimensions). */
export type PageFormat = "a4" | "a3" | "letter" | "legal" | "custom";

/** Page orientation: `portrait` keeps the canonical box, `landscape` swaps w/h. */
export type PageOrientation = "portrait" | "landscape";

/** Where a new page is inserted relative to the active page. */
export type AddPagePosition = "after" | "end";

/** A page size in PDF points. */
export interface PageFormatPoints {
  width: number;
  height: number;
}

/**
 * Canonical PORTRAIT sizes in PDF points. ISO A sizes are rounded to whole
 * points (A4 210×297mm → 595×842pt; A3 297×420mm → 842×1191pt); US sizes are
 * exact (Letter 8.5×11in → 612×792pt; Legal 8.5×14in → 612×1008pt).
 */
export const PAGE_FORMAT_POINTS: Record<
  Exclude<PageFormat, "custom">,
  PageFormatPoints
> = {
  a4: { width: 595, height: 842 },
  a3: { width: 842, height: 1191 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
};

/** The ordered list of standard (non-custom) formats, for building pickers. */
export const STANDARD_PAGE_FORMATS: readonly Exclude<PageFormat, "custom">[] = [
  "a4",
  "a3",
  "letter",
  "legal",
];

/**
 * Resolve a `format` × `orientation` to a size in PDF points. For `custom`,
 * `custom` supplies the portrait dimensions (defaults to A4 when omitted).
 * Landscape swaps width and height of the resolved portrait box.
 */
export function formatToPoints(
  format: PageFormat,
  orientation: PageOrientation,
  custom?: PageFormatPoints,
): PageFormatPoints {
  const base: PageFormatPoints =
    format === "custom"
      ? (custom ?? PAGE_FORMAT_POINTS.a4)
      : PAGE_FORMAT_POINTS[format];
  if (orientation === "landscape") {
    return { width: base.height, height: base.width };
  }
  return { width: base.width, height: base.height };
}

/** Context needed to compute an "add page" insertion point. */
export interface AddPageContext {
  /** 0-based index of the active page (used for "after current page"). */
  currentPageIndex: number;
  /** Current total number of pages (used for "at the end"). */
  pageCount: number;
}

/** The `runPageOperation('add', …)` params: insertion point + size in points. */
export interface AddPageParams extends PageFormatPoints {
  /**
   * 0-based "insert after" page index, as the `/api/pdf/pages` add op expects
   * (it converts to a 1-based insertion point internally). `after` → the active
   * page index; `end` → the page count (appended last).
   */
  afterPage: number;
}

/**
 * Build the `runPageOperation('add', …)` params for the picker selection. The
 * size comes from {@link formatToPoints}; `afterPage` mirrors the existing
 * blank-page insert ("after current" passes the active index) and the append
 * path ("at end" passes the page count).
 */
export function addPageParams(
  format: PageFormat,
  orientation: PageOrientation,
  position: AddPagePosition,
  ctx: AddPageContext,
  custom?: PageFormatPoints,
): AddPageParams {
  const { width, height } = formatToPoints(format, orientation, custom);
  const afterPage = position === "after" ? ctx.currentPageIndex : ctx.pageCount;
  return { afterPage, width, height };
}
