import { describe, it, expect } from "vitest";
import type { TextStyleRun } from "@giga-pdf/types";
import {
  runsToFabricStyles,
  fabricStylesToRuns,
  modelStyleToFabricChar,
  fabricCharToModelStyle,
  type FabricStylesMap,
} from "../text-runs";

/**
 * text-runs.ts is the single source of truth for character-level (Word-like
 * partial formatting) style runs <-> Fabric's nested per-character `styles`
 * map. The round-trip MUST be lossless for the data the editor produces, so the
 * scene graph and the apply payload carry the runs faithfully.
 */
describe("text-runs", () => {
  describe("runsToFabricStyles", () => {
    it("returns empty map for undefined/empty runs (legacy uniform element)", () => {
      expect(runsToFabricStyles("hello", undefined)).toEqual({});
      expect(runsToFabricStyles("hello", [])).toEqual({});
    });

    it("scatters a single-line run onto line 0 by char index", () => {
      const runs: TextStyleRun[] = [
        { start: 0, end: 3, style: { fontWeight: "bold" } },
      ];
      const map = runsToFabricStyles("hello", runs);
      expect(map[0]?.[0]).toEqual({ fontWeight: "bold" });
      expect(map[0]?.[1]).toEqual({ fontWeight: "bold" });
      expect(map[0]?.[2]).toEqual({ fontWeight: "bold" });
      // Char 3 (the 'l') is outside [0,3) → untouched.
      expect(map[0]?.[3]).toBeUndefined();
    });

    it("maps model fields to Fabric names (color->fill, strikethrough->linethrough)", () => {
      const runs: TextStyleRun[] = [
        {
          start: 0,
          end: 1,
          style: { color: "#ff0000", strikethrough: true, fontSize: 20 },
        },
      ];
      const map = runsToFabricStyles("x", runs);
      expect(map[0]?.[0]).toEqual({
        fill: "#ff0000",
        linethrough: true,
        fontSize: 20,
      });
    });

    it("splits a run spanning a newline across visual lines", () => {
      // "ab\ncd": a=flat0, b=flat1, '\n'=flat2, c=flat3, d=flat4.
      // Run [1,5) covers b, (newline skipped), c, d.
      const runs: TextStyleRun[] = [
        { start: 1, end: 5, style: { fontStyle: "italic" } },
      ];
      const map = runsToFabricStyles("ab\ncd", runs);
      // Flat 1 → line0 char1.
      expect(map[0]?.[1]).toEqual({ fontStyle: "italic" });
      // Flat 0 outside the run; flat 2 is the newline (no style stored).
      expect(map[0]?.[0]).toBeUndefined();
      expect(map[0]?.[2]).toBeUndefined();
      // Flat 3,4 → line1 char0,1 (3-3=0, 4-3=1).
      expect(map[1]?.[0]).toEqual({ fontStyle: "italic" });
      expect(map[1]?.[1]).toEqual({ fontStyle: "italic" });
    });

    it("skips runs that carry no per-character style field", () => {
      const runs: TextStyleRun[] = [
        { start: 0, end: 3, style: { textAlign: "center" } },
      ];
      expect(runsToFabricStyles("hello", runs)).toEqual({});
    });
  });

  describe("fabricStylesToRuns", () => {
    it("returns undefined for null/empty styles (keeps legacy shape)", () => {
      expect(fabricStylesToRuns("hello", null)).toBeUndefined();
      expect(fabricStylesToRuns("hello", undefined)).toBeUndefined();
      expect(fabricStylesToRuns("hello", {})).toBeUndefined();
    });

    it("coalesces consecutive equal char styles into one run", () => {
      const styles: FabricStylesMap = {
        0: {
          0: { fontWeight: "bold" },
          1: { fontWeight: "bold" },
          2: { fontWeight: "bold" },
        },
      };
      const runs = fabricStylesToRuns("hello", styles);
      expect(runs).toEqual([
        { start: 0, end: 3, style: { fontWeight: "bold" } },
      ]);
    });

    it("breaks runs at a style change and at an index gap", () => {
      const styles: FabricStylesMap = {
        0: {
          0: { fontWeight: "bold" },
          1: { fontWeight: "bold" },
          // gap at 2 (no style)
          3: { fontStyle: "italic" },
        },
      };
      const runs = fabricStylesToRuns("abcd", styles);
      expect(runs).toEqual([
        { start: 0, end: 2, style: { fontWeight: "bold" } },
        { start: 3, end: 4, style: { fontStyle: "italic" } },
      ]);
    });

    it("normalises numeric weights to bold and maps Fabric names back", () => {
      const styles: FabricStylesMap = {
        0: { 0: { fontWeight: "700", fill: "#00ff00", linethrough: true } },
      };
      const runs = fabricStylesToRuns("x", styles);
      expect(runs).toEqual([
        {
          start: 0,
          end: 1,
          style: { fontWeight: "bold", color: "#00ff00", strikethrough: true },
        },
      ]);
    });

    it("ignores char indices beyond the line length", () => {
      // "ab" has chars 0,1; an index 5 (stale) must be dropped.
      const styles: FabricStylesMap = {
        0: { 0: { underline: true }, 5: { underline: true } },
      };
      const runs = fabricStylesToRuns("ab", styles);
      expect(runs).toEqual([
        { start: 0, end: 1, style: { underline: true } },
      ]);
    });
  });

  describe("round-trip runs <-> fabric styles", () => {
    it("is lossless for a multi-field, multi-line set of runs", () => {
      const content = "Hello\nWorld";
      const runs: TextStyleRun[] = [
        { start: 0, end: 5, style: { fontWeight: "bold" } },
        { start: 6, end: 11, style: { fontStyle: "italic", color: "#123456" } },
      ];
      const map = runsToFabricStyles(content, runs);
      const back = fabricStylesToRuns(content, map);
      expect(back).toEqual(runs);
    });

    it("round-trips a colour-only run on a single line", () => {
      const content = "abcdef";
      const runs: TextStyleRun[] = [
        { start: 2, end: 5, style: { color: "#abcdef" } },
      ];
      const map = runsToFabricStyles(content, runs);
      expect(fabricStylesToRuns(content, map)).toEqual(runs);
    });
  });

  describe("single char-style mappers", () => {
    it("modelStyleToFabricChar drops fields not set", () => {
      expect(modelStyleToFabricChar({ fontWeight: "bold" })).toEqual({
        fontWeight: "bold",
      });
      expect(modelStyleToFabricChar({})).toEqual({});
    });

    it("fabricCharToModelStyle normalises italic/normal", () => {
      expect(fabricCharToModelStyle({ fontStyle: "italic" })).toEqual({
        fontStyle: "italic",
      });
      expect(fabricCharToModelStyle({ fontStyle: "oblique" })).toEqual({
        fontStyle: "normal",
      });
    });
  });
});
