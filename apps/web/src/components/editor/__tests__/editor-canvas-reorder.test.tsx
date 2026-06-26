/**
 * editor-canvas-reorder.test.tsx
 *
 * Z-order regression guard. Advancing/retreating an element (bringToFront /
 * sendToBack) must persist the new stacking through the DEDICATED reorder op
 * ONLY — `onElementReordered(element, toFront)`. It must NEVER also emit
 * `onElementModified`, which would queue a redundant `update` (redact + re-add)
 * op for unchanged bounds — wasteful and, worse, re-adding the element ON TOP
 * contradicts a sendToBack. A pure reorder therefore enqueues no `update`.
 *
 * The reorder handlers live in the single `EditorCanvas` imperative handle that
 * BOTH the single-page editor and the continuous (Word-like) view mount — the
 * latter via `<EditorCanvas embedded>`. So we drive the handle in BOTH modes.
 *
 * Strategy: mock `fabric` so `new Canvas()` returns a controllable fake we keep
 * a reference to; the component sets `fabricRef.current` to it. We grab the
 * imperative handle via `onCanvasReady`, seed one reorderable Fabric object on
 * the fake canvas, then call the handle's bringToFront / sendToBack and assert
 * on the emitted callbacks. No real Fabric, no wasm engine, no DOM canvas.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, act } from "@testing-library/react";
import type { PageObject } from "@giga-pdf/types";
import { EditorCanvas, type EditorCanvasHandle } from "../editor-canvas";

// --- Capture every fake Canvas the component creates (last = fabricRef.current).
const createdCanvases: FakeCanvas[] = [];

interface FakeCanvas {
  _objects: Array<Record<string, unknown>>;
  bringObjectToFront: ReturnType<typeof vi.fn>;
  sendObjectToBack: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
}

/**
 * A permissive fake `fabric.Canvas`. Known members behave; any other method the
 * giant component happens to call returns a chainable no-op, so the mount never
 * throws on an unstubbed Fabric API. `upperCanvasEl` is undefined so the
 * anchored-zoom path short-circuits its DOM maths in jsdom.
 */
function createFakeCanvas(): FakeCanvas {
  const lower = document.createElement("canvas");
  const objects: Array<Record<string, unknown>> = [];
  const base: Record<string, unknown> = {
    _objects: objects,
    lowerCanvasEl: lower,
    upperCanvasEl: undefined,
    selection: true,
    backgroundColor: "#ffffff",
    defaultCursor: "default",
    skipTargetFind: false,
    width: 600,
    height: 800,
    getObjects: () => objects,
    add: (...o: Array<Record<string, unknown>>) => {
      objects.push(...o);
      return base;
    },
    insertAt: () => base,
    remove: () => base,
    clear: () => {
      objects.length = 0;
    },
    contains: () => false,
    getZoom: () => 1,
    setZoom: () => base,
    setViewportTransform: () => base,
    setDimensions: () => base,
    requestRenderAll: () => {},
    renderAll: () => {},
    toObject: () => ({ version: "test", objects: [] }),
    toJSON: () => ({ version: "test", objects: [] }),
    on: () => base,
    off: () => base,
    fire: () => base,
    getActiveObject: () => null,
    getActiveObjects: () => [],
    setActiveObject: () => base,
    discardActiveObject: () => base,
    bringObjectToFront: vi.fn(),
    sendObjectToBack: vi.fn(),
    dispose: () => Promise.resolve(),
    getElement: () => lower,
    getContext: () => lower.getContext("2d"),
  };
  return new Proxy(base, {
    get(t, prop) {
      if (typeof prop === "symbol") return t[prop as unknown as string];
      if (prop in t) return t[prop];
      if (prop === "then") return undefined; // never look thenable
      return () => base; // chainable no-op for any unstubbed Fabric method
    },
    set(t, prop, value) {
      t[prop as string] = value;
      return true;
    },
  }) as unknown as FakeCanvas;
}

// `new Canvas(el, opts)` returns a fresh fake we keep a reference to.
class FakeCanvasCtor {
  constructor() {
    const inst = createFakeCanvas();
    createdCanvases.push(inst);
    return inst as unknown as FakeCanvasCtor;
  }
}
// Stub constructors for the other Fabric exports the component destructures.
class Stub {}

vi.mock("fabric", () => ({
  Canvas: FakeCanvasCtor,
  Rect: Stub,
  Circle: Stub,
  Ellipse: Stub,
  Triangle: Stub,
  Line: Stub,
  IText: Stub,
  Group: Stub,
  FabricText: Stub,
  FabricImage: Stub,
  Polyline: Stub,
  ActiveSelection: Stub,
}));

