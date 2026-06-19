import { describe, it, expect } from "vitest";
import type {
  Element,
  ImageElement,
  PageObject,
  TextElement,
  TextStyle,
} from "@giga-pdf/types";
import {
  findOccurrences,
  replaceOccurrence,
  replaceAllInDocument,
  isTextElement,
  clonePastedElement,
  clonePastedElements,
  extractPaintableStyle,
  applyPaintableStyle,
  newElementId,
  PASTE_OFFSET,
} from "../edit-tools";

// ---- fixtures -------------------------------------------------------------

const baseStyle: TextStyle = {
  fontFamily: "Helvetica",
  fontSize: 12,
  fontWeight: "normal",
  fontStyle: "normal",
  color: "#000000",
  opacity: 1,
  textAlign: "left",
  lineHeight: 1.2,
  letterSpacing: 0,
  writingMode: "horizontal-tb",
  underline: false,
  strikethrough: false,
  backgroundColor: null,
  verticalAlign: "baseline",
  originalFont: null,
};

function text(
  id: string,
  content: string,
  style: Partial<TextStyle> = {},
  index?: number,
): TextElement {
  return {
    elementId: id,
    type: "text",
    bounds: { x: 10, y: 20, width: 100, height: 14 },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    content,
    style: { ...baseStyle, ...style },
    ocrConfidence: null,
    linkUrl: null,
    linkPage: null,
    ...(index !== undefined ? { index } : {}),
  };
}

function image(id: string): ImageElement {
  return {
    elementId: id,
    type: "image",
    bounds: { x: 5, y: 5, width: 50, height: 50 },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    source: {
      type: "embedded",
      dataUrl: "data:image/png;base64,AAAA",
      originalFormat: "png",
      originalDimensions: { width: 50, height: 50 },
    },
    style: { opacity: 1, blendMode: "normal" },
    crop: null,
  };
}

function page(pageNumber: number, elements: Element[]): PageObject {
  return {
    pageId: `page-${pageNumber}`,
    pageNumber,
    dimensions: { width: 595, height: 842, rotation: 0 },
    mediaBox: { x: 0, y: 0, width: 595, height: 842 },
    cropBox: null,
    elements,
    preview: { thumbnailUrl: null, fullUrl: null },
  } as PageObject;
}

// ---- isTextElement --------------------------------------------------------

describe("isTextElement", () => {
  it("narrows text elements and rejects others", () => {
    expect(isTextElement(text("a", "hi"))).toBe(true);
    expect(isTextElement(image("b"))).toBe(false);
  });
});

// ---- findOccurrences ------------------------------------------------------

describe("findOccurrences", () => {
  it("returns empty for an empty needle", () => {
    const pages = [page(1, [text("a", "hello world")])];
    expect(findOccurrences(pages, "")).toEqual([]);
  });

  it("finds matches case-insensitively by default", () => {
    const pages = [page(1, [text("a", "Hello HELLO hello")])];
    const hits = findOccurrences(pages, "hello");
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.start)).toEqual([0, 6, 12]);
  });

  it("respects caseSensitive", () => {
    const pages = [page(1, [text("a", "Hello HELLO hello")])];
    const hits = findOccurrences(pages, "hello", { caseSensitive: true });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.start).toBe(12);
  });

  it("respects wholeWord", () => {
    const pages = [page(1, [text("a", "cat category cat.")])];
    const hits = findOccurrences(pages, "cat", { wholeWord: true });
    // matches "cat " (0) and "cat." (13) but NOT "category"
    expect(hits.map((h) => h.start)).toEqual([0, 13]);
  });

  it("walks pages then element order with correct page numbers", () => {
    const pages = [
      page(1, [text("a", "alpha"), text("b", "beta alpha")]),
      page(2, [text("c", "alpha gamma")]),
    ];
    const hits = findOccurrences(pages, "alpha");
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.elementId)).toEqual(["a", "b", "c"]);
    expect(hits.map((h) => h.pageNumber)).toEqual([1, 1, 2]);
    expect(hits.map((h) => h.pageIndex)).toEqual([0, 0, 1]);
  });

  it("ignores non-text elements", () => {
    const pages = [page(1, [image("img"), text("a", "foo")])];
    const hits = findOccurrences(pages, "foo");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.elementId).toBe("a");
  });

  it("treats regex-special needles literally", () => {
    const pages = [page(1, [text("a", "a.b a.b axb")])];
    const hits = findOccurrences(pages, "a.b");
    expect(hits).toHaveLength(2);
  });
});

// ---- replaceOccurrence ----------------------------------------------------

describe("replaceOccurrence", () => {
  it("replaces only the targeted instance", () => {
    const pages = [page(1, [text("a", "foo foo foo")])];
    const second = findOccurrences(pages, "foo")[1]!;
    const result = replaceOccurrence(second, "foo", "bar");
    expect(result).toBe("foo bar foo");
  });

  it("returns null when the live content no longer matches", () => {
    const stale = {
      pageIndex: 0,
      pageNumber: 1,
      elementId: "a",
      content: "changed text here",
      start: 0,
      end: 3,
    };
    expect(replaceOccurrence(stale, "foo", "bar")).toBeNull();
  });

  it("preserves case-sensitive correctness", () => {
    const occ = {
      pageIndex: 0,
      pageNumber: 1,
      elementId: "a",
      content: "Foo",
      start: 0,
      end: 3,
    };
    expect(replaceOccurrence(occ, "Foo", "X", { caseSensitive: true })).toBe(
      "X",
    );
    expect(replaceOccurrence(occ, "foo", "X", { caseSensitive: true })).toBeNull();
  });
});

