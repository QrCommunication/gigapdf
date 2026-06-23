import { describe, it, expect } from "vitest";
import type { TextStyle } from "@giga-pdf/types";
import {
  listTypeToMarker,
  buildParagraphPatch,
  buildListEdits,
  splitTextStylePatch,
} from "../paragraph-style-bake";

// Pure mapping editor `Partial<TextStyle>` → engine model-op edits. No WASM /
// React. Guards the "which fields bake natively, and how they map" contract the
// editor page relies on to route paragraph/list formatting to applyModelOps.

describe("listTypeToMarker", () => {
  it("maps bullet → unordered bullet marker", () => {
    expect(listTypeToMarker("bullet")).toEqual({
      marker: { t: "bullet", v: "•" },
      ordered: false,
    });
  });

  it("maps number → ordered decimal", () => {
    expect(listTypeToMarker("number")).toEqual({
      marker: { t: "decimal" },
      ordered: true,
    });
  });

  it("maps lettered → ordered lower_alpha and roman → ordered lower_roman", () => {
    expect(listTypeToMarker("lettered")).toEqual({
      marker: { t: "lower_alpha" },
      ordered: true,
    });
    expect(listTypeToMarker("roman")).toEqual({
      marker: { t: "lower_roman" },
      ordered: true,
    });
  });
});

describe("buildParagraphPatch", () => {
  it("maps textAlign → align", () => {
    expect(buildParagraphPatch({ textAlign: "center" })).toEqual({
      align: "center",
    });
  });

  it("maps indentLeft → indent_left and clamps negatives to 0", () => {
    expect(buildParagraphPatch({ indentLeft: 18 })).toEqual({
      indent_left: 18,
    });
    expect(buildParagraphPatch({ indentLeft: -5 })).toEqual({
      indent_left: 0,
    });
  });

  it("maps lineHeight → line_height multiple", () => {
    expect(buildParagraphPatch({ lineHeight: 1.5 })).toEqual({
      line_height: { t: "multiple", v: 1.5 },
    });
  });

  it("merges multiple paragraph fields in one patch", () => {
    expect(
      buildParagraphPatch({ textAlign: "justify", indentLeft: 36, lineHeight: 2 }),
    ).toEqual({
      align: "justify",
      indent_left: 36,
      line_height: { t: "multiple", v: 2 },
    });
  });

  it("returns null when no paragraph-level field is present", () => {
    expect(buildParagraphPatch({ fontWeight: "bold" })).toBeNull();
    expect(buildParagraphPatch({})).toBeNull();
    // `list` is not a paragraph-level field of the patch (handled separately).
    expect(buildParagraphPatch({ list: { type: "bullet", level: 0 } })).toBeNull();
  });

  it("ignores non-finite numeric fields", () => {
    expect(buildParagraphPatch({ indentLeft: Number.NaN })).toBeNull();
    expect(buildParagraphPatch({ lineHeight: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe("buildListEdits", () => {
  it("emits marker + ordered + level for a present list value", () => {
    expect(buildListEdits(7, { type: "number", level: 2 })).toEqual([
      { sourceIndex: 7, kind: "marker", marker: { t: "decimal" } },
      { sourceIndex: 7, kind: "ordered", ordered: true },
      { sourceIndex: 7, kind: "level", level: 2 },
    ]);
  });

  it("clamps a negative / fractional level to a non-negative integer", () => {
    const edits = buildListEdits(3, { type: "bullet", level: -1 });
    expect(edits.find((e) => e.kind === "level")).toEqual({
      sourceIndex: 3,
      kind: "level",
      level: 0,
    });
  });

  it("returns [] for a list REMOVAL (no structural op exists)", () => {
    expect(buildListEdits(5, undefined)).toEqual([]);
    expect(buildListEdits(5, null)).toEqual([]);
  });
});

describe("splitTextStylePatch", () => {
  it("classifies a paragraph-only patch as bakeable with no flat residue", () => {
    const split = splitTextStylePatch({ textAlign: "right" });
    expect(split.bakeable).toBe(true);
    expect(split.paragraphPatch).toEqual({ align: "right" });
    expect(split.hasList).toBe(false);
    expect(split.flat).toBeNull();
  });

  it("classifies a list-set patch as bakeable", () => {
    const split = splitTextStylePatch({ list: { type: "roman", level: 1 } });
    expect(split.bakeable).toBe(true);
    expect(split.paragraphPatch).toBeNull();
    expect(split.hasList).toBe(true);
    expect(split.listValue).toEqual({ type: "roman", level: 1 });
    expect(split.flat).toBeNull();
  });

  it("treats a list REMOVAL toggle as NOT structurally bakeable", () => {
    const split = splitTextStylePatch({ list: undefined } as Partial<TextStyle>);
    expect(split.hasList).toBe(true);
    expect(split.listValue).toBeUndefined();
    expect(split.bakeable).toBe(false);
  });

  it("separates character-level fields into the flat residue", () => {
    const split = splitTextStylePatch({ fontWeight: "bold", color: "#ff0000" });
    expect(split.bakeable).toBe(false);
    expect(split.paragraphPatch).toBeNull();
    expect(split.flat).toEqual({ fontWeight: "bold", color: "#ff0000" });
  });

  it("splits a mixed patch (indent + list + char field) into all three buckets", () => {
    const split = splitTextStylePatch({
      indentLeft: 18,
      list: { type: "bullet", level: 1 },
      fontStyle: "italic",
    });
    expect(split.bakeable).toBe(true);
    expect(split.paragraphPatch).toEqual({ indent_left: 18 });
    expect(split.hasList).toBe(true);
    expect(split.listValue).toEqual({ type: "bullet", level: 1 });
    expect(split.flat).toEqual({ fontStyle: "italic" });
  });
});
