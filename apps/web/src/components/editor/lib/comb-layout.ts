// ---------------------------------------------------------------------------
// Comb (PEIGNE) form-field layout — pure geometry, no Fabric/DOM dependency.
//
// A "comb" text field (`/Ff` bit 25, e.g. a CERFA SSN "1 8 6 0 5…" or a date in
// boxes) lays its value out ONE CHARACTER PER EQUALLY-SPACED CELL across
// `maxLen` cells spanning the field width. The cells can't be inferred from the
// value alone — only `maxLen` defines the original spacing — so the editable
// overlay must reproduce it explicitly.
//
// Approach: a MONOSPACE face (uniform advance) + a per-character spacing so that
// `advance + spacing === cellWidth`, with each glyph CENTRED in its cell.
// Fabric's `charSpacing` is expressed in 1/1000 em and is added after every
// glyph, so charSpacing(em) = cellWidth/fontSize - advanceEm.
// ---------------------------------------------------------------------------

/** Monospace family used for comb cells (uniform advance → equal cells). */
export const COMB_FONT_FAMILY = "Courier New, Courier, monospace";

/**
 * Mean advance width of the comb monospace face, in em. Courier glyphs advance
 * 600/1000 em; used to size the font to the cell and to centre each glyph.
 */
const COMB_ADVANCE_EM = 0.6;

export interface CombLayout {
  /** Font family to render the comb value with (monospace, equal cells). */
  fontFamily: string;
  /** Font size in px chosen to fit both the cell width and the field height. */
  fontSize: number;
  /** Fabric `charSpacing` in 1/1000 em so `advance + spacing === cellWidth`. */
  charSpacing: number;
  /** Horizontal inset (px) added to `bounds.x` so the first glyph is centred in cell 0. */
  leftInset: number;
}

/**
 * Compute the comb layout for a field box of `fieldWidth` × `fieldHeight` (px)
 * holding up to `maxLen` cells.
 *
 * `daSize` (the field's `/DA` size, 0 = auto) caps the font size when positive;
 * the size is otherwise driven by the cell width and the field height so a
 * monospace glyph fits inside a single cell without overflowing its neighbours.
 *
 * Guards: `maxLen <= 0` or non-finite/zero `fieldWidth` yields a benign neutral
 * layout (no spacing) so the caller can fall back to plain text rendering.
 */
export function computeCombLayout(
  fieldWidth: number,
  fieldHeight: number,
  maxLen: number,
  daSize = 0,
): CombLayout {
  const neutral: CombLayout = {
    fontFamily: COMB_FONT_FAMILY,
    fontSize: 12,
    charSpacing: 0,
    leftInset: 0,
  };
  if (
    !Number.isFinite(fieldWidth) ||
    !Number.isFinite(fieldHeight) ||
    fieldWidth <= 0 ||
    !Number.isInteger(maxLen) ||
    maxLen <= 0
  ) {
    return neutral;
  }

  const cellWidth = fieldWidth / maxLen;

  // Font size: fit the field height (centred vertically by the caller) but never
  // let a monospace glyph be wider than its cell. Honour `/DA` when it sets an
  // explicit (non-auto) size, still clamped so the glyph stays inside its cell.
  const fitByHeight = Math.max(6, fieldHeight * 0.7);
  const fitByCell = cellWidth / COMB_ADVANCE_EM;
  const requested = daSize > 0 ? daSize : fitByHeight;
  const fontSize = Math.max(6, Math.min(requested, fitByCell, fitByHeight));

  // charSpacing so that advance(px) + spacing(px) === cellWidth.
  //   spacingEm = cellWidth/fontSize - advanceEm ; charSpacing = spacingEm * 1000
  const charSpacing = Math.max(
    0,
    Math.round((cellWidth / fontSize - COMB_ADVANCE_EM) * 1000),
  );

  // Centre the glyph inside cell 0: half of the slack (cell - glyph advance).
  const advancePx = COMB_ADVANCE_EM * fontSize;
  const leftInset = Math.max(0, (cellWidth - advancePx) / 2);

  return { fontFamily: COMB_FONT_FAMILY, fontSize, charSpacing, leftInset };
}

/**
 * Clamp a typed value to the comb cell count so it can never exceed the boxes
 * the field provides. `maxLen <= 0` leaves the value untouched.
 */
export function clampCombValue(value: string, maxLen: number | null): string {
  if (maxLen === null || !Number.isInteger(maxLen) || maxLen <= 0) {
    return value;
  }
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}
