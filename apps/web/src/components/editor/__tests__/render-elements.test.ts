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
import type { Element, PageBlockGroup } from "@giga-pdf/types";
import {
  renderElementsOverlay,
  applyFallbackWidthFit,
  applySegmentWidthFit,
  groupTextRunsIntoParagraphs,
  measuredLineHeightMultiple,
  hasUniformLineAdvance,
  isCoherentCoalescedBlock,
  pageBlockGroupsToParagraphs,
  pageBlockGroupsToTablesAndLists,
} from "../render-elements";
import type { TextRun } from "../render-elements";

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
class Textbox extends FakeObj {
  text: string;
  constructor(text: string, opts: Record<string, unknown>) {
    super(opts);
    this.text = text;
  }
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
  Textbox,
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
    // Mirror Fabric v6's canvas.moveObjectTo: pull the object out and re-insert
    // it at the target index (used by the post-image-load z-order re-assert).
    moveObjectTo: (o: FakeObj, index: number) => {
      const cur = objects.indexOf(o);
      if (cur === -1) return;
      objects.splice(cur, 1);
      objects.splice(index, 0, o);
    },
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
    // Now resolved WEIGHT/STYLE-AWARE: the run carries no explicit weight/style,
    // so the variant intent is regular (bold:false, italic:false). The run text
    // is forwarded so the resolver can pick the COVERING subset (CERFA disjoint
    // subsets) — here "Bonjour" from the textElement() factory.
    expect(getFontFaceName).toHaveBeenCalledWith(
      "KWVFOU+TimesNewRoman,Bold",
      { bold: false, italic: false },
      "Bonjour",
    );
    expect(it_.opts.fontFamily).toBe("gigapdf-doc-font-abc");
  });

  it("resolves the embedded subset matching the run's weight/style variant", async () => {
    // A PDF embeds many subsets of the same family. The resolver is asked first
    // for the variant-EXACT subset (Pass 1, weight-bearing names); only if that
    // misses does the renderer fall back to the loose 1-arg call. Here the run is
    // BOLD ITALIC, so the variant query must carry { bold: true, italic: true }
    // and its result is used as-is (no synthetic bold/italic on top).
    const canvas = makeCanvas();
    const getFontFaceName = vi.fn((_name: string, variant?: { bold?: boolean; italic?: boolean }) =>
      variant?.bold && variant?.italic ? "gigapdf-doc-bolditalic" : null,
    );
    const run = textElement({
      style: {
        fontSize: 12,
        color: "#000000",
        fontFamily: "Times New Roman",
        fontWeight: "bold",
        fontStyle: "italic",
        // Bare family name — exactly what the SDK collapses a run's font to.
        originalFont: "Times New Roman",
      },
    });
    await renderElementsOverlay(canvas, [run], fabricMock, { getFontFaceName });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(getFontFaceName).toHaveBeenCalledWith(
      "Times New Roman",
      { bold: true, italic: true },
      "Bonjour",
    );
    expect(it_.opts.fontFamily).toBe("gigapdf-doc-bolditalic");
    // Variant-exact subset already encodes the weight/style → no synthetic.
    expect(it_.opts.fontWeight).toBe("normal");
    expect(it_.opts.fontStyle).toBe("normal");
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(true);
  });

  it("falls back to the loose subset + synthetic weight when the exact variant is not embedded", async () => {
    // The PDF embeds the family but NOT this run's variant: the variant-exact
    // query (Pass 1) returns null, so the renderer uses the loose 1-arg match for
    // the closest subset AND re-applies the parsed weight/style synthetically to
    // approximate the missing variant (instead of silently rendering it regular).
    const canvas = makeCanvas();
    const getFontFaceName = vi.fn(
      (_name: string, variant?: { bold?: boolean; italic?: boolean }) =>
        // Variant-exact miss (null); loose 1-arg call (no variant) → closest subset.
        variant === undefined ? "gigapdf-doc-regular" : null,
    );
    const run = textElement({
      style: {
        fontSize: 12,
        color: "#000000",
        fontFamily: "Times New Roman",
        fontWeight: "bold",
        fontStyle: "normal",
        originalFont: "Times New Roman",
      },
    });
    await renderElementsOverlay(canvas, [run], fabricMock, { getFontFaceName });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    // Both calls happened: variant-exact (missed, carries the run text) then
    // loose 1-arg (hit). The loose path is exactly what FIX #1b relies on when no
    // same-variant subset covers the run → loose subset + synthetic uniform weight.
    expect(getFontFaceName).toHaveBeenCalledWith(
      "Times New Roman",
      { bold: true, italic: false },
      "Bonjour",
    );
    expect(getFontFaceName).toHaveBeenCalledWith("Times New Roman");
    expect(it_.opts.fontFamily).toBe("gigapdf-doc-regular");
    // Closest subset is not the bold variant → synthesise bold so it still reads bold.
    expect(it_.opts.fontWeight).toBe("bold");
    expect(it_.opts.fontStyle).toBe("normal");
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(false);
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

  it("shrinks an overflowing FALLBACK run to its /Widths box (floored at 0.5)", async () => {
    // A loose/CSS fallback measures wider than the run's real advance; it is shrunk
    // to the box so it can't overlap the next run, floored so a gross mis-measure
    // (here 100/250 = 0.4) never crushes below 0.5.
    const canvas = makeCanvas();
    // IText mock reporting a measured width far beyond the 100px bounds.
    class WideIText extends IText {
      width = 250;
    }
    const wideFabric = {
      ...fabricMock,
      IText: WideIText,
    } as unknown as typeof import("fabric");
    await renderElementsOverlay(canvas, [textElement()], wideFabric, {
      getFontFaceName: () => null, // no embedded match → CSS fallback
    });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof WideIText,
    ) as WideIText;
    // 100/250 = 0.4 → clamped to the 0.5 floor.
    expect(it_.opts.scaleX).toBeCloseTo(0.5, 5);
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(false);
  });

  it("shrinks an overflowing EMBEDDED run to its box too (hmtx ≠ /Widths)", async () => {
    // Even the exact embedded subset renders at the FontFace hmtx advance, a hair
    // wider than /Widths — so a run interleaved in a justified line (a footer's plain
    // " 'obtenir") would overlap its neighbour. It is now fitted to its box (this was
    // previously left untouched, which caused the residual footer overlap).
    const canvas = makeCanvas();
    class WideIText extends IText {
      width = 250;
    }
    const wideFabric = {
      ...fabricMock,
      IText: WideIText,
    } as unknown as typeof import("fabric");
    await renderElementsOverlay(canvas, [textElement()], wideFabric, {
      // Exact subset resolves → resolveTextFont marks usingEmbeddedFont.
      getFontFaceName: () => "gigapdf-doc-KWVFOU",
    });

    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof WideIText,
    ) as WideIText;
    // 100/250 = 0.4 → clamped to the 0.5 floor — fitted, no longer left untouched.
    expect(it_.opts.scaleX).toBeCloseTo(0.5, 5);
    expect((it_.data as Record<string, unknown>).usingEmbeddedFont).toBe(true);
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

  it("shows BLANK (never the field name) for an empty TEXT field with no placeholder", async () => {
    const canvas = makeCanvas();
    // No AcroForm placeholder: the empty field must render blank, NOT the
    // internal field NAME ("lastName" / CERFA's "NOM PAR 2"). The name is
    // identity metadata, kept on data.fieldName for round-trip / side panel.
    await renderElementsOverlay(
      canvas,
      [formFieldElement({ placeholder: null })],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.text).toBe("");
    const data = it_.data as Record<string, unknown>;
    expect(data.fieldPlaceholder).toBe("");
    // The field NAME is still available for the round-trip + side-panel label.
    expect(data.fieldName).toBe("lastName");
  });

  it("renders an empty LISTBOX (no options) as blank, not its field name", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "lb",
          fieldType: "listbox",
          fieldName: "country",
          options: [],
          value: "",
        }),
      ],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_.text).toBe("");
    expect((it_.data as Record<string, unknown>).fieldName).toBe("country");
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

  it("renders a LISTBOX showing its options with the selected one marked", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "lb",
          fieldType: "listbox",
          fieldName: "country",
          options: ["France", "Spain", "Italy"],
          value: "Spain",
        }),
      ],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_).toBeDefined();
    // The selected option is prefixed with a marker; the others are not.
    expect(it_.text).toContain("▸ Spain");
    expect(it_.text).toContain("France");
    expect(it_.opts.editable).toBe(false);
    const data = it_.data as Record<string, unknown>;
    expect(data.fieldType).toBe("listbox");
    expect(data.formFieldElement).toBeDefined();
  });

  it("renders a BUTTON showing its label (centred, non-editable)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        formFieldElement({
          elementId: "btn",
          fieldType: "button",
          fieldName: "submit",
          value: "Submit",
        }),
      ],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_).toBeDefined();
    expect(it_.text).toBe("Submit");
    expect(it_.opts.editable).toBe(false);
    expect(it_.opts.originX).toBe("center");
    expect((it_.data as Record<string, unknown>).fieldType).toBe("button");
  });
});

