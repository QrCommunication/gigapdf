import { describe, it, expect } from "vitest";
import {
  computeTicks,
  pxToUnit,
  unitToPx,
  type RulerUnit,
} from "../ruler-ticks";

describe("unitToPx / pxToUnit (dpi=72, zoom=1)", () => {
  it("treats 1pt as 1px at zoom 1, dpi 72", () => {
    expect(unitToPx(1, 1, "pt")).toBeCloseTo(1, 6);
    expect(pxToUnit(1, 1, "pt")).toBeCloseTo(1, 6);
  });

  it("converts inches: 1in = 72px", () => {
    expect(unitToPx(1, 1, "in")).toBeCloseTo(72, 6);
    expect(pxToUnit(72, 1, "in")).toBeCloseTo(1, 6);
  });

  it("converts cm: 1in = 2.54cm so 1cm ~= 28.346px", () => {
    expect(unitToPx(1, 1, "cm")).toBeCloseTo(72 / 2.54, 4);
    expect(pxToUnit(72, 1, "cm")).toBeCloseTo(2.54, 4);
  });

  it("converts mm: 1in = 25.4mm so 1mm ~= 2.835px", () => {
    expect(unitToPx(1, 1, "mm")).toBeCloseTo(72 / 25.4, 4);
    expect(pxToUnit(72, 1, "mm")).toBeCloseTo(25.4, 4);
  });

  it("treats px as identity at dpi=72", () => {
    expect(unitToPx(50, 1, "px")).toBeCloseTo(50, 6);
    expect(pxToUnit(50, 1, "px")).toBeCloseTo(50, 6);
  });

  it("scales with zoom", () => {
    expect(unitToPx(1, 2, "in")).toBeCloseTo(144, 6);
    expect(pxToUnit(144, 2, "in")).toBeCloseTo(1, 6);
  });

  it("round-trips px -> unit -> px for every unit", () => {
    const units: RulerUnit[] = ["px", "mm", "cm", "in", "pt"];
    for (const unit of units) {
      const back = unitToPx(pxToUnit(123.4, 1.5, unit), 1.5, unit);
      expect(back).toBeCloseTo(123.4, 4);
    }
  });

  it("respects a non-default dpi (96)", () => {
    // At dpi 96, 1in = 96px.
    expect(unitToPx(1, 1, "in", 96)).toBeCloseTo(96, 6);
    expect(pxToUnit(96, 1, "in", 96)).toBeCloseTo(1, 6);
    // 1px = 1 device pixel at dpi 96 too.
    expect(unitToPx(10, 1, "px", 96)).toBeCloseTo(10, 6);
  });

  it("returns 0 for zero pixels", () => {
    expect(pxToUnit(0, 1, "mm")).toBe(0);
  });
});

describe("computeTicks", () => {
  it("returns no ticks for non-positive length", () => {
    expect(computeTicks(0, 1, "mm")).toEqual([]);
    expect(computeTicks(-50, 1, "mm")).toEqual([]);
  });

  it("starts at 0 and the first tick is major", () => {
    const ticks = computeTicks(72, 1, "in");
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[0]?.posPx).toBe(0);
    expect(ticks[0]?.major).toBe(true);
    expect(ticks[0]?.label).toBe("0");
  });

  it("labels major ticks every 10mm and leaves minor ticks unlabelled", () => {
    // 1 inch = 25.4mm -> minor ticks every 1mm, majors at 0,10,20mm.
    const ticks = computeTicks(72, 1, "mm");
    const majors = ticks.filter((t) => t.major);
    expect(majors.map((t) => t.label)).toEqual(["0", "10", "20"]);
    // a minor tick (e.g. 1mm) has no label
    const minor = ticks.find((t) => !t.major);
    expect(minor?.label).toBeUndefined();
  });

  it("spaces major ticks one inch apart in pixels (in unit)", () => {
    const ticks = computeTicks(216, 1, "in"); // 3 inches
    const majors = ticks.filter((t) => t.major);
    expect(majors.map((t) => t.label)).toEqual(["0", "1", "2", "3"]);
    expect(majors[1]?.posPx).toBeCloseTo(72, 6);
    expect(majors[2]?.posPx).toBeCloseTo(144, 6);
    expect(majors[3]?.posPx).toBeCloseTo(216, 6);
  });

  it("scales tick positions with zoom", () => {
    const ticks = computeTicks(72, 2, "in"); // 1 inch ruler, zoom 2
    const majors = ticks.filter((t) => t.major);
    // 0in at 0px, 1in at 144px (72 * zoom 2)
    expect(majors[0]?.posPx).toBe(0);
    expect(majors[1]?.posPx).toBeCloseTo(144, 6);
  });

  it("produces fractional labels for inch eighths", () => {
    const ticks = computeTicks(72, 1, "in");
    // minor step is 1/8 in -> first minor at 0.125in
    const firstMinor = ticks[1];
    expect(firstMinor?.major).toBe(false);
    expect(firstMinor?.posPx).toBeCloseTo(9, 6); // 0.125in * 72px
  });

  it("includes the final tick at the ruler end (no float drift drop)", () => {
    // 2 inches exactly: last major label should be '2'.
    const ticks = computeTicks(144, 1, "in");
    const majors = ticks.filter((t) => t.major);
    expect(majors[majors.length - 1]?.label).toBe("2");
  });

  it("supports the px unit (major every 100px)", () => {
    const ticks = computeTicks(72, 1, "px"); // 72pt = 72px at dpi72/zoom1
    const majors = ticks.filter((t) => t.major);
    // ruler is 72px long: only the 0px major fits (next major at 100px is past end)
    expect(majors.map((t) => t.label)).toEqual(["0"]);
    // minor ticks every 10px: 0,10,20,30,40,50,60,70 -> 8 ticks
    expect(ticks).toHaveLength(8);
  });
});
