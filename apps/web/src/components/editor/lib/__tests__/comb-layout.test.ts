import { describe, it, expect } from "vitest";
import {
  computeCombLayout,
  clampCombValue,
  COMB_FONT_FAMILY,
} from "../comb-layout";

const ADVANCE_EM = 0.6;

describe("computeCombLayout — equal-cell geometry", () => {
  it("spaces glyphs so advance + charSpacing equals the cell width", () => {
    const fieldWidth = 200;
    const maxLen = 10;
    const layout = computeCombLayout(fieldWidth, 18, maxLen);
    const cellWidth = fieldWidth / maxLen;

    // advance(px) + spacing(px) should reconstruct the cell width (±1px rounding
    // from charSpacing being quantised to 1/1000 em).
    const advancePx = ADVANCE_EM * layout.fontSize;
    const spacingPx = (layout.charSpacing / 1000) * layout.fontSize;
    expect(advancePx + spacingPx).toBeCloseTo(cellWidth, 0);
  });

  it("uses a monospace family and a non-negative charSpacing", () => {
    const layout = computeCombLayout(150, 16, 15);
    expect(layout.fontFamily).toBe(COMB_FONT_FAMILY);
    expect(layout.charSpacing).toBeGreaterThanOrEqual(0);
    expect(layout.leftInset).toBeGreaterThanOrEqual(0);
  });

  it("never sizes a glyph wider than its cell", () => {
    // Narrow cells (many cells, small width) must shrink the font so the
    // monospace advance fits inside one cell.
    const fieldWidth = 90;
    const maxLen = 15; // cell = 6px
    const layout = computeCombLayout(fieldWidth, 40, maxLen);
    const cellWidth = fieldWidth / maxLen;
    const advancePx = ADVANCE_EM * layout.fontSize;
    expect(advancePx).toBeLessThanOrEqual(cellWidth + 0.001);
  });

  it("centres the first glyph in cell 0 (leftInset = half the slack)", () => {
    const fieldWidth = 200;
    const maxLen = 10;
    const layout = computeCombLayout(fieldWidth, 18, maxLen);
    const cellWidth = fieldWidth / maxLen;
    const advancePx = ADVANCE_EM * layout.fontSize;
    expect(layout.leftInset).toBeCloseTo((cellWidth - advancePx) / 2, 5);
  });

  it("honours a positive /DA size but still clamps it to the cell", () => {
    // Wide cells with a small /DA size → font follows daSize.
    const wide = computeCombLayout(400, 30, 10, 8); // cell = 40px, daSize 8
    expect(wide.fontSize).toBe(8);
    // Tiny cells with a big /DA size → clamped down to fit the cell.
    const tight = computeCombLayout(60, 30, 10, 40); // cell = 6px
    expect(tight.fontSize).toBeLessThan(40);
    expect(ADVANCE_EM * tight.fontSize).toBeLessThanOrEqual(6 + 0.001);
  });

  it("returns a neutral (no-spacing) layout for invalid input", () => {
    expect(computeCombLayout(0, 18, 10).charSpacing).toBe(0);
    expect(computeCombLayout(200, 18, 0).charSpacing).toBe(0);
    expect(computeCombLayout(200, 18, -3).charSpacing).toBe(0);
    expect(computeCombLayout(Number.NaN, 18, 10).charSpacing).toBe(0);
  });
});

describe("clampCombValue — value never exceeds the cell count", () => {
  it("truncates a value longer than maxLen", () => {
    expect(clampCombValue("1860512345678", 13)).toBe("1860512345678");
    expect(clampCombValue("18605123456789", 13)).toBe("1860512345678");
  });

  it("leaves a short or exact value untouched", () => {
    expect(clampCombValue("12345", 13)).toBe("12345");
    expect(clampCombValue("", 13)).toBe("");
  });

  it("is a no-op for a null / non-positive maxLen", () => {
    expect(clampCombValue("anything", null)).toBe("anything");
    expect(clampCombValue("anything", 0)).toBe("anything");
  });
});
