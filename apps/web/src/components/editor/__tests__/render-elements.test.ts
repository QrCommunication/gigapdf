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
  // Fabric's IText.set({ text }) updates the live `.text` property; mirror that
  // so click-toggle assertions (which read obj.text) behave like real Fabric.
  set(patch: Record<string, unknown>) {
    if (typeof patch.text === "string") this.text = patch.text;
    super.set(patch);
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

  it("NEUTRALISES synthetic bold/italic when the embedded font is used", async () => {
    // The embedded subset IS already the bold/italic variant, so applying a
    // synthetic weight/style on top widens glyphs → overflow. With the embedded
    // font resolved, fontWeight/fontStyle must be 'normal' and the object is
    // flagged usingEmbeddedFont (no cosmetic width fit).
    const canvas = makeCanvas();
    const getFontFaceName = vi.fn(() => "gigapdf-doc-font-bold");
    const bold = textElement({
      style: {
        fontSize: 12,
        color: "#000000",
        fontFamily: "Helvetica",
        fontWeight: "bold",
        fontStyle: "italic",
        originalFont: "KWVFOU+TimesNewRoman,Bold",
      },
    });
    await renderElementsOverlay(canvas, [bold], fabricMock, { getFontFaceName });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.opts.fontFamily).toBe("gigapdf-doc-font-bold");
    expect(it_.opts.fontWeight).toBe("normal");
    expect(it_.opts.fontStyle).toBe("normal");
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(true);
    expect((it_.data as Record<string, unknown>).cosmeticScaleX).toBe(false);
  });

  it("KEEPS the parsed weight/style for the generic fallback font", async () => {
    // No embedded font resolved (getFontFaceName returns null) → the CSS family
    // has no built-in variant, so the parsed bold/italic must be honoured.
    const canvas = makeCanvas();
    const getFontFaceName = vi.fn(() => null);
    const bold = textElement({
      style: {
        fontSize: 12,
        color: "#000000",
        fontFamily: "Helvetica",
        fontWeight: "bold",
        fontStyle: "italic",
        originalFont: "KWVFOU+TimesNewRoman,Bold",
      },
    });
    await renderElementsOverlay(canvas, [bold], fabricMock, { getFontFaceName });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.opts.fontFamily).toBe("Helvetica");
    expect(it_.opts.fontWeight).toBe("bold");
    expect(it_.opts.fontStyle).toBe("italic");
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(false);
  });

  it("applies a cosmetic scaleX fit when the fallback text overflows its bounds", async () => {
    // With the fallback font, Fabric measures a width wider than bounds.width →
    // a horizontal squeeze is applied AND flagged cosmetic (so the round-trip
    // never bakes it into bounds.width).
    const canvas = makeCanvas();
    // IText mock that reports a measured width far beyond the 100px bounds.
    class WideIText extends IText {
      width = 250;
    }
    const wideFabric = {
      ...fabricMock,
      IText: WideIText,
    } as unknown as typeof import("fabric");
    await renderElementsOverlay(canvas, [textElement()], wideFabric, {
      getFontFaceName: () => null,
    });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof WideIText,
    ) as WideIText;
    expect((it_.data as Record<string, unknown>).cosmeticScaleX).toBe(true);
    // 100 / 250 = 0.4 (above the 0.35 clamp).
    expect(it_.opts.scaleX).toBeCloseTo(0.4, 5);
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

  it("KEEPS legitimate same-content repeats in the same column at different rows", async () => {
    // Form labels / table cells / repeated values like "Les Lilas" recur down a
    // column: same content + colour + X but DIFFERENT Y. A previous heuristic
    // ("same X, ANY Y") wrongly dropped these, making text vanish from the
    // editor. They must ALL render.
    const canvas = makeCanvas();
    const rows = [20, 60, 100, 140].map((y, i) =>
      textElement({
        elementId: `row${i}`,
        content: "Les Lilas",
        bounds: { x: 30, y, width: 80, height: 12 },
      }),
    );
    await renderElementsOverlay(canvas, rows, fabricMock);

    const texts = (
      canvas as unknown as { _objects: FakeObj[] }
    )._objects.filter((o) => o instanceof IText);
    expect(texts).toHaveLength(4);
  });

  it("KEEPS a same-content cross-line repeat at the same Y but offset X", async () => {
    // "RONY LICHA" on a sender + recipient line: same y, different x — keep both.
    const canvas = makeCanvas();
    const left = textElement({
      elementId: "l",
      content: "RONY LICHA",
      bounds: { x: 30, y: 40, width: 90, height: 12 },
    });
    const right = textElement({
      elementId: "r",
      content: "RONY LICHA",
      bounds: { x: 320, y: 40, width: 90, height: 12 },
    });
    await renderElementsOverlay(canvas, [left, right], fabricMock);

    const texts = (
      canvas as unknown as { _objects: FakeObj[] }
    )._objects.filter((o) => o instanceof IText);
    expect(texts).toHaveLength(2);
  });

  it("preserves a WHITE text run's colour (header on a coloured band)", async () => {
    // White section headers ("A Identification") sit on a coloured band that is
    // baked into the text-free raster — so the white overlay must render WHITE
    // (never forced to black) to be visible over the band.
    const canvas = makeCanvas();
    const white = textElement({
      elementId: "w",
      content: "A Identification",
      style: { fontSize: 11, color: "#ffffff", fontFamily: "Helvetica" },
    });
    await renderElementsOverlay(canvas, [white], fabricMock);

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.opts.fill).toBe("#ffffff");
    expect((it_.data as Record<string, unknown>).originalFill).toBe("#ffffff");
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

// --- Editable form fields (fill the form directly on the page) ---------------

function formFieldElement(
  over: Partial<Record<string, unknown>> = {},
): Element {
  return {
    type: "form_field",
    elementId: "f1",
    fieldType: "text",
    fieldName: "lastName",
    value: "",
    defaultValue: "",
    options: null,
    properties: {
      required: false,
      readOnly: false,
      maxLength: null,
      multiline: false,
      password: false,
      comb: false,
    },
    style: {
      fontFamily: "Helvetica",
      fontSize: 11,
      textColor: "#0a3a8a",
      backgroundColor: null,
      borderColor: null,
      borderWidth: 0,
    },
    format: { type: "none", pattern: null },
    placeholder: "Last name",
    bounds: { x: 10, y: 20, width: 120, height: 16 },
    visible: true,
    locked: false,
    ...over,
  } as unknown as Element;
}

describe("renderElementsOverlay — editable form fields", () => {
  it("renders a TEXT field as an editable IText showing its value", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [formFieldElement({ value: "Dupont" })],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_).toBeDefined();
    expect(it_.text).toBe("Dupont");
    expect(it_.opts.editable).toBe(true);
    const data = it_.data as Record<string, unknown>;
    expect(data.type).toBe("form_field");
    expect(data.fieldType).toBe("text");
    expect(data.formFieldElement).toBeDefined();
  });

  it("shows the placeholder (greyed) for an empty TEXT field", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, [formFieldElement()], fabricMock);
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.text).toBe("Last name");
    expect((it_.data as Record<string, unknown>).fieldShowingPlaceholder).toBe(
      true,
    );
    expect((it_.data as Record<string, unknown>).fieldPlaceholder).toBe(
      "Last name",
    );
  });

  it("renders a CHECKBOX as a clickable mark reflecting its checked state", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "cb",
          fieldType: "checkbox",
          fieldName: "agree",
          value: true,
        }),
      ],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.text).toBe("☑");
    expect(it_.opts.editable).toBe(false);
    const data = it_.data as Record<string, unknown>;
    expect(data.fieldChecked).toBe(true);
    expect(data.fieldType).toBe("checkbox");
  });

  it("toggles a checkbox on click and fires object:modified", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "cb",
          fieldType: "checkbox",
          fieldName: "agree",
          value: false,
        }),
      ],
      fabricMock,
      { onElementSelected: vi.fn() },
    );
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect((it_.data as Record<string, unknown>).fieldChecked).toBe(false);

    let modifiedTarget: unknown = null;
    canvas.on("object:modified", (e) => {
      modifiedTarget = (e as { target?: unknown }).target;
    });
    fire("mouse:down", { target: it_ });

    expect((it_.data as Record<string, unknown>).fieldChecked).toBe(true);
    expect(it_.text).toBe("☑");
    expect(modifiedTarget).toBe(it_);
  });

  it("unchecks sibling radios of the same group when one is selected", async () => {
    const canvas = makeCanvas();
    const radios = ["yes", "no"].map((opt) =>
      formFieldElement({
        elementId: `r-${opt}`,
        fieldType: "radio",
        fieldName: "answer",
        options: [opt],
        value: opt === "yes" ? opt : "",
        bounds: { x: 10, y: opt === "yes" ? 20 : 50, width: 14, height: 14 },
      }),
    );
    await renderElementsOverlay(canvas, radios, fabricMock, {
      onElementSelected: vi.fn(),
    });
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;
    const marks = (
      canvas as unknown as { _objects: FakeObj[] }
    )._objects.filter((o) => o instanceof IText) as IText[];
    const yes = marks.find((m) => (m.data as Record<string, unknown>).elementId === "r-yes")!;
    const no = marks.find((m) => (m.data as Record<string, unknown>).elementId === "r-no")!;
    expect((yes.data as Record<string, unknown>).fieldChecked).toBe(true);

    // Click the "no" radio → it becomes checked, "yes" gets unchecked.
    fire("mouse:down", { target: no });
    expect((no.data as Record<string, unknown>).fieldChecked).toBe(true);
    expect((yes.data as Record<string, unknown>).fieldChecked).toBe(false);
  });

  it("renders a SIGNATURE field as a non-text hit-target Rect", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "sig",
          fieldType: "signature",
          fieldName: "sign",
          value: "",
        }),
      ],
      fabricMock,
    );
    const hasIText = (canvas as unknown as { _objects: FakeObj[] })._objects.some(
      (o) => o instanceof IText,
    );
    const rect = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Rect,
    ) as Rect;
    expect(hasIText).toBe(false);
    expect(rect).toBeDefined();
    expect((rect.data as Record<string, unknown>).fieldType).toBe("signature");
    expect((rect.data as Record<string, unknown>).formFieldElement).toBeDefined();
  });
});
