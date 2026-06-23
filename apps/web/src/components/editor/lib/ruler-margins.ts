/**
 * ruler-margins.ts
 *
 * Pure geometry for the Word-like editor's draggable page margins, shared by the
 * two interactive surfaces that present them:
 *
 *   - the dashed guide lines drawn ON the page sheet (`page-margin-guides.tsx`);
 *   - the draggable handles + shaded margin bands drawn ON the rulers
 *     (`page-rulers.tsx`).
 *
 * Both surfaces are driven by ONE controller ({@link PageMarginOverlay}) so they
 * never diverge: the controller keeps the four margins in *screen* space as CSS
 * pixels (crisp dragging) and converts to/from PDF-point margins only at the
 * boundary. This module holds every px↔point / clamp computation so it can be
 * unit-tested without React or the DOM.
 *
 * Coordinate model
 * ────────────────
 *   - Margins are PDF points on the page's intrinsic (un-rotated) box.
 *   - The displayed sheet is `width × height` CSS px at the current `zoom`
 *     (1pt → 1px at zoom 1), so `px = pts × zoom` and `pts = px / zoom`.
 *   - SCREEN margins are the margins as they appear on the *displayed* (rotated)
 *     sheet; {@link screenMarginsFromPage}/{@link pageMarginsFromScreen} (in
 *     `margin-rotation.ts`) map between page-intrinsic and screen space.
 *
 * The handle/guide positions live in screen space because that is what the user
 * drags; rotation is folded in only when reading the committed margins in and
 * writing the dragged margins back out.
 */

import type { PageMargins } from "./page-margins";
import {
  screenMarginsFromPage,
  pageMarginsFromScreen,
} from "./margin-rotation";

/** Which side a margin handle/guide controls, on the displayed sheet. */
export type MarginSide = "top" | "right" | "bottom" | "left";

/**
 * Live pixel positions of the four margin lines within a `width × height` sheet.
 * `top`/`bottom`/`left`/`right` are the line offsets from the sheet's top-left
 * (so `top` grows downward and `bottom` is `height − bottomMargin·zoom`).
 */
export interface MarginGuidePx {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Clamp `v` into `[min, max]`. */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Screen-space margins (points) → guide line positions (px) on the sheet. */
export function screenMarginsToPx(
  screen: PageMargins,
  zoom: number,
  width: number,
  height: number,
): MarginGuidePx {
  const z = zoom > 0 ? zoom : 1;
  return {
    top: screen.top * z,
    bottom: height - screen.bottom * z,
    left: screen.left * z,
    right: width - screen.right * z,
  };
}

/**
 * Page-intrinsic margins (points) → guide line positions (px), going through
 * screen space for `rotation`. This is the value the overlay seeds the live
 * drag state with whenever the committed margins, zoom, geometry or rotation
 * change (and no drag is in progress).
 */
export function marginsToGuidePx(
  margins: PageMargins,
  rotation: number,
  zoom: number,
  width: number,
  height: number,
): MarginGuidePx {
  return screenMarginsToPx(
    screenMarginsFromPage(margins, rotation),
    zoom,
    width,
    height,
  );
}

/**
 * Inverse of {@link marginsToGuidePx}: live guide px positions → page-intrinsic
 * margins (points), clamped to a sane non-overlapping range and mapped back from
 * screen space for `rotation`. Used on commit.
 */
export function guidePxToMargins(
  g: MarginGuidePx,
  rotation: number,
  zoom: number,
  width: number,
  height: number,
): PageMargins {
  const z = zoom > 0 ? zoom : 1;
  const screen: PageMargins = {
    top: clamp(g.top, 0, height) / z,
    bottom: clamp(height - g.bottom, 0, height) / z,
    left: clamp(g.left, 0, width) / z,
    right: clamp(width - g.right, 0, width) / z,
  };
  return pageMarginsFromScreen(screen, rotation);
}

/**
 * Apply a drag of `side` to `clientPos` (the pointer's CSS px offset *inside* the
 * sheet, i.e. relative to the sheet's top-left), returning the next guide px
 * positions. Each side is clamped so it cannot cross its opposite line — the
 * left margin stays left of the right margin, etc. — keeping the band valid.
 */
export function applyGuideDrag(
  prev: MarginGuidePx,
  side: MarginSide,
  clientPos: number,
  width: number,
  height: number,
): MarginGuidePx {
  switch (side) {
    case "top":
      return { ...prev, top: clamp(clientPos, 0, prev.bottom) };
    case "bottom":
      return { ...prev, bottom: clamp(clientPos, prev.top, height) };
    case "left":
      return { ...prev, left: clamp(clientPos, 0, prev.right) };
    case "right":
      return { ...prev, right: clamp(clientPos, prev.left, width) };
    default:
      return prev;
  }
}
