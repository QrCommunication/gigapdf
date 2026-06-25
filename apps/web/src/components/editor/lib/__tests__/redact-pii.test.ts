import { describe, it, expect, vi } from "vitest";
import {
  webRectToPdf,
  groupRectsByPage,
  redactDocument,
  type PageGeometry,
  type Rect,
  type RectsByPage,
  type WebRedactionRect,
} from "../redact-pii";

const PAGE: PageGeometry = { width: 612, height: 792 };

describe("webRectToPdf", () => {
  describe("rotation = 0 (default): top-left Y-down -> bottom-left Y-up", () => {
    it("converts a rect at the top-left corner", () => {
      // web y=0 is the top; PDF y = 792 - 0 - 50 = 742 (bottom edge, Y-up).
      expect(webRectToPdf({ x: 0, y: 0, width: 100, height: 50 }, PAGE)).toEqual({
        x: 0,
        y: 742,
        width: 100,
        height: 50,
      });
    });

    it("preserves x, width and height; flips y by height - y - h", () => {
      const r = webRectToPdf({ x: 30, y: 200, width: 150, height: 60 }, PAGE);
      expect(r.x).toBe(30);
      expect(r.width).toBe(150);
      expect(r.height).toBe(60);
      expect(r.y).toBe(792 - 200 - 60); // 532
    });
  });

  it("rotation = 90 flips against the displayed height", () => {
    const geo: PageGeometry = { width: 792, height: 612, rotation: 90 };
    expect(webRectToPdf({ x: 10, y: 20, width: 40, height: 30 }, geo)).toEqual({
      x: 10,
      y: 612 - 20 - 30, // 562
      width: 40,
      height: 30,
    });
  });

  it("rotation = 270 flips against the displayed height (same axis as 90)", () => {
    const geo: PageGeometry = { width: 792, height: 612, rotation: 270 };
    expect(webRectToPdf({ x: 5, y: 100, width: 20, height: 10 }, geo)).toEqual({
      x: 5,
      y: 612 - 100 - 10, // 502
      width: 20,
      height: 10,
    });
  });

  it("rotation = 180 flips both axes about the displayed page box", () => {
    const geo: PageGeometry = { width: 612, height: 792, rotation: 180 };
    expect(webRectToPdf({ x: 100, y: 50, width: 80, height: 40 }, geo)).toEqual({
      x: 612 - 100 - 80, // 432
      y: 50,
      width: 80,
      height: 40,
    });
  });
});

describe("groupRectsByPage", () => {
  const geometries = new Map<number, PageGeometry>([
    [1, PAGE],
    [2, { width: 612, height: 792 }],
  ]);

  it("buckets converted rects by 1-based page number", () => {
    const rects: WebRedactionRect[] = [
      { pageNumber: 1, x: 0, y: 0, width: 100, height: 50 },
      { pageNumber: 2, x: 10, y: 10, width: 20, height: 20 },
      { pageNumber: 1, x: 5, y: 5, width: 30, height: 30 },
    ];
    const byPage = groupRectsByPage(rects, geometries);
    expect(byPage.get(1)).toHaveLength(2);
    expect(byPage.get(2)).toHaveLength(1);
    // Converted to PDF user-space (Y flipped).
    expect(byPage.get(1)?.[0]).toEqual({ x: 0, y: 742, width: 100, height: 50 });
    expect(byPage.get(2)?.[0]).toEqual({ x: 10, y: 762, width: 20, height: 20 });
  });

  it("drops rects whose page has no geometry", () => {
    const rects: WebRedactionRect[] = [
      { pageNumber: 9, x: 0, y: 0, width: 100, height: 50 },
    ];
    expect(groupRectsByPage(rects, geometries).size).toBe(0);
  });

  it("drops degenerate (non-positive) rects so a stray click never redacts", () => {
    const rects: WebRedactionRect[] = [
      { pageNumber: 1, x: 0, y: 0, width: 0, height: 50 },
      { pageNumber: 1, x: 0, y: 0, width: 100, height: -1 },
    ];
    expect(groupRectsByPage(rects, geometries).size).toBe(0);
  });
});