// ---- replaceAllInDocument -------------------------------------------------

describe("replaceAllInDocument", () => {
  it("returns empty for an empty needle", () => {
    const pages = [page(1, [text("a", "foo")])];
    expect(replaceAllInDocument(pages, "", "bar")).toEqual([]);
  });

  it("replaces every match per element and counts them", () => {
    const pages = [
      page(1, [text("a", "foo foo"), text("b", "no match")]),
      page(2, [text("c", "FOO end")]),
    ];
    const out = replaceAllInDocument(pages, "foo", "X");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ elementId: "a", content: "X X", count: 2 });
    expect(out[1]).toMatchObject({
      elementId: "c",
      content: "X end",
      count: 1,
      pageNumber: 2,
    });
  });

  it("does not re-scan inserted replacement text (self-similar)", () => {
    const pages = [page(1, [text("a", "aa")])];
    const out = replaceAllInDocument(pages, "a", "aa");
    expect(out[0]?.content).toBe("aaaa");
    expect(out[0]?.count).toBe(2);
  });

  it("respects wholeWord without dropping unmatched text", () => {
    const pages = [page(1, [text("a", "cat category")])];
    const out = replaceAllInDocument(pages, "cat", "dog", { wholeWord: true });
    expect(out[0]?.content).toBe("dog category");
    expect(out[0]?.count).toBe(1);
  });
});

// ---- newElementId ---------------------------------------------------------

describe("newElementId", () => {
  it("produces unique non-empty ids", () => {
    const a = newElementId();
    const b = newElementId();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

// ---- clonePastedElement ---------------------------------------------------

describe("clonePastedElement", () => {
  it("assigns a fresh id and offsets bounds by the default offset", () => {
    const src = text("a", "hi");
    const clone = clonePastedElement(src);
    expect(clone.elementId).not.toBe("a");
    expect(clone.bounds.x).toBe(10 + PASTE_OFFSET);
    expect(clone.bounds.y).toBe(20 + PASTE_OFFSET);
    // source untouched
    expect(src.bounds.x).toBe(10);
  });

  it("strips the engine index so paste goes through redact+add", () => {
    const src = text("a", "hi", {}, 7);
    expect((src as { index?: number }).index).toBe(7);
    const clone = clonePastedElement(src);
    expect((clone as { index?: number }).index).toBeUndefined();
  });

  it("deep-clones nested style so edits do not leak back", () => {
    const src = text("a", "hi", { color: "#ff0000" });
    const clone = clonePastedElement(src) as TextElement;
    clone.style.color = "#00ff00";
    expect(src.style.color).toBe("#ff0000");
  });

  it("clamps offset bounds to a non-negative origin", () => {
    const src = text("a", "hi");
    src.bounds.x = -100;
    src.bounds.y = -100;
    const clone = clonePastedElement(src, 12);
    expect(clone.bounds.x).toBe(0);
    expect(clone.bounds.y).toBe(0);
  });

  it("clonePastedElements offsets each item", () => {
    const out = clonePastedElements([text("a", "x"), text("b", "y")], 5);
    expect(out).toHaveLength(2);
    expect(out[0]?.bounds.x).toBe(15);
    expect(out[1]?.bounds.x).toBe(15);
    expect(out[0]?.elementId).not.toBe(out[1]?.elementId);
  });
});

// ---- format painter -------------------------------------------------------

describe("extractPaintableStyle / applyPaintableStyle", () => {
  it("extracts only paintable fields from text", () => {
    const src = text("a", "hi", {
      fontFamily: "Times",
      fontSize: 18,
      fontWeight: "bold",
      color: "#123456",
      underline: true,
    });
    const paint = extractPaintableStyle(src)!;
    expect(paint).toEqual({
      fontFamily: "Times",
      fontSize: 18,
      fontWeight: "bold",
      fontStyle: "normal",
      color: "#123456",
      textAlign: "left",
      lineHeight: 1.2,
      underline: true,
      strikethrough: false,
    });
    // does not leak non-paintable fields
    expect("opacity" in paint).toBe(false);
    expect("letterSpacing" in paint).toBe(false);
  });

  it("returns null for non-text elements", () => {
    expect(extractPaintableStyle(image("b"))).toBeNull();
  });

  it("applies paintable style while preserving non-paintable target fields", () => {
    const target = text("t", "x", {
      fontFamily: "Courier",
      letterSpacing: 3,
      originalFont: "EmbeddedXYZ",
      opacity: 0.5,
    });
    const paint = extractPaintableStyle(
      text("s", "y", { fontFamily: "Times", fontSize: 24, fontWeight: "bold" }),
    )!;
    const merged = applyPaintableStyle(target, paint)!;
    // painted
    expect(merged.fontFamily).toBe("Times");
    expect(merged.fontSize).toBe(24);
    expect(merged.fontWeight).toBe("bold");
    // preserved
    expect(merged.letterSpacing).toBe(3);
    expect(merged.originalFont).toBe("EmbeddedXYZ");
    expect(merged.opacity).toBe(0.5);
  });

  it("returns null when target is not text", () => {
    const paint = extractPaintableStyle(text("s", "y"))!;
    expect(applyPaintableStyle(image("img"), paint)).toBeNull();
  });
});
