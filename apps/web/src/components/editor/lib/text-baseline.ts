/**
 * text-baseline.ts
 *
 * SINGLE source of truth for the vertical anchoring of editable text overlays on
 * the (text-free) PDF raster. The overlay renderer (`render-elements.ts`) and its
 * inverse on save (`fabric-element-io.ts`) MUST use the exact same constant, or
 * the round-trip (place → save → reload) drifts by a fraction of `fontSize` on
 * every cycle. Before this module the constant lived as a bare `0.22` copied in
 * both files — a latent drift hazard. It now lives here once.
 *
 * GEOMETRY (proven numerically against `gigapdf-lib` `renderPage` ground truth)
 * --------------------------------------------------------------------------
 * The parser hands the editor `bounds.{x,y}` at the TOP-LEFT of the glyph bbox
 * and `bounds.height = fontSize` (see `pdf-engine` text-extractor). Measuring the
 * rendered PNG shows the real glyph baseline sits at
 *
 *     baseline_canvas ≈ bounds.y + ASCENDER_RATIO · fontSize        (≈ 0.96·fs)
 *
 * i.e. `ASCENDER_RATIO` is the typographic ascender (cap/x-height top → baseline)
 * as a fraction of the em, ~0.96 for the Latin fonts these PDFs use.
 *
 * Fabric.js (v7) has no `originY:"alphabetic"`; the closest anchor is
 * `originY:"bottom"`, which pins the BOTTOM EDGE of the text line-box to `top`.
 * Fabric then draws the baseline ABOVE that edge by its own descent fraction
 * (~`FABRIC_DESCENT_RATIO · fontSize`). So to make Fabric's rendered baseline
 * land on the PDF baseline we set
 *
 *     top = bounds.y + fontSize + DESCENDER_OFFSET_RATIO · fontSize
 *
 * with `DESCENDER_OFFSET_RATIO` chosen so that
 * `top − FABRIC_DESCENT·fontSize ≈ bounds.y + ASCENDER_RATIO·fontSize`. The
 * value 0.22 was validated to land the baseline within ~0.5 px across the test
 * corpus (s1106 / s3705) at every measured size — keep it unless re-measured.
 *
 * The descent is a FONT metric (scales with `fontSize`, NOT with `lineHeight`),
 * so the offset is deliberately a plain `fontSize` fraction and is NOT scaled by
 * the run's line-height.
 */

/**
 * Extra drop, as a fraction of `fontSize`, added below `bounds.y + fontSize` so
 * that a Fabric `originY:"bottom"` text object's RENDERED baseline lands on the
 * PDF glyph baseline (it compensates Fabric's own descent). Empirically ~0.5 px
 * accurate on the test corpus. Single shared constant for the renderer and its
 * save-time inverse.
 */
export const DESCENDER_OFFSET_RATIO = 0.22;

/**
 * The `top` to give a Fabric text object created with `originY:"bottom"` so its
 * baseline lands on the PDF baseline, from the parsed top-left `boundsY` and the
 * run `fontSize`. Inverse of {@link boundsYFromBaselineTop}.
 */
export function baselineTopFromBoundsY(boundsY: number, fontSize: number): number {
  return boundsY + fontSize + fontSize * DESCENDER_OFFSET_RATIO;
}

/**
 * Recover the parsed top-left `bounds.y` from a Fabric text object's live `top`
 * (created with `originY:"bottom"`). Inverse of {@link baselineTopFromBoundsY}.
 * For `originY:"top"` text there is no baseline offset, so `top` already is the
 * glyph top — pass `originYBottom=false`.
 */
export function boundsYFromBaselineTop(
  top: number,
  fontSize: number,
  originYBottom: boolean,
): number {
  const descenderOffset = originYBottom ? fontSize * DESCENDER_OFFSET_RATIO : 0;
  return top - descenderOffset - fontSize;
}
