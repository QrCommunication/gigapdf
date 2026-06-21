/**
 * Tests for the editor-only user-layer actions on the document store
 * (Phase 2 "Layer Groups").
 *
 * Guards the contract the layers panel + properties panel depend on:
 *  - createLayer appends with order = max+1
 *  - deleteLayer removes the layer AND detaches every member element
 *  - rename / reorder mutate only the targeted layer
 *  - setLayerVisible / setLayerLocked cascade to member elements in a single
 *    batched state pass (verified by snapshotting state once after the call)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "../stores/document-store";
import type { Element, PageObject, UUID } from "@giga-pdf/types";

function makeElement(id: string, layerId: string | null): Element {
  return {
    elementId: id as UUID,
    type: "text",
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: layerId as UUID | null,
    locked: false,
    visible: true,
    content: `el ${id}`,
    style: {} as never,
    ocrConfidence: null,
    linkUrl: null,
    linkPage: null,
  } as unknown as Element;
}

function makePage(pageId: string, pageNumber: number, elements: Element[]): PageObject {
  return {
    pageId: pageId as UUID,
    pageNumber,
    dimensions: { width: 612, height: 792, rotation: 0 },
    mediaBox: { x: 0, y: 0, width: 612, height: 792 },
    cropBox: null,
    elements,
    preview: { thumbnailUrl: null, fullUrl: null },
  };
}

function findElement(elementId: string): Element | undefined {
  for (const page of useDocumentStore.getState().pages) {
    const el = page.elements.find((e) => e.elementId === elementId);
    if (el) return el;
  }
  return undefined;
}

describe("document-store user layers", () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
    useDocumentStore
      .getState()
      .setDocument("doc-1" as UUID, "Doc", [
        makePage("p1", 1, [makeElement("a", null), makeElement("b", null)]),
        makePage("p2", 2, [makeElement("c", null)]),
      ]);
  });

  it("starts with no user layers", () => {
    expect(useDocumentStore.getState().layers).toEqual([]);
  });

  it("createLayer appends with order = max + 1 and returns the layer", () => {
    const l1 = useDocumentStore.getState().createLayer("First");
    const l2 = useDocumentStore.getState().createLayer("Second");

    const layers = useDocumentStore.getState().layers;
    expect(layers).toHaveLength(2);
    expect(l1.order).toBe(0);
    expect(l2.order).toBe(1);
    expect(l1.name).toBe("First");
    expect(l1.visible).toBe(true);
    expect(l1.locked).toBe(false);
    expect(l1.layerId).not.toBe(l2.layerId);
    expect(useDocumentStore.getState().isDirty).toBe(true);
  });

  it("renameLayer updates only the targeted layer", () => {
    const l1 = useDocumentStore.getState().createLayer("First");
    const l2 = useDocumentStore.getState().createLayer("Second");

    useDocumentStore.getState().renameLayer(l1.layerId, "Renamed");

    const layers = useDocumentStore.getState().layers;
    expect(layers.find((l) => l.layerId === l1.layerId)?.name).toBe("Renamed");
    expect(layers.find((l) => l.layerId === l2.layerId)?.name).toBe("Second");
  });

  it("reorderLayer changes only the targeted layer's order", () => {
    const l1 = useDocumentStore.getState().createLayer("First");
    const l2 = useDocumentStore.getState().createLayer("Second");

    useDocumentStore.getState().reorderLayer(l1.layerId, 5);

    const layers = useDocumentStore.getState().layers;
    expect(layers.find((l) => l.layerId === l1.layerId)?.order).toBe(5);
    expect(layers.find((l) => l.layerId === l2.layerId)?.order).toBe(1);
  });

  it("deleteLayer removes the layer and detaches member elements (cascade)", () => {
    const layer = useDocumentStore.getState().createLayer("L");
    // Assign elements a + c to the layer via the document store directly.
    useDocumentStore.getState().updatePage("p1" as UUID, {
      elements: [
        { ...makeElement("a", layer.layerId) },
        makeElement("b", null),
      ],
    });
    useDocumentStore.getState().updatePage("p2" as UUID, {
      elements: [{ ...makeElement("c", layer.layerId) }],
    });

    expect(findElement("a")?.layerId).toBe(layer.layerId);
    expect(findElement("c")?.layerId).toBe(layer.layerId);

    useDocumentStore.getState().deleteLayer(layer.layerId);

    expect(useDocumentStore.getState().layers).toHaveLength(0);
    expect(findElement("a")?.layerId).toBeNull();
    expect(findElement("b")?.layerId).toBeNull();
    expect(findElement("c")?.layerId).toBeNull();
  });

  it("setLayerVisible cascades to member elements in one pass", () => {
    const layer = useDocumentStore.getState().createLayer("L");
    useDocumentStore.getState().updatePage("p1" as UUID, {
      elements: [makeElement("a", layer.layerId), makeElement("b", null)],
    });
    useDocumentStore.getState().updatePage("p2" as UUID, {
      elements: [makeElement("c", layer.layerId)],
    });

    useDocumentStore.getState().setLayerVisible(layer.layerId, false);

    // Snapshot state once: cascade must already be applied (single pass).
    const layers = useDocumentStore.getState().layers;
    expect(layers.find((l) => l.layerId === layer.layerId)?.visible).toBe(false);
    expect(findElement("a")?.visible).toBe(false); // member
    expect(findElement("c")?.visible).toBe(false); // member on other page
    expect(findElement("b")?.visible).toBe(true); // non-member untouched

    // Re-show: members flip back, non-member stays.
    useDocumentStore.getState().setLayerVisible(layer.layerId, true);
    expect(findElement("a")?.visible).toBe(true);
    expect(findElement("c")?.visible).toBe(true);
    expect(findElement("b")?.visible).toBe(true);
  });

  it("setLayerLocked cascades to member elements in one pass", () => {
    const layer = useDocumentStore.getState().createLayer("L");
    useDocumentStore.getState().updatePage("p1" as UUID, {
      elements: [makeElement("a", layer.layerId), makeElement("b", null)],
    });

    useDocumentStore.getState().setLayerLocked(layer.layerId, true);

    const layers = useDocumentStore.getState().layers;
    expect(layers.find((l) => l.layerId === layer.layerId)?.locked).toBe(true);
    expect(findElement("a")?.locked).toBe(true); // member
    expect(findElement("b")?.locked).toBe(false); // non-member untouched
  });

  it("setLayerVisible / setLayerLocked are no-ops for unknown layers", () => {
    useDocumentStore.getState().setLayerVisible("nope" as UUID, false);
    useDocumentStore.getState().setLayerLocked("nope" as UUID, true);
    expect(findElement("a")?.visible).toBe(true);
    expect(findElement("a")?.locked).toBe(false);
  });
});
