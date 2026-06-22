import { describe, it, expect } from "vitest";
import type { TextListStyle } from "@giga-pdf/types";
import {
  INDENT_STEP_PT,
  listMarkerGlyph,
  listMarkerPrefix,
  leftIndentOffset,
  composeDisplayText,
  stripDisplayText,
  shiftStylesForMarker,
  unshiftStylesForMarker,
} from "../list-format";
import type { FabricStylesMap } from "../text-runs";

/**
 * list-format.ts is the single source of truth for Word-like list + indent
 * rendering. The marker is a render-time DECORATION: it must compose into the
 * displayed text and strip back off LOSSLESSLY so the model `content` stays
 * clean and the lossless `replaceText` round-trip is preserved.
 */
describe("list-format", () => {
  describe("listMarkerGlyph", () => {
    it("cycles bullet glyphs by nesting level", () => {
      expect(listMarkerGlyph({ type: "bullet", level: 0 })).toBe("•");
      expect(listMarkerGlyph({ type: "bullet", level: 1 })).toBe("◦");
      expect(listMarkerGlyph({ type: "bullet", level: 2 })).toBe("▪");
      // Level 3 wraps back to the first glyph.
      expect(listMarkerGlyph({ type: "bullet", level: 3 })).toBe("•");
    });

    it("numbers ordered lists by 1-based ordinal", () => {
      expect(listMarkerGlyph({ type: "number", level: 0 }, 1)).toBe("1.");
      expect(listMarkerGlyph({ type: "number", level: 0 }, 2)).toBe("2.");
      expect(listMarkerGlyph({ type: "number", level: 0 }, 12)).toBe("12.");
    });

    it("letters ordered lists (a, b, …, z, aa)", () => {
      expect(listMarkerGlyph({ type: "lettered", level: 0 }, 1)).toBe("a.");
      expect(listMarkerGlyph({ type: "lettered", level: 0 }, 26)).toBe("z.");
      expect(listMarkerGlyph({ type: "lettered", level: 0 }, 27)).toBe("aa.");
    });

    it("roman-numbers ordered lists (i, ii, iv, ix)", () => {
      expect(listMarkerGlyph({ type: "roman", level: 0 }, 1)).toBe("i.");
      expect(listMarkerGlyph({ type: "roman", level: 0 }, 2)).toBe("ii.");
      expect(listMarkerGlyph({ type: "roman", level: 0 }, 4)).toBe("iv.");
      expect(listMarkerGlyph({ type: "roman", level: 0 }, 9)).toBe("ix.");
    });

    it("defaults a missing/invalid ordinal to 1 for ordered families", () => {
      expect(listMarkerGlyph({ type: "number", level: 0 }, 0)).toBe("1.");
      expect(listMarkerGlyph({ type: "number", level: 0 }, -5)).toBe("1.");
    });
  });

  describe("leftIndentOffset", () => {
    it("is 0 for a plain paragraph (no list, no indent)", () => {
      expect(leftIndentOffset({})).toBe(0);
    });

    it("adds explicit indentLeft verbatim", () => {
      expect(leftIndentOffset({ indentLeft: 24 })).toBe(24);
    });

    it("reserves one step per list level (level 0 ⇒ one step)", () => {
      expect(leftIndentOffset({ list: { type: "bullet", level: 0 } })).toBe(
        INDENT_STEP_PT,
      );
      expect(leftIndentOffset({ list: { type: "bullet", level: 2 } })).toBe(
        INDENT_STEP_PT * 3,
      );
    });

    it("combines explicit indent and list gutter", () => {
      expect(
        leftIndentOffset({
          indentLeft: 10,
          list: { type: "number", level: 1 },
        }),
      ).toBe(10 + INDENT_STEP_PT * 2);
    });

    it("clamps a negative indentLeft to 0", () => {
      expect(leftIndentOffset({ indentLeft: -50 })).toBe(0);
    });
  });

  describe("composeDisplayText / stripDisplayText round-trip", () => {
    it("returns content unchanged when not a list", () => {
      const { display, prefixLen } = composeDisplayText("Hello", {});
      expect(display).toBe("Hello");
      expect(prefixLen).toBe(0);
      const back = stripDisplayText("Hello", {});
      expect(back.content).toBe("Hello");
      expect(back.prefixLen).toBe(0);
    });

    it("prepends a marker prefix for a list and strips it back losslessly", () => {
      const list: TextListStyle = { type: "bullet", level: 0 };
      const { display, prefixLen } = composeDisplayText("Item", { list });
      expect(display).toBe("•\tItem");
      expect(prefixLen).toBe(listMarkerPrefix(list).length);

      const back = stripDisplayText(display, { list });
      expect(back.content).toBe("Item");
      expect(back.prefixLen).toBe(prefixLen);
    });

    it("round-trips a numbered marker with the matching ordinal", () => {
      const list: TextListStyle = { type: "number", level: 0 };
      const { display } = composeDisplayText("Task", { list }, 3);
      expect(display).toBe("3.\tTask");
      expect(stripDisplayText(display, { list }, 3).content).toBe("Task");
    });

    it("is tolerant: a displayed text not starting with the marker is left intact", () => {
      // User edited inside the marker — we must not corrupt the content.
      const list: TextListStyle = { type: "bullet", level: 0 };
      const back = stripDisplayText("no marker here", { list });
      expect(back.content).toBe("no marker here");
      expect(back.prefixLen).toBe(0);
    });
  });

  describe("shiftStylesForMarker / unshiftStylesForMarker", () => {
    it("is a no-op when prefixLen <= 0", () => {
      const map: FabricStylesMap = { 0: { 0: { fontWeight: "bold" } } };
      expect(shiftStylesForMarker(map, 0)).toBe(map);
      expect(unshiftStylesForMarker(map, 0)).toBe(map);
    });

    it("shifts line-0 char keys right by the prefix length", () => {
      const map: FabricStylesMap = {
        0: { 0: { fontWeight: "bold" }, 1: { fontStyle: "italic" } },
      };
      const shifted = shiftStylesForMarker(map, 2);
      expect(shifted[0]?.[2]).toEqual({ fontWeight: "bold" });
      expect(shifted[0]?.[3]).toEqual({ fontStyle: "italic" });
      // Original key 0 is now vacated (the marker glyph, unstyled).
      expect(shifted[0]?.[0]).toBeUndefined();
    });

    it("leaves lines other than 0 unshifted", () => {
      const map: FabricStylesMap = {
        0: { 0: { fontWeight: "bold" } },
        1: { 0: { fontStyle: "italic" } },
      };
      const shifted = shiftStylesForMarker(map, 2);
      expect(shifted[1]?.[0]).toEqual({ fontStyle: "italic" });
    });

    it("round-trips shift→unshift for content styles, dropping marker styles", () => {
      const clean: FabricStylesMap = {
        0: { 0: { fontWeight: "bold" }, 4: { fill: "#ff0000" } },
        1: { 2: { underline: true } },
      };
      const shifted = shiftStylesForMarker(clean, 2);
      const back = unshiftStylesForMarker(shifted, 2);
      expect(back).toEqual(clean);
    });

    it("drops a style that lands inside the marker on unshift", () => {
      // A style at char 1 with prefixLen 2 is inside the marker → dropped.
      const map: FabricStylesMap = { 0: { 1: { fontWeight: "bold" } } };
      const back = unshiftStylesForMarker(map, 2);
      expect(back[0]).toBeUndefined();
    });
  });
});