// --- Annotation sub-types (real geometry, not approximations) ----------------

function annotationElement(
  over: Partial<Record<string, unknown>> = {},
): Element {
  return {
    type: "annotation",
    elementId: "a1",
    annotationType: "highlight",
    content: "",
    bounds: { x: 10, y: 20, width: 80, height: 12 },
    visible: true,
    locked: false,
    style: { color: "#ff0000", opacity: 1 },
    linkDestination: null,
    popup: null,
    ...over,
  } as unknown as Element;
}

describe("renderElementsOverlay — annotation sub-types", () => {
  it("renders a SQUIGGLY as a wavy Path (not a dashed line)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [annotationElement({ annotationType: "squiggly" })],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const path = objects.find((o) => o instanceof Path) as Path;
    // Rendered as a Path (wavy), NOT a Line (the old dashed approximation).
    expect(path).toBeDefined();
    expect(objects.some((o) => o instanceof Line)).toBe(false);
    expect((path.data as Record<string, unknown>).annotationType).toBe(
      "squiggly",
    );
  });

  it("renders an ARROW as a single Path (shaft + filled head)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        annotationElement({
          annotationType: "arrow",
          linePoints: { x1: 10, y1: 10, x2: 90, y2: 50 },
          style: { color: "#0000ff", opacity: 1, strokeWidth: 2 },
        }),
      ],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const path = objects.find((o) => o instanceof Path) as Path;
    expect(path).toBeDefined();
    // Exactly ONE object for the whole arrow (no Group, no duplicate).
    expect(objects.filter((o) => o instanceof Path)).toHaveLength(1);
    expect((path.data as Record<string, unknown>).annotationType).toBe("arrow");
    expect(path.opts.fill).toBe("#0000ff");
  });

  it("renders a LINE annotation from its explicit endpoints", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        annotationElement({
          annotationType: "line",
          linePoints: { x1: 5, y1: 5, x2: 95, y2: 5 },
        }),
      ],
      fabricMock,
    );
    const line = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Line,
    ) as Line;
    expect(line).toBeDefined();
    expect((line.data as Record<string, unknown>).annotationType).toBe("line");
  });

  it("renders a FREETEXT annotation as an editable IText of its content", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [annotationElement({ annotationType: "freetext", content: "A note" })],
      fabricMock,
    );
    const it_ = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof IText,
    ) as IText;
    expect(it_).toBeDefined();
    expect(it_.text).toBe("A note");
    expect(it_.opts.editable).toBe(true);
    expect((it_.data as Record<string, unknown>).annotationType).toBe(
      "freetext",
    );
  });

  it("warns (does not silently drop) for an unknown annotation subtype", async () => {
    const canvas = makeCanvas();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderElementsOverlay(
      canvas,
      [annotationElement({ annotationType: "weird-kind" })],
      fabricMock,
    );
    // Still produces a hit-target Rect AND logs a warning.
    const rect = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Rect,
    );
    expect(rect).toBeDefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// --- Image without a usable source → visible placeholder, not silent drop ----

describe("renderElementsOverlay — image placeholder", () => {
  it("renders a dashed placeholder (and warns) when an image has no dataUrl", async () => {
    const canvas = makeCanvas();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderElementsOverlay(
      canvas,
      [
        {
          type: "image",
          elementId: "img-broken",
          bounds: { x: 10, y: 20, width: 60, height: 40 },
          visible: true,
          locked: false,
          source: { type: "embedded", dataUrl: "" },
          style: { opacity: 1 },
        } as unknown as Element,
      ],
      fabricMock,
    );
    const rect = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Rect,
    ) as Rect;
    expect(rect).toBeDefined();
    expect((rect.data as Record<string, unknown>).type).toBe("image");
    expect((rect.data as Record<string, unknown>).isImagePlaceholder).toBe(true);
    // Non-interactive so it is never serialised back as a shape on save.
    expect(rect.opts.selectable).toBe(false);
    expect(rect.opts.evented).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// --- Parsed vs new image overlays (opacity, z-order, selection-reveal) --------
//
// A PARSED image (carries an engine `index`) is already baked into the text-free
// raster, so its overlay must be an INVISIBLE (opacity 0) hit-target — like the
// shape overlays — otherwise a full-page parsed background image paints over the
// text and steals every click. A NEWLY-ADDED image (no `index`) is NOT in the
// raster, so it stays visible at its real opacity. In both cases the real
// opacity is stashed on data.originalOpacity for a lossless save.

describe("renderElementsOverlay — parsed vs new image overlays", () => {
  function imageElement(over: Partial<Record<string, unknown>> = {}): Element {
    return {
      type: "image",
      elementId: "img",
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      visible: true,
      locked: false,
      source: {
        type: "embedded",
        dataUrl: "imgU",
        originalDimensions: { width: 100, height: 50 },
      },
      style: { opacity: 1 },
      ...over,
    } as unknown as Element;
  }

  const findImage = (canvas: unknown): FakeObj | undefined =>
    (canvas as { _objects: FakeObj[] })._objects.find(
      (o) => (o.data as Record<string, unknown> | undefined)?.type === "image",
    );

  it("renders a PARSED image overlay invisible (opacity 0) + stashes its real opacity", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [imageElement({ index: 4, style: { opacity: 0.8 } })],
      fabricMock,
      { resolveImageUrl: (u: string) => u },
    );
    const img = findImage(canvas)!;
    expect(img).toBeDefined();
    // Invisible in view (raster shows it), but the REAL opacity is preserved.
    expect(img.opts.opacity).toBe(0);
    const data = img.data as Record<string, unknown>;
    expect(data.originalOpacity).toBe(0.8);
    expect(data.isTransparentImageOverlay).toBe(true);
    expect(data.index).toBe(4);
  });

  it("renders a NEW image overlay VISIBLE at its real opacity (not a hit-target)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [imageElement({ style: { opacity: 0.9 } })], // no index → newly added
      fabricMock,
      { resolveImageUrl: (u: string) => u },
    );
    const img = findImage(canvas)!;
    expect(img.opts.opacity).toBe(0.9);
    const data = img.data as Record<string, unknown>;
    expect(data.originalOpacity).toBe(0.9);
    expect(data.isTransparentImageOverlay).toBe(false);
    expect(data.index).toBeUndefined();
  });

  it("reveals a parsed image overlay on selection and re-hides it on clear", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [imageElement({ index: 2, style: { opacity: 0.75 } })],
      fabricMock,
      { resolveImageUrl: (u: string) => u },
    );
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;
    const img = findImage(canvas)!;
    expect(img.opts.opacity).toBe(0); // invisible in view…

    fire("selection:created", { selected: [img] });
    expect(img.opts.opacity).toBe(0.75); // …flashed at real opacity while selected…

    fire("selection:cleared", {});
    expect(img.opts.opacity).toBe(0); // …re-hidden on deselect.
  });

  it("does NOT reveal/re-hide a NEW image overlay (stays visible)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [imageElement({ style: { opacity: 0.9 } })], // no index → new
      fabricMock,
      { resolveImageUrl: (u: string) => u },
    );
    const fire = (canvas as unknown as { fire: (e: string, p: unknown) => void })
      .fire;
    const img = findImage(canvas)!;
    expect(img.opts.opacity).toBe(0.9);
    fire("selection:created", { selected: [img] });
    expect(img.opts.opacity).toBe(0.9); // untouched (no isTransparentImageOverlay)
    fire("selection:cleared", {});
    expect(img.opts.opacity).toBe(0.9); // never forced to 0
  });

  it("stacks a parsed image overlay BELOW text (pitch-deck) — engine order beats promise order", async () => {
    const canvas = makeCanvas();
    // PDF background already on the canvas — must stay pinned at index 0.
    const bg = new FakeObj();
    bg.data = { isPdfBackground: true };
    (canvas as unknown as { add: (o: FakeObj) => void }).add(bg);

    // FabricImage that resolves imgB BEFORE imgA (the reverse of engine order),
    // so canvas.add fires B then A — proving the final z-order uses the engine
    // paint order, NOT the promise-resolution order.
    const oooFabric = {
      ...fabricMock,
      FabricImage: {
        fromURL: vi.fn(
          (url: string) =>
            new Promise<FakeObj>((resolve) =>
              setTimeout(() => resolve(new FakeObj()), url === "imgB" ? 0 : 20),
            ),
        ),
      },
    } as unknown as typeof import("fabric");

    const mkImg = (id: string, index: number, url: string): Element =>
      imageElement({
        elementId: id,
        index,
        bounds: { x: 0, y: 0, width: 400, height: 300 },
        source: {
          type: "embedded",
          dataUrl: url,
          originalDimensions: { width: 400, height: 300 },
        },
      });
    const text = textElement({
      elementId: "t",
      content: "Slide title",
      bounds: { x: 10, y: 20, width: 200, height: 14 },
    });

    await renderElementsOverlay(
      canvas,
      [mkImg("imgA", 0, "imgA"), text, mkImg("imgB", 1, "imgB")],
      oooFabric,
      { resolveImageUrl: (u: string) => u },
    );

    const objs = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const idxOf = (id: string) =>
      objs.findIndex(
        (o) =>
          (o.data as Record<string, unknown> | undefined)?.elementId === id,
      );
    // Background stays at the very bottom.
    expect(objs[0]).toBe(bg);
    const iA = idxOf("imgA");
    const iB = idxOf("imgB");
    const iT = idxOf("t");
    // Both parsed images sit BELOW the text overlay (no more click-stealing).
    expect(iA).toBeLessThan(iT);
    expect(iB).toBeLessThan(iT);
    // Image-vs-image follows engine paint order, despite B resolving first.
    expect(iA).toBeLessThan(iB);
  });
});

