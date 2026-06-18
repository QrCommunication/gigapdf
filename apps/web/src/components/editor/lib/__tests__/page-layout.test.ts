import { describe, it, expect } from "vitest";
import {
  PAGE_GAP_PX,
  PAGE_V_PADDING_PX,
  effectivePagePoints,
  computePageLayout,
  pageIndexAtScroll,
  type PageLayoutInput,
} from "../page-layout";

function page(
  width: number,
  height: number,
  rotation: 0 | 90 | 180 | 270 = 0
): PageLayoutInput {
  return { dimensions: { width, height, rotation } };
}

describe("effectivePagePoints", () => {
  it("returns dimensions as-is for rotation 0", () => {
    expect(effectivePagePoints(page(612, 792, 0))).toEqual({ w: 612, h: 792 });
  });

  it("returns dimensions as-is for rotation 180", () => {
    expect(effectivePagePoints(page(612, 792, 180))).toEqual({ w: 612, h: 792 });
  });

  it("swaps width/height for rotation 90", () => {
    expect(effectivePagePoints(page(612, 792, 90))).toEqual({ w: 792, h: 612 });
  });

  it("swaps width/height for rotation 270", () => {
    expect(effectivePagePoints(page(612, 792, 270))).toEqual({ w: 792, h: 612 });
  });
});

describe("computePageLayout", () => {
  it("returns padding-only height for no pages", () => {
    const layout = computePageLayout([], 1);
    expect(layout.slots).toEqual([]);
    expect(layout.contentWidth).toBe(0);
    expect(layout.totalHeight).toBe(PAGE_V_PADDING_PX * 2);
  });

  it("places a single page at the top padding", () => {
    const layout = computePageLayout([page(612, 792)], 1);
    expect(layout.slots).toHaveLength(1);
    expect(layout.slots[0]).toEqual({
      top: PAGE_V_PADDING_PX,
      width: 612,
      height: 792,
    });
    expect(layout.contentWidth).toBe(612);
    // single page: top padding + page + bottom padding (no gap)
    expect(layout.totalHeight).toBe(PAGE_V_PADDING_PX + 792 + PAGE_V_PADDING_PX);
  });

  it("stacks pages with PAGE_GAP_PX between them", () => {
    const layout = computePageLayout([page(612, 792), page(612, 792)], 1);
    expect(layout.slots[0]?.top).toBe(PAGE_V_PADDING_PX);
    expect(layout.slots[1]?.top).toBe(PAGE_V_PADDING_PX + 792 + PAGE_GAP_PX);
    expect(layout.totalHeight).toBe(
      PAGE_V_PADDING_PX + 792 + PAGE_GAP_PX + 792 + PAGE_V_PADDING_PX
    );
  });

  it("scales page sizes by zoom", () => {
    const layout = computePageLayout([page(100, 200)], 2);
    expect(layout.slots[0]).toEqual({
      top: PAGE_V_PADDING_PX,
      width: 200,
      height: 400,
    });
  });

  it("falls back to zoom 1 for non-positive zoom", () => {
    const layout = computePageLayout([page(100, 200)], 0);
    expect(layout.slots[0]?.height).toBe(200);
  });

  it("applies rotation when sizing slots", () => {
    const layout = computePageLayout([page(612, 792, 90)], 1);
    expect(layout.slots[0]?.width).toBe(792);
    expect(layout.slots[0]?.height).toBe(612);
  });

  it("reports the widest page as contentWidth", () => {
    const layout = computePageLayout([page(300, 400), page(500, 400)], 1);
    expect(layout.contentWidth).toBe(500);
  });
});

describe("pageIndexAtScroll", () => {
  const layout = computePageLayout(
    [page(600, 800), page(600, 800), page(600, 800), page(600, 800)],
    1
  );
  const slots = layout.slots;

  it("returns 0 for an empty layout", () => {
    expect(pageIndexAtScroll([], 0)).toBe(0);
    expect(pageIndexAtScroll([], 9999, 500)).toBe(0);
  });

  it("returns the first page at scrollTop 0", () => {
    expect(pageIndexAtScroll(slots, 0)).toBe(0);
  });

  it("selects the page whose centre is nearest the viewport centre", () => {
    // Page 0 centre is at PAGE_V_PADDING_PX + 400. Scroll so the viewport
    // centre sits on page 1's centre.
    const page1Centre = slots[1]!.top + slots[1]!.height / 2;
    const viewportH = 500;
    const scrollTop = page1Centre - viewportH / 2;
    expect(pageIndexAtScroll(slots, scrollTop, viewportH)).toBe(1);
  });

  it("returns the last page when scrolled to the bottom", () => {
    const last = slots.length - 1;
    const lastCentre = slots[last]!.top + slots[last]!.height / 2;
    expect(pageIndexAtScroll(slots, lastCentre)).toBe(last);
  });

  it("uses scrollTop directly when viewportH is omitted (default 0)", () => {
    // Without a viewport, the comparison point is scrollTop itself. A scrollTop
    // landing exactly on page 2's centre selects page 2.
    const page2Centre = slots[2]!.top + slots[2]!.height / 2;
    expect(pageIndexAtScroll(slots, page2Centre)).toBe(2);
  });

  it("is monotonic: increasing scroll never decreases the index", () => {
    let prev = -1;
    for (let s = 0; s <= layout.totalHeight; s += 50) {
      const idx = pageIndexAtScroll(slots, s, 400);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });
});
