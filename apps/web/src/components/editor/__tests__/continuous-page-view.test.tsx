/**
 * continuous-page-view.test.tsx
 *
 * Atomic-pool-swap regression guard. When the backing PDF binary (`pdfFile`)
 * changes — e.g. a z-order reorder bakes a new document — the continuous view
 * must NOT blank the whole document (`setPool(null)`) while it rebuilds the
 * `PageRenderPool`. A blank pool unmounts EVERY `<PageSlot>`, including the
 * active page's `<EditorCanvas embedded>` editing session (lost selection/undo
 * + a full-document re-raster flash perceived as a reset).
 *
 * The fix swaps atomically: build the NEW pool, commit it (`setPool(next)`),
 * THEN dispose the previous one — `pool` never goes null between two non-null
 * `pdfFile`s, so the keyed PageSlots reconcile WITHOUT unmounting.
 *
 * We mock `PageSlot` (records mount/unmount per pageId), `PageRenderPool`
 * (records construct/dispose), the view store and the margin reader — so the
 * test exercises ONLY the swap orchestration, no Fabric/engine.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import type { PageObject } from "@giga-pdf/types";

// --- Hoisted trackers shared with the (hoisted) vi.mock factories below. ------
const slotTracker = vi.hoisted(() => {
  const mounts = new Map<string, number>();
  const unmounts = new Map<string, number>();
  return {
    mounts,
    unmounts,
    recordMount(id: string) {
      mounts.set(id, (mounts.get(id) ?? 0) + 1);
    },
    recordUnmount(id: string) {
      unmounts.set(id, (unmounts.get(id) ?? 0) + 1);
    },
    reset() {
      mounts.clear();
      unmounts.clear();
    },
  };
});

const poolTracker = vi.hoisted(() => ({
  constructed: 0,
  disposed: 0,
  reset() {
    this.constructed = 0;
    this.disposed = 0;
  },
}));

// PageSlot → a marker div that records its mount/unmount lifecycle per pageId
// and surfaces the `margins` prop it received (so we can assert the page-aligned
// margins array reaches each slot).
vi.mock("../page-slot", async () => {
  const ReactMod = await import("react");
  const PageSlot = (props: {
    page: { pageId: string };
    isActive?: boolean;
    margins?: unknown;
  }) => {
    const id = props.page.pageId;
    ReactMod.useEffect(() => {
      slotTracker.recordMount(id);
      return () => slotTracker.recordUnmount(id);
    }, [id]);
    return ReactMod.createElement("div", {
      "data-testid": `slot-${id}`,
      "data-active": props.isActive ? "true" : "false",
      "data-margins": JSON.stringify(props.margins ?? null),
    });
  };
  return { PageSlot };
});

// PageRenderPool → counts constructions + disposals (no engine).
vi.mock("../lib/page-render-pool", () => {
  class FakePageRenderPool {
    disposed = false;
    constructor() {
      poolTracker.constructed += 1;
    }
    dispose() {
      if (!this.disposed) {
        this.disposed = true;
        poolTracker.disposed += 1;
      }
    }
  }
  return { PageRenderPool: FakePageRenderPool, DEFAULT_MAX_LIVE: 12 };
});

// Margin reader → trivial (no wasm doc open).
vi.mock("../lib/page-margins", () => ({
  readAllPageMargins: () => Promise.resolve([]),
}));

// View store → a fixed slice; the wide visible window keeps every page mounted.
vi.mock("@giga-pdf/editor", () => ({
  useViewStore: () => ({
    visiblePages: new Set([0, 1, 2, 3]),
    isFastScrolling: false,
    setVisiblePages: () => {},
    setCurrentPageIndex: () => {},
    setScrollTop: () => {},
    setViewport: () => {},
    setFastScrolling: () => {},
  }),
}));

import { ContinuousPageView } from "../continuous-page-view";

// jsdom lacks these; the windowing/viewport effects instantiate them on mount.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
beforeEach(() => {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    NoopObserver as unknown as typeof IntersectionObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    NoopObserver as unknown as typeof ResizeObserver;
  slotTracker.reset();
  poolTracker.reset();
});
afterEach(cleanup);

/** A `pdfFile`-like object: distinct identity per call + an `arrayBuffer()`. */
function makePdfFile(tag: string): File {
  return {
    name: `${tag}.pdf`,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as unknown as File;
}

function makePages(ids: string[]): PageObject[] {
  return ids.map(
    (pageId, i) =>
      ({
        pageId,
        pageNumber: i + 1,
        dimensions: { width: 600, height: 800, rotation: 0 },
      }) as unknown as PageObject,
  );
}

const NOOP = () => {};

describe("ContinuousPageView — atomic pool swap (identical structure)", () => {
  it("swaps the pool WITHOUT unmounting the active PageSlot", async () => {
    const pages = makePages(["p1", "p2"]);
    const fileA = makePdfFile("a");

    const { rerender } = render(
      <ContinuousPageView
        pages={pages}
        zoom={1}
        pdfFile={fileA}
        activePageIndex={0}
        onActivatePage={NOOP}
      />,
    );

    // First pool built + slots mounted once.
    await waitFor(() => expect(poolTracker.constructed).toBe(1));
    await waitFor(() =>
      expect(document.querySelector('[data-testid="slot-p1"]')).not.toBeNull(),
    );
    expect(slotTracker.mounts.get("p1")).toBe(1);

    // pdfFile changes (same pages). The swap must build a 2nd pool and dispose
    // the 1st — never blanking the view.
    const fileB = makePdfFile("b");
    rerender(
      <ContinuousPageView
        pages={pages}
        zoom={1}
        pdfFile={fileB}
        activePageIndex={0}
        onActivatePage={NOOP}
      />,
    );

    await waitFor(() => expect(poolTracker.constructed).toBe(2));
    await waitFor(() => expect(poolTracker.disposed).toBe(1));

    // The crux: the active PageSlot was NEVER unmounted/remounted across the
    // swap → the editing session is preserved, no `setPool(null)` flash.
    expect(slotTracker.unmounts.get("p1") ?? 0).toBe(0);
    expect(slotTracker.mounts.get("p1")).toBe(1);
    // The active slot is still in the DOM after the swap.
    expect(document.querySelector('[data-testid="slot-p1"]')).not.toBeNull();
  });
});

describe("ContinuousPageView — margins prop", () => {
  it("forwards the page-aligned margins array to each PageSlot", async () => {
    const pages = makePages(["p1", "p2"]);
    const m0 = { top: 10, right: 20, bottom: 30, left: 40 };

    render(
      <ContinuousPageView
        pages={pages}
        zoom={1}
        pdfFile={makePdfFile("a")}
        activePageIndex={0}
        onActivatePage={NOOP}
        // Page-aligned by index: page 0 has margins, page 1 has none.
        margins={[m0, null]}
      />,
    );

    await waitFor(() =>
      expect(document.querySelector('[data-testid="slot-p1"]')).not.toBeNull(),
    );

    const slot0 = document.querySelector('[data-testid="slot-p1"]');
    const slot1 = document.querySelector('[data-testid="slot-p2"]');
    expect(slot0?.getAttribute("data-margins")).toBe(JSON.stringify(m0));
    // No entry for page 1 → null (no guides) — never the previous page's value.
    expect(slot1?.getAttribute("data-margins")).toBe(JSON.stringify(null));
  });
});

describe("ContinuousPageView — real structure change", () => {
  it("rebuilds the pool and renders the new page when the page count changes", async () => {
    const fileA = makePdfFile("a");
    const { rerender } = render(
      <ContinuousPageView
        pages={makePages(["p1", "p2"])}
        zoom={1}
        pdfFile={fileA}
        activePageIndex={0}
        onActivatePage={NOOP}
      />,
    );

    await waitFor(() => expect(poolTracker.constructed).toBe(1));
    expect(document.querySelector('[data-testid="slot-p3"]')).toBeNull();

    // New document with a different page count.
    const fileB = makePdfFile("b");
    rerender(
      <ContinuousPageView
        pages={makePages(["p1", "p2", "p3"])}
        zoom={1}
        pdfFile={fileB}
        activePageIndex={0}
        onActivatePage={NOOP}
      />,
    );

    // Pool rebuilt (new doc) + previous disposed, and the new page now renders.
    await waitFor(() => expect(poolTracker.constructed).toBe(2));
    await waitFor(() => expect(poolTracker.disposed).toBe(1));
    await waitFor(() =>
      expect(document.querySelector('[data-testid="slot-p3"]')).not.toBeNull(),
    );
  });
});
