/**
 * margin-rotation.ts
 *
 * Pure side-permutation between a page's intrinsic (un-rotated) margins and the
 * margins as they appear on the *displayed* (rotated) page sheet.
 *
 * The GigaPDF engine reports/accepts margins (`{top,right,bottom,left}`) on the
 * page's own, un-rotated box. The editor renders the page with its `/Rotate`
 * applied (clockwise), so a 90/180/270° page shows those sides on different
 * physical edges. The draggable margin guides work in *screen* space, so we map
 * page→screen for display and screen→page on commit.
 *
 * Convention: `/Rotate` is applied CLOCKWISE at render time (matches the PDF
 * spec and the renderer / `effectivePagePoints`, which swaps width/height for
 * 90/270).
 *
 * Mapping (which PAGE side appears on each SCREEN edge), CW rotation:
 *   - 0°   : screen = page (identity)
 *   - 90°  : screenTop=pageLeft, screenRight=pageTop, screenBottom=pageRight, screenLeft=pageBottom
 *   - 180° : screenTop=pageBottom, screenRight=pageLeft, screenBottom=pageTop, screenLeft=pageRight
 *   - 270° : screenTop=pageRight, screenRight=pageBottom, screenBottom=pageLeft, screenLeft=pageTop
 *
 * No DOM, no React — trivially unit-testable.
 */

import type { PageMargins } from "./page-margins";

/** Page rotation flag, in degrees (PDF `/Rotate`). */
export type PageRotation = 0 | 90 | 180 | 270;

/** Normalise an arbitrary rotation to one of 0/90/180/270 (CW, positive). */
export function normalizeRotation(rotation: number): PageRotation {
  const r = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  return r as PageRotation;
}

/**
 * Map a page's intrinsic margins to how they appear on the displayed (rotated)
 * sheet. Identity at 0°.
 */
export function screenMarginsFromPage(
  m: PageMargins,
  rotation: number,
): PageMargins {
  switch (normalizeRotation(rotation)) {
    case 90:
      return { top: m.left, right: m.top, bottom: m.right, left: m.bottom };
    case 180:
      return { top: m.bottom, right: m.left, bottom: m.top, left: m.right };
    case 270:
      return { top: m.right, right: m.bottom, bottom: m.left, left: m.top };
    case 0:
    default:
      return { top: m.top, right: m.right, bottom: m.bottom, left: m.left };
  }
}

/**
 * Inverse of {@link screenMarginsFromPage}: map screen-space margins (from the
 * displayed sheet) back to the page's intrinsic margins for the engine.
 */
export function pageMarginsFromScreen(
  s: PageMargins,
  rotation: number,
): PageMargins {
  switch (normalizeRotation(rotation)) {
    case 90:
      // Inverse of the 90° permutation above.
      return { top: s.right, right: s.bottom, bottom: s.left, left: s.top };
    case 180:
      return { top: s.bottom, right: s.left, bottom: s.top, left: s.right };
    case 270:
      return { top: s.left, right: s.top, bottom: s.right, left: s.bottom };
    case 0:
    default:
      return { top: s.top, right: s.right, bottom: s.bottom, left: s.left };
  }
}
