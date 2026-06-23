import { describe, it, expect } from "vitest";
import type { PageObject, TextElement, Element } from "@giga-pdf/types";
import { detectPii, matchesToRects } from "../pii-detection";

function textEl(content: string, id = "t1"): TextElement {
  return {
    elementId: id,
    type: "text",
    bounds: { x: 10, y: 20, width: 200, height: 12 },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    content,
    style: {} as TextElement["style"],
    ocrConfidence: null,
    linkUrl: null,
    linkPage: null,
  };
}

function page(elements: Element[], pageNumber = 1): PageObject {
  return {
    pageId: `p${pageNumber}`,
    pageNumber,
    dimensions: { width: 612, height: 792, rotation: 0 },
    mediaBox: { x: 0, y: 0, width: 612, height: 792 },
    cropBox: null,
    elements,
    preview: {} as PageObject["preview"],
  };
}

describe("detectPii", () => {
  it("detects an email address", () => {
    const matches = detectPii([page([textEl("Contact: john.doe@example.com please")])]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.kind).toBe("email");
    expect(matches[0]!.pageNumber).toBe(1);
  });

  it("detects a phone number with separators", () => {
    const matches = detectPii([page([textEl("Tel +33 6 12 34 56 78")])]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.kind).toBe("phone");
  });

  it("detects an IBAN", () => {
    const matches = detectPii([page([textEl("IBAN FR7630006000011234567890189 end")])]);
    expect(matches.some((m) => m.kind === "iban")).toBe(true);
  });

  it("ignores short numbers (no false phone on a price)", () => {
    const matches = detectPii([page([textEl("Total 12,50 EUR")])]);
    expect(matches).toHaveLength(0);
  });

  it("ignores plain prose without PII", () => {
    const matches = detectPii([page([textEl("The quick brown fox jumps over the lazy dog")])]);
    expect(matches).toHaveLength(0);
  });

  it("collapses multiple hits in one run to a single region", () => {
    const matches = detectPii([page([textEl("a@b.com and c@d.com")])]);
    expect(matches).toHaveLength(1);
  });

  it("skips non-text elements", () => {
    const img = {
      elementId: "i1",
      type: "image",
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
      layerId: null,
      locked: false,
      visible: true,
    } as unknown as Element;
    expect(detectPii([page([img])])).toHaveLength(0);
  });

  it("scans across multiple pages", () => {
    const matches = detectPii([
      page([textEl("x@y.com")], 1),
      page([textEl("z@w.com")], 2),
    ]);
    expect(matches.map((m) => m.pageNumber)).toEqual([1, 2]);
  });

  it("matchesToRects carries page number and bounds", () => {
    const matches = detectPii([page([textEl("a@b.com")])]);
    const rects = matchesToRects(matches);
    expect(rects).toEqual([{ x: 10, y: 20, width: 200, height: 12, pageNumber: 1 }]);
  });
});
