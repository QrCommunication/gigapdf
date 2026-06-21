/**
 * render-elements.test.ts
 *
 * Regression guard for the "doubled text" bug: the element overlay built by the
 * SHARED canonical renderer (used by BOTH the single-page editor and the
 * continuous Word-like view) must be INVISIBLE — the visible page is the PDF
 * raster at index 0; the overlay is only a click/edit hit-target. If the text
 * overlay ever regains a visible fill, every glyph renders twice.
 *
 * Fabric is mocked with lightweight constructors that record their options, so
 * we assert on the exact Fabric object configuration without a real canvas.
 */

import { describe, it, expect, vi } from "vitest";
import type { Element } from "@giga-pdf/types";
import { renderElementsOverlay } from "../render-elements";

// --- Minimal Fabric mock: each shape records its constructor options. --------
class FakeObj {
  opts: Record<string, unknown>;
  data?: Record<string, unknown>;
  constructor(opts: Record<string, unknown> = {}) {
    this.opts = opts;
  }
  set(patch: Record<string, unknown>) {
    Object.assign(this.opts, patch);
  }
}
class IText extends FakeObj {
  text: string;
  constructor(text: string, opts: Record<string, unknown>) {
    super(opts);
    this.text = text;
  }
}
class Rect extends FakeObj {}
class Circle extends FakeObj {}
class Ellipse extends FakeObj {}
class Triangle extends FakeObj {}
class Polygon extends FakeObj {
  constructor(_points: unknown, opts: Record<string, unknown>) {
    super(opts);
  }
}
class Line extends FakeObj {
  constructor(_coords: unknown, opts: Record<string, unknown>) {
    super(opts);
  }
}
class Path extends FakeObj {
  constructor(_d: unknown, opts: Record<string, unknown>) {
    super(opts);
  }
}
const FabricImage = {
  fromURL: vi.fn(async () => new FakeObj()),
};

const fabricMock = {
  Rect,
  Circle,
  Ellipse,
  Triangle,
  Line,
  IText,
  FabricImage,
  Path,
  Polygon,
} as unknown as typeof import("fabric");

function makeCanvas() {
  const objects: FakeObj[] = [];
  const handlers: Record<string, Array<(e: unknown) => void>> = {};
  return {
    add: (o: FakeObj) => objects.push(o),
    remove: vi.fn(),
    getObjects: () => objects,
    renderAll: vi.fn(),
    requestRenderAll: vi.fn(),
    on: (event: string, cb: (e: unknown) => void) => {
      (handlers[event] ??= []).push(cb);
    },
    fire: (event: string, e: unknown) => {
      for (const cb of handlers[event] ?? []) cb(e);
    },
    _objects: objects,
    _handlers: handlers,
  } as unknown as import("fabric").Canvas & {
    _objects: FakeObj[];
    fire: (event: string, e: unknown) => void;
  };
}

function textElement(over: Partial<Record<string, unknown>> = {}): Element {
  return {
    type: "text",
    elementId: "t1",
    bounds: { x: 10, y: 20, width: 100, height: 14 },
    visible: true,
    locked: false,
    content: "Bonjour",
    style: {
      fontSize: 12,
      color: "#112233",
      fontFamily: "Helvetica",
      originalFont: "KWVFOU+TimesNewRoman,Bold",
    },
    ...over,
  } as unknown as Element;
}