// --- Paragraph grouping (Word-like multi-line editing) -----------------------

/**
 * A groupable text run: same style by default, body-text size 12, left edge at
 * x=40, regular line gap of 14 (≈ fontSize·lineHeight). Override bounds/content/
 * style to model the lines of a paragraph (or a deliberate style break).
 */
function paraRun(
  elementId: string,
  y: number,
  over: Partial<{
    x: number;
    width: number;
    content: string;
    index: number;
    style: Record<string, unknown>;
    linkUrl: string;
  }> = {},
): Element {
  return {
    type: "text",
    elementId,
    bounds: { x: over.x ?? 40, y, width: over.width ?? 300, height: 12 },
    visible: true,
    locked: false,
    content: over.content ?? `line ${elementId}`,
    ...(over.index !== undefined ? { index: over.index } : {}),
    ...(over.linkUrl ? { linkUrl: over.linkUrl } : {}),
    style: {
      fontSize: 12,
      color: "#000000",
      fontFamily: "Helvetica",
      lineHeight: 1.2,
      textAlign: "left",
      originalFont: "ABCDEF+Body",
      ...(over.style ?? {}),
    },
  } as unknown as Element;
}

describe("groupTextRunsIntoParagraphs (pure)", () => {
  it("groups consecutive same-style, regularly-spaced, left-aligned runs", () => {
    const runs = [
      paraRun("a", 100),
      paraRun("b", 114),
      paraRun("c", 128),
    ];
    const { paragraphs, standalone } = groupTextRunsIntoParagraphs(runs);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b", "c"]);
    expect(standalone).toHaveLength(0);
  });

  it("does NOT group a single isolated line (title/label stays standalone)", () => {
    const { paragraphs, standalone } = groupTextRunsIntoParagraphs([
      paraRun("title", 50),
    ]);
    expect(paragraphs).toHaveLength(0);
    expect(standalone).toHaveLength(1);
  });

  it("breaks the paragraph on a font-size change (heading line)", () => {
    const runs = [
      paraRun("h", 100, { style: { fontSize: 20 } }), // heading
      paraRun("b1", 120),
      paraRun("b2", 134),
    ];
    const { paragraphs, standalone } = groupTextRunsIntoParagraphs(runs);
    // The heading stays alone; the two body lines form a paragraph.
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["b1", "b2"]);
    expect(standalone.map((r) => r.elementId)).toContain("h");
  });

  it("breaks on a colour change (a differently-coloured note)", () => {
    const runs = [
      paraRun("a", 100),
      paraRun("b", 114, { style: { color: "#ff0000" } }),
    ];
    const { paragraphs } = groupTextRunsIntoParagraphs(runs);
    // Two single lines of different colour → no paragraph (each < 2 lines).
    expect(paragraphs).toHaveLength(0);
  });

  it("breaks on a large vertical gap (blank line / new block)", () => {
    const runs = [
      paraRun("a", 100),
      paraRun("b", 114),
      paraRun("c", 300), // far below → new block
    ];
    const { paragraphs, standalone } = groupTextRunsIntoParagraphs(runs);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b"]);
    expect(standalone.map((r) => r.elementId)).toContain("c");
  });

  it("does NOT group runs in different columns (no horizontal overlap)", () => {
    const runs = [
      paraRun("L1", 100, { x: 40, width: 100 }),
      paraRun("R1", 100, { x: 400, width: 100 }), // same row, other column
      paraRun("L2", 114, { x: 40, width: 100 }),
      paraRun("R2", 114, { x: 400, width: 100 }),
    ];
    const { paragraphs } = groupTextRunsIntoParagraphs(runs);
    // Left column lines group together; right column lines group together — but
    // never across columns.
    expect(paragraphs).toHaveLength(2);
    for (const p of paragraphs) {
      const xs = p.runs.map((r) => r.bounds.x);
      expect(new Set(xs).size).toBe(1); // each paragraph is a single column
    }
  });

  it("does NOT fold a hyperlink run into a paragraph", () => {
    const runs = [
      paraRun("a", 100),
      paraRun("link", 114, { linkUrl: "https://example.com" }),
      paraRun("c", 128),
    ];
    const { paragraphs, standalone } = groupTextRunsIntoParagraphs(runs);
    // The link stays standalone; the non-link neighbours are NOT contiguous
    // through it (different gap), so they remain standalone too.
    expect(standalone.map((r) => r.elementId)).toContain("link");
    const grouped = paragraphs.flatMap((p) => p.runs.map((r) => r.elementId));
    expect(grouped).not.toContain("link");
  });

  it("does NOT group misaligned left edges (different indentation)", () => {
    const runs = [
      paraRun("a", 100, { x: 40 }),
      paraRun("b", 114, { x: 120 }), // indented far right → not the same block
    ];
    const { paragraphs } = groupTextRunsIntoParagraphs(runs);
    expect(paragraphs).toHaveLength(0);
  });

  it("groups lines that use DIFFERENT subsets of the SAME /BaseFont (prefix-aware)", () => {
    // originalFont now carries the exact subset (prefix kept). CERFA-style forms
    // paint consecutive lines of one paragraph with disjoint subsets of the same
    // font ("ABCDEF+X" vs "GHIJKL+X"); comparing the RAW originalFont would split
    // the paragraph. The subset prefix must be stripped so they still coalesce.
    const runs = [
      paraRun("a", 100, { style: { originalFont: "ABCDEF+TimesNewRomanPSMT" } }),
      paraRun("b", 114, { style: { originalFont: "GHIJKL+TimesNewRomanPSMT" } }),
    ];
    const { paragraphs } = groupTextRunsIntoParagraphs(runs);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b"]);
  });

  it("does NOT group lines whose subsets denote DIFFERENT /BaseFonts", () => {
    const runs = [
      paraRun("a", 100, { style: { originalFont: "ABCDEF+TimesNewRomanPSMT" } }),
      paraRun("b", 114, { style: { originalFont: "GHIJKL+ArialMT" } }),
    ];
    const { paragraphs } = groupTextRunsIntoParagraphs(runs);
    expect(paragraphs).toHaveLength(0);
  });
});

