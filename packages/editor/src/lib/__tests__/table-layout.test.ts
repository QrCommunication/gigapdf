import { describe, expect, it } from "vitest";
import type { Bounds, ShapeElement, TextElement } from "@giga-pdf/types";
import { buildListContent, buildTableElements } from "../table-layout";

const AREA: Bounds = { x: 50, y: 60, width: 300, height: 200 };

describe("buildTableElements", () => {
  it("produces rows*cols cell text elements plus (rows+1)+(cols+1) border lines", () => {
    const els = buildTableElements({ rows: 3, cols: 4, area: AREA });
    const cells = els.filter((e) => e.type === "text");
    const lines = els.filter((e) => e.type === "shape");

    expect(cells).toHaveLength(12); // 3*4
    expect(lines).toHaveLength(3 + 1 + (4 + 1)); // 4 horizontals + 5 verticals = 9
    expect(els).toHaveLength(12 + 9);
  });

  it("lays cells out on an even grid within the area", () => {
    const els = buildTableElements({
      rows: 2,
      cols: 2,
      area: AREA,
      cellPadding: 0,
    });
    const cells = els.filter(
      (e): e is Omit<TextElement, "elementId"> => e.type === "text",
    );
    // cellW=150, cellH=100. Cell order is row-major.
    expect(cells[0]!.bounds).toMatchObject({ x: 50, y: 60, width: 150, height: 100 });
    expect(cells[1]!.bounds).toMatchObject({ x: 200, y: 60 }); // col 1
    expect(cells[2]!.bounds).toMatchObject({ x: 50, y: 160 }); // row 1
    expect(cells[3]!.bounds).toMatchObject({ x: 200, y: 160 });
  });

  it("creates empty editable text cells with the requested font size", () => {
    const els = buildTableElements({ rows: 1, cols: 1, area: AREA, fontSize: 16 });
    const cell = els.find(
      (e): e is Omit<TextElement, "elementId"> => e.type === "text",
    )!;
    expect(cell.content).toBe("");
    expect(cell.style.fontSize).toBe(16);
    expect(cell.locked).toBe(false);
    expect(cell.visible).toBe(true);
  });

  it("draws border lines spanning the full table edges with stroke styling", () => {
    const els = buildTableElements({
      rows: 1,
      cols: 1,
      area: AREA,
      borderColor: "#ff0000",
      borderWidth: 2,
    });
    const lines = els.filter(
      (e): e is Omit<ShapeElement, "elementId"> => e.type === "shape",
    );
    // 1x1 table => 2 horizontals + 2 verticals.
    expect(lines).toHaveLength(4);
    for (const ln of lines) {
      expect(ln.shapeType).toBe("line");
      expect(ln.style.strokeColor).toBe("#ff0000");
      expect(ln.style.strokeWidth).toBe(2);
      expect(ln.style.fillColor).toBeNull();
      expect(ln.geometry.points).toHaveLength(2);
    }
    // The top border runs along y=60 from x=50 to x=350.
    const topBorder = lines.find(
      (l) => l.geometry.points[0]!.y === 60 && l.geometry.points[1]!.y === 60,
    )!;
    expect(topBorder.geometry.points[0]).toMatchObject({ x: 50, y: 60 });
    expect(topBorder.geometry.points[1]).toMatchObject({ x: 350, y: 60 });
  });

  it("clamps cell padding so inner bounds never invert on tiny cells", () => {
    const els = buildTableElements({
      rows: 1,
      cols: 1,
      area: { x: 0, y: 0, width: 4, height: 4 },
      cellPadding: 10,
    });
    const cell = els.find(
      (e): e is Omit<TextElement, "elementId"> => e.type === "text",
    )!;
    expect(cell.bounds.width).toBeGreaterThanOrEqual(1);
    expect(cell.bounds.height).toBeGreaterThanOrEqual(1);
  });

  it("throws when rows or cols are below 1", () => {
    expect(() => buildTableElements({ rows: 0, cols: 2, area: AREA })).toThrow();
    expect(() => buildTableElements({ rows: 2, cols: 0, area: AREA })).toThrow();
  });
});

describe("buildListContent", () => {
  it("prefixes each non-empty line with a bullet", () => {
    expect(buildListContent("alpha\nbeta", "bullet")).toBe("• alpha\n• beta");
  });

  it("numbers each non-empty line sequentially", () => {
    expect(buildListContent("alpha\nbeta\ngamma", "numbered")).toBe(
      "1. alpha\n2. beta\n3. gamma",
    );
  });

  it("preserves blank lines and does not count them in numbering", () => {
    expect(buildListContent("alpha\n\nbeta", "numbered")).toBe(
      "1. alpha\n\n2. beta",
    );
  });

  it("is idempotent for bullets (does not double-prefix)", () => {
    const once = buildListContent("alpha", "bullet");
    expect(buildListContent(once, "bullet")).toBe(once);
  });

  it("renumbers existing ordinals instead of stacking prefixes", () => {
    expect(buildListContent("1. alpha\n1. beta", "numbered")).toBe(
      "1. alpha\n2. beta",
    );
  });
});
