/**
 * Pure ruler tick computation for the Word-like editor rulers.
 *
 * Given a ruler length (in PDF points), a zoom factor, a display unit and a
 * device DPI, produces evenly-spaced tick marks positioned in CSS pixels, with
 * labels on the "major" ticks. Also exposes px <-> unit conversions.
 *
 * Coordinate model:
 *   - PDF points: 1pt = 1/72 inch (the document's intrinsic unit).
 *   - 1 inch = `dpi` px at zoom 1 (default dpi = 72, so 1pt -> 1px at zoom 1).
 *   - Pixels scale linearly with `zoom`.
 *
 * No DOM, no React — trivially unit-testable.
 */

export type RulerUnit = "px" | "mm" | "cm" | "in" | "pt";

export interface RulerTick {
  /** Position along the ruler, in CSS pixels at the given zoom. */
  posPx: number;
  /** Label shown on major ticks (the unit value). Absent on minor ticks. */
  label?: string;
  /** Whether this is a major (labelled) tick. */
  major: boolean;
}

/** Points per inch — the PDF intrinsic unit definition. */
const POINTS_PER_INCH = 72;

/** Millimetres per inch. */
const MM_PER_INCH = 25.4;

/** How many of a given unit fit in one inch. */
function unitsPerInch(unit: RulerUnit, dpi: number): number {
  switch (unit) {
    case "in":
      return 1;
    case "cm":
      return MM_PER_INCH / 10; // 2.54 cm per inch
    case "mm":
      return MM_PER_INCH; // 25.4 mm per inch
    case "pt":
      return POINTS_PER_INCH; // 72 pt per inch
    case "px":
      return dpi; // dpi px per inch
    default:
      return 1;
  }
}

/**
 * Tick layout for a unit: how many unit-steps between minor ticks and how many
 * minor ticks make up a major (labelled) tick. Tuned so rulers stay readable.
 */
function tickSpec(unit: RulerUnit): { minorStep: number; majorEvery: number } {
  switch (unit) {
    case "mm":
      // minor every 1mm, major (labelled) every 10mm (1cm).
      return { minorStep: 1, majorEvery: 10 };
    case "cm":
      // minor every 0.5cm, major every 1cm (2 minors).
      return { minorStep: 0.5, majorEvery: 2 };
    case "in":
      // minor every 1/8 in, major every 1 in (8 minors).
      return { minorStep: 0.125, majorEvery: 8 };
    case "pt":
      // minor every 12pt, major every 72pt (1in) -> 6 minors.
      return { minorStep: 12, majorEvery: 6 };
    case "px":
      // minor every 10px, major every 100px (10 minors).
      return { minorStep: 10, majorEvery: 10 };
    default:
      return { minorStep: 1, majorEvery: 10 };
  }
}

/** Pixels-per-unit at the given zoom/dpi. */
function pxPerUnit(zoom: number, unit: RulerUnit, dpi: number): number {
  const scale = zoom > 0 ? zoom : 1;
  // px per inch (at zoom 1) = dpi; px per unit = (px per inch) / (units per inch).
  return (dpi * scale) / unitsPerInch(unit, dpi);
}

/** Convert a pixel offset (at the given zoom) to its value in `unit`. */
export function pxToUnit(
  px: number,
  zoom: number,
  unit: RulerUnit,
  dpi = 72
): number {
  const perUnit = pxPerUnit(zoom, unit, dpi);
  return perUnit !== 0 ? px / perUnit : 0;
}

/** Convert a value expressed in `unit` to a pixel offset (at the given zoom). */
export function unitToPx(
  value: number,
  zoom: number,
  unit: RulerUnit,
  dpi = 72
): number {
  return value * pxPerUnit(zoom, unit, dpi);
}

/**
 * Format a unit value for a tick label. Whole numbers render without decimals;
 * fractional units (cm half-steps, inch eighths) keep up to 2 decimals trimmed.
 */
function formatLabel(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return parseFloat(value.toFixed(2)).toString();
}

/**
 * Compute the ruler ticks for a length of `lengthPts` PDF points.
 *
 * Ticks start at unit 0 and step by the unit's minor step until the pixel
 * position exceeds the ruler length. Every `majorEvery`-th minor tick is a
 * labelled major tick.
 */
export function computeTicks(
  lengthPts: number,
  zoom: number,
  unit: RulerUnit,
  dpi = 72
): RulerTick[] {
  const ticks: RulerTick[] = [];
  if (lengthPts <= 0) {
    return ticks;
  }

  // Ruler length expressed in `unit`.
  const lengthInUnits = (lengthPts / POINTS_PER_INCH) * unitsPerInch(unit, dpi);
  const { minorStep, majorEvery } = tickSpec(unit);
  if (minorStep <= 0) {
    return ticks;
  }

  const perUnit = pxPerUnit(zoom, unit, dpi);
  // +epsilon guards against floating-point drift dropping the final tick.
  const maxUnits = lengthInUnits + minorStep * 1e-6;

  let step = 0;
  for (let value = 0; value <= maxUnits; value += minorStep, step += 1) {
    const major = step % majorEvery === 0;
    const tick: RulerTick = {
      posPx: value * perUnit,
      major,
    };
    if (major) {
      tick.label = formatLabel(value);
    }
    ticks.push(tick);
  }

  return ticks;
}