describe("measuredLineHeightMultiple (pure)", () => {
  const run = (y: number): TextRun => paraRun(`r${y}`, y) as TextRun;

  it("derives the real ~10.5pt CERFA advance (≈1.05), NOT Word's 1.2", () => {
    // CERFA intro body: 10pt font, real line advance ~10.5pt → multiple ~1.05.
    const runs = [run(99.1), run(109.6), run(120.1), run(130.6)];
    const m = measuredLineHeightMultiple(runs, 10);
    expect(m).toBeCloseTo(1.05, 1);
    expect(m).toBeLessThan(1.2); // the fix: tighter than the hardcoded default
  });

  it("uses the MEDIAN so one blank-line gap cannot inflate the spacing", () => {
    // Four lines at ~10.5pt with a single 14pt sub-paragraph break in the middle.
    const runs = [run(100), run(110.5), run(124.5), run(135)];
    // gaps sorted: 10.5, 10.5, 14 → median index floor((3-1)/2)=1 → 10.5.
    expect(measuredLineHeightMultiple(runs, 10)).toBeCloseTo(1.05, 1);
  });

  it("falls back to 1.2 for a single line or degenerate input", () => {
    expect(measuredLineHeightMultiple([run(100)], 10)).toBe(1.2);
    expect(measuredLineHeightMultiple([], 10)).toBe(1.2);
    expect(measuredLineHeightMultiple([run(100), run(110)], 0)).toBe(1.2);
  });

  it("ignores same-line runs (≈0 vertical gap)", () => {
    // Two runs on the SAME visual line (left + right column) then a real 2nd line.
    const runs = [run(100), run(100), run(110.5)];
    expect(measuredLineHeightMultiple(runs, 10)).toBeCloseTo(1.05, 1);
  });

  it("clamps an absurd advance into a sane range", () => {
    expect(measuredLineHeightMultiple([run(0), run(1000)], 10)).toBe(3); // upper clamp
    expect(measuredLineHeightMultiple([run(0), run(1)], 10)).toBe(0.8); // lower clamp
  });
});