describe("renderElementsOverlay — 1:1 fidelity (anti-doubling)", () => {
  it("renders text overlay VISIBLE in its real colour (direct text over a text-free raster)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, [textElement()], fabricMock);

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText | undefined;
    expect(it_).toBeDefined();
    // The raster is rendered WITHOUT text, so this overlay IS the visible text:
    // painted in its real colour (no doubling — there is no glyph underneath).
    expect(it_!.opts.fill).toBe("#112233");
    expect((it_!.data as Record<string, unknown>).originalFill).toBe("#112233");
  });

  it("resolves the embedded FontFace via getFontFaceName when provided", async () => {
    const canvas = makeCanvas();
    const getFontFaceName = vi.fn(() => "gigapdf-doc-font-abc");
    await renderElementsOverlay(canvas, [textElement()], fabricMock, {
      getFontFaceName,
    });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(getFontFaceName).toHaveBeenCalledWith("KWVFOU+TimesNewRoman,Bold");
    expect(it_.opts.fontFamily).toBe("gigapdf-doc-font-abc");
  });

  it("renders shapes as TRANSPARENT hit-targets (raster shows the real shape)", async () => {
    const canvas = makeCanvas();
    const shape = {
      type: "shape",
      elementId: "s1",
      shapeType: "rectangle",
      bounds: { x: 0, y: 0, width: 50, height: 50 },
      visible: true,
      locked: false,
      index: 7,
      geometry: {},
      style: {
        fillColor: "#ff0000",
        fillOpacity: 1,
        strokeColor: "#0000ff",
        strokeWidth: 2,
        strokeOpacity: 1,
      },
    } as unknown as Element;
    await renderElementsOverlay(canvas, [shape], fabricMock);

    const rect = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Rect,
    ) as Rect;
    // The shape stays BAKED in the text-free raster background (the visual
    // ground truth — exact PDF z-order, no `renderPageExcluding` index quirk),
    // so the overlay is a TRANSPARENT, editable hit-target. Painting it would
    // double the shape over the raster.
    expect(rect.opts.fill).toBe("transparent");
    expect(rect.opts.stroke).toBe("transparent");
    expect(rect.opts.strokeWidth).toBe(0);
    // The real fill/stroke are stashed on .data — used by the properties panel
    // and to REVEAL the overlay while the shape is selected.
    const data = rect.data as Record<string, unknown>;
    expect(data.originalFill).toBe("#ff0000");
    expect(data.originalStroke).toBe("#0000ff");
    expect(data.originalStrokeWidth).toBe(2);
  });

  it("stashes the alpha-composited fill on .data (revealed on selection)", async () => {
    const canvas = makeCanvas();
    const shape = {
      type: "shape",
      elementId: "s2",
      shapeType: "rectangle",
      bounds: { x: 0, y: 0, width: 50, height: 50 },
      visible: true,
      locked: false,
      index: 3,
      geometry: {},
      style: { fillColor: "#ff0000", fillOpacity: 0.5, strokeWidth: 0 },
    } as unknown as Element;
    await renderElementsOverlay(canvas, [shape], fabricMock);

    const rect = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Rect,
    ) as Rect;
    // Overlay is transparent in view; the 50%-alpha fill is preserved on .data
    // so selection-reveal restores the exact colour.
    expect(rect.opts.fill).toBe("transparent");
    expect((rect.data as Record<string, unknown>).originalFill).toBe(
      "rgba(255, 0, 0, 0.5)",
    );
  });

  it("deduplicates a stacked twin text run at the same position", async () => {
    const canvas = makeCanvas();
    const a = textElement({ elementId: "a" });
    const b = textElement({ elementId: "b" }); // same content + size + position
    await renderElementsOverlay(canvas, [a, b], fabricMock);

    const texts = (
      canvas as unknown as { _objects: FakeObj[] }
    )._objects.filter((o) => o instanceof IText);
    expect(texts).toHaveLength(1);
  });

  it("reveals a shape's real fill on selection and re-masks it on clear", async () => {
    const canvas = makeCanvas();
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;
    const shape = {
      type: "shape",
      elementId: "s3",
      shapeType: "rectangle",
      bounds: { x: 0, y: 0, width: 50, height: 50 },
      visible: true,
      locked: false,
      index: 9,
      geometry: {},
      style: {
        fillColor: "#00ff00",
        fillOpacity: 1,
        strokeColor: "#000000",
        strokeWidth: 3,
        strokeOpacity: 1,
      },
    } as unknown as Element;
    await renderElementsOverlay(canvas, [shape], fabricMock);

    const rect = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Rect,
    ) as Rect;
    // Transparent in view…
    expect(rect.opts.fill).toBe("transparent");

    // …revealed (real fill/stroke/width) while selected…
    fire("selection:created", { selected: [rect] });
    expect(rect.opts.fill).toBe("#00ff00");
    expect(rect.opts.stroke).toBe("#000000");
    expect(rect.opts.strokeWidth).toBe(3);

    // …re-masked on deselection.
    fire("selection:cleared", {});
    expect(rect.opts.fill).toBe("transparent");
    expect(rect.opts.strokeWidth).toBe(0);
  });
});