// next-intl translator → identity (no i18n provider needed).
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Defensive: the PDF-background renderer is only dynamically imported when a
// documentId is set (we pass none), but stub it so no engine is ever pulled.
vi.mock("@giga-pdf/canvas", () => ({ PDFRenderer: class {} }));

/** Minimal page: empty elements + no documentId → mount skips PDF background. */
const PAGE = {
  pageId: "page-1",
  pageNumber: 1,
  dimensions: { width: 600, height: 800, rotation: 0 },
  elements: [],
} as unknown as PageObject;

/** A parsed rectangle shape Fabric object → serialises to a non-null Element. */
function reorderObject(elementId: string): Record<string, unknown> {
  return {
    type: "rect",
    data: { elementId },
    left: 10,
    top: 20,
    width: 50,
    height: 40,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    skewX: 0,
    skewY: 0,
    selectable: true,
    visible: true,
    opacity: 1,
    fill: "#ff0000",
    stroke: "#000000",
    strokeWidth: 1,
  };
}

beforeEach(() => {
  createdCanvases.length = 0;
});
afterEach(cleanup);

/**
 * Mount EditorCanvas, wait for the fake canvas + imperative handle, seed one
 * reorderable object, and hand back everything the assertions need.
 */
async function mountAndReady(embedded: boolean) {
  const onElementModified = vi.fn();
  const onElementReordered = vi.fn();
  let handle: EditorCanvasHandle | null = null;

  render(
    <EditorCanvas
      page={PAGE}
      documentId={null}
      tool="select"
      zoom={1}
      embedded={embedded}
      onElementModified={onElementModified}
      onElementReordered={onElementReordered}
      onCanvasReady={(h) => {
        handle = h;
      }}
    />,
  );

  await waitFor(() => expect(createdCanvases.length).toBeGreaterThan(0));
  await waitFor(() => expect(handle).not.toBeNull());
  // Let the mount-time loadPage() (which calls canvas.clear()) settle before we
  // seed the object, so clear() can't wipe it.
  await act(async () => {
    await Promise.resolve();
  });

  const canvas = createdCanvases[createdCanvases.length - 1]!;
  return {
    onElementModified,
    onElementReordered,
    getHandle: () => handle as unknown as EditorCanvasHandle,
    canvas,
  };
}

describe("EditorCanvas reorder — single-page (embedded=false)", () => {
  it("bringToFront emits ONLY onElementReordered, never onElementModified", async () => {
    const { onElementModified, onElementReordered, getHandle, canvas } =
      await mountAndReady(false);
    canvas._objects.push(reorderObject("rect-1"));

    await act(async () => {
      getHandle().bringToFront("rect-1");
    });

    expect(canvas.bringObjectToFront).toHaveBeenCalledTimes(1);
    expect(onElementReordered).toHaveBeenCalledTimes(1);
    expect(onElementReordered).toHaveBeenCalledWith(
      expect.objectContaining({ elementId: "rect-1", type: "shape" }),
      true,
    );
    // The crux: a pure reorder queues NO `update` op.
    expect(onElementModified).not.toHaveBeenCalled();
  });

  it("sendToBack emits ONLY onElementReordered(…, false), never onElementModified", async () => {
    const { onElementModified, onElementReordered, getHandle, canvas } =
      await mountAndReady(false);
    canvas._objects.push(reorderObject("rect-2"));

    await act(async () => {
      getHandle().sendToBack("rect-2");
    });

    expect(canvas.sendObjectToBack).toHaveBeenCalledTimes(1);
    expect(onElementReordered).toHaveBeenCalledTimes(1);
    expect(onElementReordered).toHaveBeenCalledWith(
      expect.objectContaining({ elementId: "rect-2", type: "shape" }),
      false,
    );
    expect(onElementModified).not.toHaveBeenCalled();
  });
});

describe("EditorCanvas reorder — continuous mode (embedded=true)", () => {
  it("bringToFront still emits ONLY onElementReordered, never onElementModified", async () => {
    const { onElementModified, onElementReordered, getHandle, canvas } =
      await mountAndReady(true);
    canvas._objects.push(reorderObject("rect-3"));

    await act(async () => {
      getHandle().bringToFront("rect-3");
    });

    expect(onElementReordered).toHaveBeenCalledTimes(1);
    expect(onElementReordered).toHaveBeenCalledWith(
      expect.objectContaining({ elementId: "rect-3" }),
      true,
    );
    expect(onElementModified).not.toHaveBeenCalled();
  });
});