describe("hasUniformLineAdvance (pure)", () => {
  const run = (y: number): TextRun => paraRun(`r${y}`, y) as TextRun;

  it("is true for evenly-spaced lines (uniform Word-like paragraph)", () => {
    expect(hasUniformLineAdvance([run(100), run(110), run(120), run(130)])).toBe(
      true,
    );
  });

  it("is FALSE for the CERFA intro's mixed body/sub-paragraph advances", () => {
    // Real CERFA intro y's: ~10.5pt body advance with two ~14pt breaks → a
    // single Textbox lineHeight would drift, so it must render per-run.
    const runs = [99.1, 109.6, 119.7, 130.4, 144.3, 154.3, 168.1, 178.1].map(run);
    expect(hasUniformLineAdvance(runs)).toBe(false);
  });

  it("is trivially true for < 3 lines (at most one gap)", () => {
    expect(hasUniformLineAdvance([run(100), run(110)])).toBe(true);
    expect(hasUniformLineAdvance([run(100)])).toBe(true);
  });

  it("ignores same-line runs when judging uniformity", () => {
    // left+right run on each of two evenly-spaced lines → uniform.
    const runs = [run(100), run(100), run(110), run(110), run(120)];
    expect(hasUniformLineAdvance(runs)).toBe(true);
  });
});

describe("isCoherentCoalescedBlock (pure)", () => {
  // fontSize defaults to 12 ⇒ same-line < 4.8, contiguity > 30, xSpread > 36.
  const run = (y: number, x = 40): TextRun => paraRun(`r${y}_${x}`, y, { x }) as TextRun;
  const withSegments = (y: number): TextRun =>
    ({ ...(paraRun(`s${y}`, y) as unknown as TextRun), segments: [
      { text: "a", bounds: { x: 40, y, width: 6, height: 8 } },
      { text: "b", bounds: { x: 60, y, width: 6, height: 8 } },
    ] }) as unknown as TextRun;

  it("accepts a genuine 1-run-per-line, left-aligned, line-contiguous block", () => {
    expect(isCoherentCoalescedBlock([run(100), run(114), run(128)])).toBe(true);
  });

  it("rejects a block containing a justified / positioned (segmented) run", () => {
    // A TJ-positioned run's per-word geometry can't survive a wrapped Textbox.
    expect(isCoherentCoalescedBlock([run(100), withSegments(114)])).toBe(false);
  });

  it("rejects two runs on the SAME visual line (they would stack vertically)", () => {
    expect(isCoherentCoalescedBlock([run(100), run(100, 300)])).toBe(false);
  });

  it("rejects a footer↔header fusion (a jump far larger than one line)", () => {
    // The lib's pageBlocks mis-groups a footer run (y≈22) with a header run
    // (y≈792) into one "paragraph"/"cell" — a single Textbox cannot span it.
    expect(isCoherentCoalescedBlock([run(22), run(792)])).toBe(false);
  });

  it("rejects horizontally scattered runs (a space next to a far-away rule)", () => {
    // Two runs one line apart but 260pt apart in x → a left-aligned Textbox would
    // reflow the right run to the block's min-x. Not a single column.
    expect(isCoherentCoalescedBlock([run(100, 40), run(114, 300)])).toBe(false);
  });

  it("is trivially true for < 2 runs (never coalesced anyway)", () => {
    expect(isCoherentCoalescedBlock([run(100)])).toBe(true);
    expect(isCoherentCoalescedBlock([])).toBe(true);
  });
});

describe("renderElementsOverlay — justified-run segments", () => {
  it("paints ONE positioned IText per segment (not a single drifting box), all sharing the run's elementId/index", async () => {
    const canvas = makeCanvas();
    // A justified footer run the engine split into two positioned fragments.
    await renderElementsOverlay(
      canvas,
      [
        textElement({
          elementId: "run7",
          index: 7,
          content: "peuvent faire l'objet",
          bounds: { x: 30, y: 810, width: 40, height: 6.5 },
          style: { fontSize: 6.5, fontFamily: "Times New Roman" },
          segments: [
            { text: "peuvent faire", bounds: { x: 30, y: 810, width: 36, height: 6.5 } },
            { text: "l'objet", bounds: { x: 70, y: 810, width: 13, height: 6.5 } },
          ],
        }),
      ],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const segTexts = objects.filter(
      (o) => o instanceof IText && (o.data as Record<string, unknown>)?.isRunSegment === true,
    ) as IText[];
    expect(segTexts).toHaveLength(2);
    // Fragments carry the fragment text, at their own left, sharing run identity.
    expect(segTexts.map((o) => o.text)).toEqual(["peuvent faire", "l'objet"]);
    expect(segTexts.map((o) => o.opts.left)).toEqual([30, 70]);
    for (const o of segTexts) {
      expect((o.data as Record<string, unknown>).elementId).toBe("run7");
      expect((o.data as Record<string, unknown>).index).toBe(7);
    }
    // No extra single-box IText for the run (the fragments replace it).
    const plain = objects.filter(
      (o) => o instanceof IText && (o.data as Record<string, unknown>)?.isRunSegment !== true,
    );
    expect(plain).toHaveLength(0);
  });

  it("renders a plain run (no segments) as a single box, unchanged", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, [textElement()], fabricMock);
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    expect(
      objects.filter((o) => o instanceof IText && (o.data as Record<string, unknown>)?.isRunSegment === true),
    ).toHaveLength(0);
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(1);
  });
});

