import { describe, it, expect } from "vitest";
import {
  normalizeRotation,
  screenMarginsFromPage,
  pageMarginsFromScreen,
  type PageRotation,
} from "../margin-rotation";
import type { PageMargins } from "../page-margins";

// Distinct per-side values so any wrong permutation is caught.
const M: PageMargins = { top: 10, right: 20, bottom: 30, left: 40 };

describe("normalizeRotation", () => {
  it("keeps the four canonical angles", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(270)).toBe(270);
  });

  it("wraps and snaps arbitrary values", () => {
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(89)).toBe(90); // snaps to nearest 90
  });
});

describe("screenMarginsFromPage", () => {
  it("is identity at 0°", () => {
    expect(screenMarginsFromPage(M, 0)).toEqual(M);
  });

  it("rotates sides clockwise at 90°", () => {
    // screenTop=pageLeft(40), screenRight=pageTop(10),
    // screenBottom=pageRight(20), screenLeft=pageBottom(30)
    expect(screenMarginsFromPage(M, 90)).toEqual({
      top: 40,
      right: 10,
      bottom: 20,
      left: 30,
    });
  });

  it("flips opposite sides at 180°", () => {
    expect(screenMarginsFromPage(M, 180)).toEqual({
      top: 30,
      right: 40,
      bottom: 10,
      left: 20,
    });
  });

  it("rotates sides at 270°", () => {
    // screenTop=pageRight(20), screenRight=pageBottom(30),
    // screenBottom=pageLeft(40), screenLeft=pageTop(10)
    expect(screenMarginsFromPage(M, 270)).toEqual({
      top: 20,
      right: 30,
      bottom: 40,
      left: 10,
    });
  });
});

describe("round-trip page → screen → page", () => {
  const rotations: PageRotation[] = [0, 90, 180, 270];
  for (const r of rotations) {
    it(`is the identity at ${r}°`, () => {
      const screen = screenMarginsFromPage(M, r);
      const back = pageMarginsFromScreen(screen, r);
      expect(back).toEqual(M);
    });
    it(`is the identity screen → page → screen at ${r}°`, () => {
      const page = pageMarginsFromScreen(M, r);
      const back = screenMarginsFromPage(page, r);
      expect(back).toEqual(M);
    });
  }
});
