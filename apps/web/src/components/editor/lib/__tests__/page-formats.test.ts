/**
 * page-formats.test.ts
 *
 * Pure coverage of the SL4 "Add page" format table: points per format ×
 * orientation, the custom fallback, and the `addPageParams` insertion helper.
 */
import { describe, it, expect } from "vitest";
import {
  PAGE_FORMAT_POINTS,
  STANDARD_PAGE_FORMATS,
  formatToPoints,
  addPageParams,
} from "../page-formats";

describe("formatToPoints", () => {
  it("returns canonical portrait points for each standard format", () => {
    expect(formatToPoints("a4", "portrait")).toEqual({ width: 595, height: 842 });
    expect(formatToPoints("a3", "portrait")).toEqual({
      width: 842,
      height: 1191,
    });
    expect(formatToPoints("letter", "portrait")).toEqual({
      width: 612,
      height: 792,
    });
    expect(formatToPoints("legal", "portrait")).toEqual({
      width: 612,
      height: 1008,
    });
  });

  it("swaps width/height for landscape", () => {
    expect(formatToPoints("a4", "landscape")).toEqual({
      width: 842,
      height: 595,
    });
    expect(formatToPoints("legal", "landscape")).toEqual({
      width: 1008,
      height: 612,
    });
  });

  it("uses the supplied dimensions for custom (and swaps in landscape)", () => {
    expect(formatToPoints("custom", "portrait", { width: 300, height: 500 }))
      .toEqual({ width: 300, height: 500 });
    expect(formatToPoints("custom", "landscape", { width: 300, height: 500 }))
      .toEqual({ width: 500, height: 300 });
  });

  it("falls back to A4 for custom without dimensions", () => {
    expect(formatToPoints("custom", "portrait")).toEqual(PAGE_FORMAT_POINTS.a4);
  });

  it("exposes the four standard formats in order", () => {
    expect(STANDARD_PAGE_FORMATS).toEqual(["a4", "a3", "letter", "legal"]);
  });
});

describe("addPageParams", () => {
  const ctx = { currentPageIndex: 2, pageCount: 5 };

  it("inserts after the active page index for position 'after'", () => {
    expect(addPageParams("a4", "portrait", "after", ctx)).toEqual({
      afterPage: 2,
      width: 595,
      height: 842,
    });
  });

  it("appends at the page count for position 'end'", () => {
    expect(addPageParams("a3", "landscape", "end", ctx)).toEqual({
      afterPage: 5,
      width: 1191,
      height: 842,
    });
  });

  it("carries custom dimensions through", () => {
    expect(
      addPageParams("custom", "portrait", "after", ctx, {
        width: 400,
        height: 600,
      }),
    ).toEqual({ afterPage: 2, width: 400, height: 600 });
  });
});