describe("applyFallbackWidthFit (pure)", () => {
  function fitObj(width: number) {
    const obj = {
      width,
      scaleX: 1,
      set(patch: { scaleX: number }) {
        this.scaleX = patch.scaleX;
      },
    };
    return obj;
  }

  it("applies a BOUNDED scaleX for a FALLBACK font that renders wider than bounds", () => {
    const obj = fitObj(110); // measured 110 vs target 100 → ratio 0.909... clamped
    const scaleX = applyFallbackWidthFit(obj, 100, /* usingEmbeddedFont */ false);
    // target/measured = 0.9090… < 0.92 → clamped UP to the 0.92 floor.
    expect(scaleX).toBeCloseTo(0.92, 5);
    expect(obj.scaleX).toBeCloseTo(0.92, 5);
  });

  it("uses the exact ratio when it sits inside [0.92, 1] (micro-overflow)", () => {
    const obj = fitObj(105); // 100/105 = 0.952… within bounds
    const scaleX = applyFallbackWidthFit(obj, 100, false);
    expect(scaleX).toBeCloseTo(100 / 105, 5);
    expect(scaleX).toBeGreaterThanOrEqual(0.92);
    expect(scaleX).toBeLessThanOrEqual(1);
    expect(obj.scaleX).toBeCloseTo(100 / 105, 5);
  });

  it("applies NO scaleX for the EXACT embedded font even when wider", () => {
    const obj = fitObj(140); // would overflow, but exact metrics must be trusted
    const scaleX = applyFallbackWidthFit(obj, 100, /* usingEmbeddedFont */ true);
    expect(scaleX).toBe(1);
    expect(obj.scaleX).toBe(1); // untouched — never squash exact text
  });

  it("never EXPANDS a fallback that fits (measured ≤ target)", () => {
    const obj = fitObj(80);
    const scaleX = applyFallbackWidthFit(obj, 100, false);
    expect(scaleX).toBe(1);
    expect(obj.scaleX).toBe(1);
  });

  it("is a no-op when the measured width is unknown (0/undefined)", () => {
    const obj = fitObj(0);
    expect(applyFallbackWidthFit(obj, 100, false)).toBe(1);
    expect(obj.scaleX).toBe(1);
  });
});

describe("applySegmentWidthFit (pure)", () => {
  function fitObj(width: number) {
    return {
      width,
      scaleX: 1,
      set(patch: { scaleX: number }) {
        this.scaleX = patch.scaleX;
      },
    };
  }

  it("fits a word rendered WIDER than its /Widths box — even for an EMBEDDED font", () => {
    // The whole point vs applyFallbackWidthFit: a per-word fragment must be shrunk to
    // its /Widths advance whatever the font, so browser hmtx over-width never eats the
    // inter-word gap. 110 measured vs 100 target → exact ratio (inside the 0.5 floor).
    const obj = fitObj(110);
    const scaleX = applySegmentWidthFit(obj, 100);
    expect(scaleX).toBeCloseTo(100 / 110, 5);
    expect(obj.scaleX).toBeCloseTo(100 / 110, 5);
  });

  it("never EXPANDS a word that already fits (measured ≤ target ⇒ keep the gap)", () => {
    const obj = fitObj(80);
    expect(applySegmentWidthFit(obj, 100)).toBe(1);
    expect(obj.scaleX).toBe(1);
  });

  it("clamps the shrink at a 0.5 floor so a mis-measured fallback never collapses", () => {
    const obj = fitObj(400); // ratio 0.25 → clamped to 0.5
    const scaleX = applySegmentWidthFit(obj, 100);
    expect(scaleX).toBe(0.5);
    expect(obj.scaleX).toBe(0.5);
  });

  it("is a no-op when the measured width is unknown (0)", () => {
    const obj = fitObj(0);
    expect(applySegmentWidthFit(obj, 100)).toBe(1);
    expect(obj.scaleX).toBe(1);
  });
});

describe("renderElementsOverlay — paragraph rendering", () => {
  it("renders a paragraph as ONE editable Textbox with lines joined by \\n", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { content: "First line", index: 5 }),
        paraRun("b", 114, { content: "Second line", index: 6 }),
        paraRun("c", 128, { content: "Third line", index: 7 }),
      ],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const tb = objects.find((o) => o instanceof Textbox) as Textbox | undefined;
    const itexts = objects.filter((o) => o instanceof IText);
    expect(tb).toBeDefined();
    // No standalone IText for the folded runs.
    expect(itexts).toHaveLength(0);
    expect(tb!.text).toBe("First line\nSecond line\nThird line");
    const data = tb!.data as Record<string, unknown>;
    expect(data.isParagraph).toBe(true);
    expect(data.type).toBe("text");
    // The block adopts the FIRST run's identity + carries all source runs.
    expect(data.elementId).toBe("a");
    const stashed = data.paragraphRuns as Array<{ elementId: string; index?: number }>;
    expect(stashed.map((r) => r.elementId)).toEqual(["a", "b", "c"]);
    expect(stashed.map((r) => r.index)).toEqual([5, 6, 7]);
  });

  it("renders a NON-UNIFORM block (mixed body/sub-paragraph advance) as per-run ITexts, not a drifting Textbox", async () => {
    // CERFA intro shape: ~10.5pt body advance with one wider ~14pt break. A
    // Fabric Textbox's single lineHeight cannot reproduce this without drift, so
    // the block must NOT coalesce — every line renders 1:1 at its own bounds.y.
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { content: "line a" }),
        paraRun("b", 110.5, { content: "line b" }),
        paraRun("c", 121, { content: "line c" }),
        paraRun("d", 135, { content: "line d" }), // +14 break → non-uniform
      ],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(4);
  });

  it("drives a coalesced Textbox's lineHeight from the runs' measured advance, not the hardcoded 1.2", async () => {
    // Uniform block, 12pt font, real 14pt advance → lineHeight 14/12 ≈ 1.166,
    // NOT the extractor's per-run style.lineHeight of 1.2.
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [paraRun("a", 100), paraRun("b", 114), paraRun("c", 128)],
      fabricMock,
    );
    const tb = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Textbox,
    ) as Textbox | undefined;
    expect(tb).toBeDefined();
    expect(tb!.opts.lineHeight as number).toBeCloseTo(14 / 12, 3);
  });

  it("keeps line-by-line IText when groupParagraphs is disabled", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [paraRun("a", 100), paraRun("b", 114), paraRun("c", 128)],
      fabricMock,
      { groupParagraphs: false },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(3);
  });

  it("uses the embedded FontFace for a paragraph Textbox when available", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [paraRun("a", 100), paraRun("b", 114)],
      fabricMock,
      { getFontFaceName: () => "gigapdf-doc-para" },
    );
    const tb = (canvas as unknown as { _objects: FakeObj[] })._objects.find(
      (o) => o instanceof Textbox,
    ) as Textbox;
    expect(tb.opts.fontFamily).toBe("gigapdf-doc-para");
    expect((tb.data as Record<string, unknown>).usingEmbeddedFont).toBe(true);
  });

  it("leaves a lone line as a standalone IText (no Textbox)", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(canvas, [paraRun("only", 100)], fabricMock);
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(1);
  });
});

