import { describe, it, expect } from "vitest";
import type { LayerObject, PageObject } from "@giga-pdf/types";
import { buildMembership, mergeSavedLayers } from "../layer-persistence";

/**
 * Minimal page/element fixtures. The helpers only read
 * `pages[].elements[].{elementId, layerId}`, so we cast partial shapes to keep
 * the fixtures readable without constructing full Element discriminated unions.
 */
function page(
  pageId: string,
  elements: Array<{ elementId: string; layerId: string | null }>,
): PageObject {
  return { pageId, elements } as unknown as PageObject;
}

function layer(layerId: string, overrides: Partial<LayerObject> = {}): LayerObject {
  return {
    layerId,
    name: layerId,
    visible: true,
    locked: false,
    opacity: 1,
    print: true,
    order: 0,
    ...overrides,
  };
}

describe("buildMembership", () => {
  it("returns an empty map for no pages", () => {
    expect(buildMembership([])).toEqual({});
  });

  it("collects only elements with a non-null layerId across all pages", () => {
    const pages = [
      page("p1", [
        { elementId: "e1", layerId: "L1" },
        { elementId: "e2", layerId: null },
      ]),
      page("p2", [
        { elementId: "e3", layerId: "L2" },
        { elementId: "e4", layerId: "L1" },
      ]),
    ];

    expect(buildMembership(pages)).toEqual({
      e1: "L1",
      e3: "L2",
      e4: "L1",
    });
  });

  it("ignores elements with undefined layerId (defensive)", () => {
    const pages = [
      page("p1", [{ elementId: "e1" } as { elementId: string; layerId: null }]),
    ];
    expect(buildMembership(pages)).toEqual({});
  });

  it("does not mutate the input pages", () => {
    const pages = [page("p1", [{ elementId: "e1", layerId: "L1" }])];
    const snapshot = JSON.stringify(pages);
    buildMembership(pages);
    expect(JSON.stringify(pages)).toBe(snapshot);
  });
});

describe("mergeSavedLayers", () => {
  const pages = [
    page("p1", [
      { elementId: "e1", layerId: null },
      { elementId: "e2", layerId: null },
    ]),
    page("p2", [{ elementId: "e3", layerId: null }]),
  ];

  it("returns empty layers + membership when nothing is saved", () => {
    expect(mergeSavedLayers(null, pages)).toEqual({ layers: [], membership: {} });
    expect(mergeSavedLayers(undefined, pages)).toEqual({
      layers: [],
      membership: {},
    });
  });

  it("restores layers and keeps membership for existing element + layer", () => {
    const result = mergeSavedLayers(
      {
        layers: [layer("L1"), layer("L2")],
        membership: { e1: "L1", e3: "L2" },
      },
      pages,
    );
    expect(result.layers.map((l) => l.layerId)).toEqual(["L1", "L2"]);
    expect(result.membership).toEqual({ e1: "L1", e3: "L2" });
  });

  it("prunes membership whose elementId no longer exists", () => {
    const result = mergeSavedLayers(
      {
        layers: [layer("L1")],
        membership: { e1: "L1", eGONE: "L1" },
      },
      pages,
    );
    expect(result.membership).toEqual({ e1: "L1" });
  });

  it("prunes membership whose layerId no longer exists", () => {
    const result = mergeSavedLayers(
      {
        layers: [layer("L1")],
        membership: { e1: "L1", e2: "LGONE" },
      },
      pages,
    );
    expect(result.membership).toEqual({ e1: "L1" });
  });

  it("keeps all saved layers even when none of their members survive", () => {
    const result = mergeSavedLayers(
      {
        layers: [layer("L1"), layer("Lempty")],
        membership: { eGONE: "L1" },
      },
      pages,
    );
    expect(result.layers.map((l) => l.layerId)).toEqual(["L1", "Lempty"]);
    expect(result.membership).toEqual({});
  });

  it("handles missing membership field defensively", () => {
    const result = mergeSavedLayers(
      { layers: [layer("L1")] } as unknown as {
        layers: LayerObject[];
        membership: Record<string, string>;
      },
      pages,
    );
    expect(result.layers.map((l) => l.layerId)).toEqual(["L1"]);
    expect(result.membership).toEqual({});
  });

  it("does not mutate inputs", () => {
    const saved = {
      layers: [layer("L1")],
      membership: { e1: "L1", eGONE: "L1" },
    };
    const savedSnapshot = JSON.stringify(saved);
    const pagesSnapshot = JSON.stringify(pages);
    mergeSavedLayers(saved, pages);
    expect(JSON.stringify(saved)).toBe(savedSnapshot);
    expect(JSON.stringify(pages)).toBe(pagesSnapshot);
  });
});
