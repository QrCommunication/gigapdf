/**
 * ruler-margins.test.ts
 *
 * Pure geometry for the shared Word-like margin overlay (rulers + on-sheet
 * guides). These conversions are the single source of truth both surfaces use,
 * so a round-trip here guarantees the ruler handles and the page guides agree.
 */

import { describe, it, expect } from "vitest";
import {
  clamp,
  screenMarginsToPx,
  marginsToGuidePx,
  guidePxToMargins,
  applyGuideDrag,
  type MarginGuidePx,
} from "../ruler-margins";
import type { PageMargins } from "../page-margins";

// Distinct per-side values so any wrong mapping is caught.
const M: PageMargins = { top: 50, right: 40, bottom: 60, left: 30 };
const W = 600;
const H = 800;

describe("clamp", () => {
  it("bounds a value into [min, max]", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("screenMarginsToPx", () => {
  it("maps each side to its line position within the sheet", () => {
    expect(screenMarginsToPx(M, 1, W, H)).toEqual({
      top: 50, // top margin grows downward
      bottom: H - 60, // 740
      left: 30,
      right: W - 40, // 560
    });
  });

  it("scales by zoom", () => {
    expect(screenMarginsToPx(M, 2, W, H)).toEqual({
      top: 100,
      bottom: H - 120, // 680
      left: 60,
      right: W - 80, // 520
    });
  });

  it("treats a non-positive zoom as 1 (no divide-by-zero)", () => {
    expect(screenMarginsToPx(M, 0, W, H)).toEqual(screenMarginsToPx(M, 1, W, H));
  });
});

describe("marginsToGuidePx ↔ guidePxToMargins round-trip", () => {
  for (const rotation of [0, 90, 180, 270]) {
    it(`is lossless at ${rotation}° (zoom 1)`, () => {
      const px = marginsToGuidePx(M, rotation, 1, W, H);
      expect(guidePxToMargins(px, rotation, 1, W, H)).toEqual(M);
    });

    it(`is lossless at ${rotation}° (zoom 1.5)`, () => {
      const px = marginsToGuidePx(M, rotation, 1.5, W, H);
      const back = guidePxToMargins(px, rotation, 1.5, W, H);
      expect(back.top).toBeCloseTo(M.top, 6);
      expect(back.right).toBeCloseTo(M.right, 6);
      expect(back.bottom).toBeCloseTo(M.bottom, 6);
      expect(back.left).toBeCloseTo(M.left, 6);
    });
  }

  it("permutes sides for a 90° page (intrinsic left shows on screen top)", () => {
    // At 90° CW, screenTop = pageLeft → the top guide sits at pageLeft·zoom.
    const px = marginsToGuidePx(M, 90, 1, W, H);
    expect(px.top).toBe(M.left); // 30
  });
});

describe("applyGuideDrag", () => {
  const PREV: MarginGuidePx = { top: 50, bottom: 740, left: 30, right: 560 };

  it("moves the left line and clamps it left of the right line", () => {
    expect(applyGuideDrag(PREV, "left", 100, W, H).left).toBe(100);
    // Cannot cross the right line (560).
    expect(applyGuideDrag(PREV, "left", 999, W, H).left).toBe(560);
    // Cannot go negative.
    expect(applyGuideDrag(PREV, "left", -20, W, H).left).toBe(0);
  });

  it("moves the right line and clamps it right of the left line", () => {
    expect(applyGuideDrag(PREV, "right", 400, W, H).right).toBe(400);
    expect(applyGuideDrag(PREV, "right", 10, W, H).right).toBe(30); // not past left
    expect(applyGuideDrag(PREV, "right", 9999, W, H).right).toBe(W); // not past sheet
  });

  it("moves the top/bottom lines with the same clamping", () => {
    expect(applyGuideDrag(PREV, "top", 200, W, H).top).toBe(200);
    expect(applyGuideDrag(PREV, "top", 9999, W, H).top).toBe(740); // not past bottom
    expect(applyGuideDrag(PREV, "bottom", 600, W, H).bottom).toBe(600);
    expect(applyGuideDrag(PREV, "bottom", 0, W, H).bottom).toBe(50); // not past top
  });

  it("only touches the dragged side", () => {
    const next = applyGuideDrag(PREV, "left", 100, W, H);
    expect(next.top).toBe(PREV.top);
    expect(next.bottom).toBe(PREV.bottom);
    expect(next.right).toBe(PREV.right);
  });
});

describe("drag → commit (ruler handle path, end to end)", () => {
  it("dragging the left ruler handle commits only a new left margin", () => {
    // Seed from committed margins (what the overlay does on mount).
    const seeded = marginsToGuidePx(M, 0, 1, W, H);
    // Drag the left handle to x=100px inside the sheet.
    const dragged = applyGuideDrag(seeded, "left", 100, W, H);
    // Commit (what onPointerEnd does).
    const committed = guidePxToMargins(dragged, 0, 1, W, H);
    expect(committed).toEqual({ top: 50, right: 40, bottom: 60, left: 100 });
  });
});