// --- Engine block grouping (lib = source of structure) -----------------------

describe("pageBlockGroupsToParagraphs (pure)", () => {
  it("coalesces a paragraph block by matching source_index → element.index", () => {
    // Runs deliberately NOT positioned like a heuristic paragraph (varying x,
    // irregular gaps): only the engine grouping ties them together.
    const elements = [
      paraRun("a", 100, { index: 11, x: 40 }),
      paraRun("b", 400, { index: 12, x: 220 }),
      paraRun("c", 105, { index: 13, x: 80 }),
    ];
    const blockGroups: PageBlockGroup[] = [
      { kind: "paragraph", sourceIndices: [11, 12, 13] },
    ];
    const { paragraphs, standalone } = pageBlockGroupsToParagraphs(
      elements,
      blockGroups,
    );
    expect(paragraphs).toHaveLength(1);
    // Reading order follows the engine sourceIndices order, not the geometry.
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b", "c"]);
    expect(standalone).toHaveLength(0);
  });

  it("treats a heading block (≥2 runs) as a group too", () => {
    const elements = [
      paraRun("h1", 50, { index: 1 }),
      paraRun("h2", 64, { index: 2 }),
    ];
    const { paragraphs } = pageBlockGroupsToParagraphs(elements, [
      { kind: "heading", sourceIndices: [1, 2] },
    ]);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["h1", "h2"]);
  });

  it("skips a missing source_index and drops a group left with <2 runs", () => {
    const elements = [paraRun("a", 100, { index: 5 })];
    const { paragraphs, standalone } = pageBlockGroupsToParagraphs(elements, [
      { kind: "paragraph", sourceIndices: [5, 999] }, // 999 has no element
    ]);
    // Only one run resolved → not worth a Textbox → released to standalone.
    expect(paragraphs).toHaveLength(0);
    expect(standalone.map((r) => r.elementId)).toEqual(["a"]);
  });

  it("never claims the same run for two blocks", () => {
    const elements = [
      paraRun("a", 100, { index: 1 }),
      paraRun("b", 114, { index: 2 }),
      paraRun("c", 128, { index: 3 }),
    ];
    const { paragraphs } = pageBlockGroupsToParagraphs(elements, [
      { kind: "paragraph", sourceIndices: [1, 2] },
      { kind: "paragraph", sourceIndices: [2, 3] }, // 2 already consumed
    ]);
    // First block keeps [1,2]; second resolves only [3] → dropped.
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b"]);
  });

  it("ignores non-paragraph/heading kinds (tables/lists keep element render)", () => {
    const elements = [
      paraRun("a", 100, { index: 1 }),
      paraRun("b", 114, { index: 2 }),
    ];
    const { paragraphs, standalone } = pageBlockGroupsToParagraphs(elements, [
      { kind: "table", sourceIndices: [1, 2] },
    ]);
    expect(paragraphs).toHaveLength(0);
    expect(standalone.map((r) => r.elementId)).toEqual(["a", "b"]);
  });

  it("leaves a run without an index standalone (not addressable by the lib)", () => {
    const withIdx = paraRun("a", 100, { index: 1 });
    const noIdx = paraRun("b", 114); // no index
    const { paragraphs, standalone } = pageBlockGroupsToParagraphs(
      [withIdx, noIdx],
      [{ kind: "paragraph", sourceIndices: [1] }],
    );
    expect(paragraphs).toHaveLength(0);
    expect(standalone.map((r) => r.elementId)).toEqual(["a", "b"]);
  });

  it("does NOT fold a hyperlink run even if the block lists it", () => {
    const elements = [
      paraRun("a", 100, { index: 1 }),
      paraRun("link", 114, { index: 2, linkUrl: "https://example.com" }),
      paraRun("c", 128, { index: 3 }),
    ];
    const { paragraphs, standalone } = pageBlockGroupsToParagraphs(elements, [
      { kind: "paragraph", sourceIndices: [1, 2, 3] },
    ]);
    // The link is ungroupable → excluded; the remaining two still form a block.
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "c"]);
    expect(standalone.map((r) => r.elementId)).toEqual(["link"]);
  });
});

describe("renderElementsOverlay — engine blockGroups drive paragraph render", () => {
  it("uses blockGroups over the positional heuristic and round-trips source indices", async () => {
    const canvas = makeCanvas();
    // A COHERENT block (one run per line, one normal line-advance apart) but with
    // a small left-edge offset (20pt > the heuristic's 6pt xTol) that the
    // positional heuristic rejects — so a Textbox can only appear if the engine
    // blockGroups are honoured. The geometry still passes the coherence gate
    // (contiguous, single-column, no segments) so it stays coalescable.
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 21, content: "Intro line one" }),
        paraRun("b", 114, { index: 22, content: "Intro line two", x: 60 }),
      ],
      fabricMock,
      { blockGroups: [{ kind: "paragraph", sourceIndices: [21, 22] }] },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const tb = objects.find((o) => o instanceof Textbox) as Textbox | undefined;
    expect(tb).toBeDefined();
    expect(tb!.text).toBe("Intro line one\nIntro line two");
    const data = tb!.data as Record<string, unknown>;
    expect(data.isParagraph).toBe(true);
    const stashed = data.paragraphRuns as Array<{
      elementId: string;
      index?: number;
    }>;
    expect(stashed.map((r) => r.elementId)).toEqual(["a", "b"]);
    // Engine source indices preserved → lossless replaceText on save.
    expect(stashed.map((r) => r.index)).toEqual([21, 22]);
    // No standalone IText for the folded runs.
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(0);
  });

  it("falls back to the heuristic when no blockGroups are provided", async () => {
    const canvas = makeCanvas();
    // Same geometry, but WITHOUT blockGroups → the heuristic keeps them standalone
    // (the 20pt left-edge offset exceeds its 6pt xTol).
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 21, content: "L1" }),
        paraRun("b", 114, { index: 22, content: "L2", x: 60 }),
      ],
      fabricMock,
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(2);
  });
});