/**
 * Minimal fake `GigaPdfDoc` capturing the redaction calls the helper makes.
 * Only the methods exercised here are implemented.
 */
function makeFakeDoc(opts: { saved?: Uint8Array; deletedPerCall?: number } = {}) {
  const calls = {
    redactPii: [] as { page: number; rects: Rect[]; opts?: unknown }[],
    closed: 0,
  };
  const doc = {
    redactPii: (
      page: number,
      rects: Rect[],
      o?: { cover?: boolean; coverRgb?: number },
    ): number => {
      calls.redactPii.push({ page, rects, opts: o });
      return opts.deletedPerCall ?? rects.length;
    },
    saveCompressed: (): Uint8Array => opts.saved ?? new Uint8Array([1, 2, 3]),
    close: () => {
      calls.closed += 1;
    },
  };
  return { doc, calls };
}

/** Build a fake engine loader returning a one-doc engine. */
function fakeLoader(doc: ReturnType<typeof makeFakeDoc>["doc"]) {
  const open = vi.fn(() => doc);
  return Object.assign(async () => ({ open }) as never, { open });
}

const BYTES = new Uint8Array([9, 9, 9]);

describe("redactDocument", () => {
  it("calls redactPii once per page with the page's rects + opaque cover", async () => {
    const { doc, calls } = makeFakeDoc({});
    const byPage: RectsByPage = new Map([
      [1, [{ x: 0, y: 742, width: 100, height: 50 }]],
      [3, [{ x: 1, y: 2, width: 3, height: 4 }]],
    ]);
    await redactDocument(BYTES, byPage, fakeLoader(doc));
    expect(calls.redactPii).toHaveLength(2);
    expect(calls.redactPii[0]).toEqual({
      page: 1,
      rects: [{ x: 0, y: 742, width: 100, height: 50 }],
      opts: { cover: true },
    });
    expect(calls.redactPii[1]?.page).toBe(3);
  });

  it("sums the deleted-element counts across pages", async () => {
    const { doc } = makeFakeDoc({ deletedPerCall: 5 });
    const byPage: RectsByPage = new Map([
      [1, [{ x: 0, y: 0, width: 1, height: 1 }]],
      [2, [{ x: 0, y: 0, width: 1, height: 1 }]],
    ]);
    const { deleted } = await redactDocument(BYTES, byPage, fakeLoader(doc));
    expect(deleted).toBe(10);
  });

  it("skips pages with an empty rect list", async () => {
    const { doc, calls } = makeFakeDoc({});
    const byPage: RectsByPage = new Map([
      [1, []],
      [2, [{ x: 0, y: 0, width: 1, height: 1 }]],
    ]);
    await redactDocument(BYTES, byPage, fakeLoader(doc));
    expect(calls.redactPii.map((c) => c.page)).toEqual([2]);
  });

  it("returns a fresh ArrayBuffer-backed copy of the saved bytes", async () => {
    const saved = new Uint8Array([4, 5, 6]);
    const { doc } = makeFakeDoc({ saved });
    const { bytes } = await redactDocument(
      BYTES,
      new Map([[1, [{ x: 0, y: 0, width: 1, height: 1 }]]]),
      fakeLoader(doc),
    );
    expect(Array.from(bytes)).toEqual([4, 5, 6]);
    expect(bytes).not.toBe(saved);
    expect(bytes.buffer).toBeInstanceOf(ArrayBuffer);
  });

  it("closes the document on success", async () => {
    const { doc, calls } = makeFakeDoc({});
    await redactDocument(BYTES, new Map(), fakeLoader(doc));
    expect(calls.closed).toBe(1);
  });

  it("closes the document even when redactPii throws", async () => {
    const { doc, calls } = makeFakeDoc({});
    doc.redactPii = () => {
      throw new Error("boom");
    };
    await expect(
      redactDocument(
        BYTES,
        new Map([[1, [{ x: 0, y: 0, width: 1, height: 1 }]]]),
        fakeLoader(doc),
      ),
    ).rejects.toThrow(/boom/);
    expect(calls.closed).toBe(1);
  });
});