// --- Table / list reconstruction (lib = source of structure) -----------------

/** A `table` PageBlockGroup with the given grid of per-cell source indices. */
function tableGroup(grid: number[][][]): PageBlockGroup {
  const cells = grid.flatMap((row, r) =>
    row.map((sourceIndices, c) => ({
      row: r,
      col: c,
      colSpan: 1,
      rowSpan: 1,
      sourceIndices,
    })),
  );
  return {
    kind: "table",
    sourceIndices: [],
    table: {
      rowCount: grid.length,
      colCount: grid[0]?.length ?? 0,
      colWidths: Array.from({ length: grid[0]?.length ?? 0 }, () => 100),
      rowHeights: grid.map(() => 20),
      cells,
    },
  };
}

/** A `list` PageBlockGroup whose items carry the given source indices. */
function listGroup(items: number[][]): PageBlockGroup {
  return {
    kind: "list",
    sourceIndices: [],
    list: {
      ordered: false,
      marker: "-",
      items: items.map((sourceIndices) => ({ level: 0, sourceIndices })),
    },
  };
}

describe("pageBlockGroupsToTablesAndLists (pure)", () => {
  it("folds a multi-run table cell into a paragraph group", () => {
    const elements = [
      paraRun("a", 100, { index: 1, content: "Cell L1" }),
      paraRun("b", 200, { index: 2, content: "Cell L2", x: 220 }),
      paraRun("c", 300, { index: 3, content: "Other cell" }),
    ];
    // Cell[0][0] = runs 1,2 (multi-line → folds); cell[0][1] = run 3 (single → not).
    const { paragraphs, standalone } = pageBlockGroupsToTablesAndLists(elements, [
      tableGroup([[[1, 2], [3]]]),
    ]);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b"]);
    // The single-run cell stays standalone (already an identically-placed IText).
    expect(standalone.map((r) => r.elementId)).toEqual(["c"]);
  });

  it("leaves a table with no resolvable cell runs fully standalone", () => {
    // Cells reference indices that no element carries (the `source_index: null`
    // path) → nothing folded, every run stays element-rendered.
    const elements = [
      paraRun("a", 100, { index: 1 }),
      paraRun("b", 114, { index: 2 }),
    ];
    const { paragraphs, standalone } = pageBlockGroupsToTablesAndLists(elements, [
      tableGroup([[[91], [92]], [[93], [94]]]),
    ]);
    expect(paragraphs).toHaveLength(0);
    expect(standalone.map((r) => r.elementId)).toEqual(["a", "b"]);
  });

  it("folds a multi-run list item into a paragraph group", () => {
    const elements = [
      paraRun("a", 100, { index: 10, content: "Item line 1" }),
      paraRun("b", 200, { index: 11, content: "Item line 2", x: 220 }),
    ];
    const { paragraphs, standalone } = pageBlockGroupsToTablesAndLists(elements, [
      listGroup([[10, 11]]),
    ]);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b"]);
    expect(standalone).toHaveLength(0);
  });

  it("ignores paragraph/heading groups (handled by the paragraph path)", () => {
    const elements = [
      paraRun("a", 100, { index: 1 }),
      paraRun("b", 114, { index: 2 }),
    ];
    const { paragraphs, standalone } = pageBlockGroupsToTablesAndLists(elements, [
      { kind: "paragraph", sourceIndices: [1, 2] },
    ]);
    expect(paragraphs).toHaveLength(0);
    expect(standalone.map((r) => r.elementId)).toEqual(["a", "b"]);
  });

  it("never claims the same run for two cells", () => {
    const elements = [
      paraRun("a", 100, { index: 1 }),
      paraRun("b", 114, { index: 2 }),
      paraRun("c", 128, { index: 3 }),
    ];
    // Cell A = [1,2], cell B = [2,3] (2 already consumed → B resolves only [3]).
    const { paragraphs } = pageBlockGroupsToTablesAndLists(elements, [
      tableGroup([[[1, 2], [2, 3]]]),
    ]);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.runs.map((r) => r.elementId)).toEqual(["a", "b"]);
  });
});

describe("renderElementsOverlay — table/list reconstruction", () => {
  it("renders a multi-run table cell as ONE editable Textbox with lossless runs", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 1, content: "Cell line A" }),
        paraRun("b", 114, { index: 2, content: "Cell line B" }),
      ],
      fabricMock,
      { blockGroups: [tableGroup([[[1, 2]]])] },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const tb = objects.find((o) => o instanceof Textbox) as Textbox | undefined;
    expect(tb).toBeDefined();
    expect(tb!.text).toBe("Cell line A\nCell line B");
    const data = tb!.data as Record<string, unknown>;
    // Reuses the paragraph decompose-save path → lossless replaceText.
    expect(data.isParagraph).toBe(true);
    const stashed = data.paragraphRuns as Array<{ elementId: string; index?: number }>;
    expect(stashed.map((r) => r.index)).toEqual([1, 2]);
    // No standalone IText for the folded cell runs.
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(0);
  });

  it("renders a multi-run list item as ONE editable Textbox", async () => {
    const canvas = makeCanvas();
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 5, content: "Bullet line 1" }),
        paraRun("b", 114, { index: 6, content: "Bullet line 2" }),
      ],
      fabricMock,
      { blockGroups: [listGroup([[5, 6]])] },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    const tb = objects.find((o) => o instanceof Textbox) as Textbox;
    expect(tb).toBeDefined();
    expect(tb.text).toBe("Bullet line 1\nBullet line 2");
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(0);
  });

  it("FALLBACK: a table whose cell runs don't resolve renders element-by-element (no regression)", async () => {
    const canvas = makeCanvas();
    // The blockGroup references indices no element carries (source_index:null path).
    await renderElementsOverlay(
      canvas,
      [
        paraRun("a", 100, { index: 1, content: "X" }),
        paraRun("b", 300, { index: 2, content: "Y", x: 300 }),
      ],
      fabricMock,
      { blockGroups: [tableGroup([[[91], [92]]])] },
    );
    const objects = (canvas as unknown as { _objects: FakeObj[] })._objects;
    // No Textbox folded; both runs stay standalone IText — identical to today.
    expect(objects.filter((o) => o instanceof Textbox)).toHaveLength(0);
    expect(objects.filter((o) => o instanceof IText)).toHaveLength(2);
  });
});
