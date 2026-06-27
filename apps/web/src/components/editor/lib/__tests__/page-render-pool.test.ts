import { describe, it, expect, vi, beforeEach } from "vitest";
import { PageRenderPool, DEFAULT_MAX_LIVE } from "../page-render-pool";

// Stub the canvas package so the real PDFRenderer (and its engine import) never
// loads — the pool always receives an injected renderer factory in these tests.
vi.mock("@giga-pdf/canvas", () => ({ PDFRenderer: class {} }));
// Stub the dynamic `import("fabric")` path used when no fabric module is injected.
vi.mock("fabric", () => ({ Canvas: class {} }));

/** Minimal fake `fabric.Canvas`: tracks clear/dispose + a stable id. */
class FakeFabricCanvas {
  static nextId = 0;
  id = FakeFabricCanvas.nextId++;
  cleared = 0;
  disposed = 0;
  lowerCanvasEl: { replaceWith: () => void } = { replaceWith: () => {} };
  clear() {
    this.cleared += 1;
  }
  dispose() {
    this.disposed += 1;
  }
}

/** Fabric module stub: `new fabric.Canvas(el)` → a FakeFabricCanvas. */
function fakeFabric() {
  return {
    Canvas: FakeFabricCanvas,
  } as unknown as typeof import("fabric");
}

/** Renderer stub recording load + per-page render calls. */
class FakeRenderer {
  loaded = 0;
  renderCalls: Array<{ page: number; scale: number }> = [];
  async loadDocument() {
    this.loaded += 1;
  }
  async renderPageToDataURL(page: number, opts: { scale?: number } = {}) {
    this.renderCalls.push({ page, scale: opts.scale ?? 1 });
    return `data:image/png;base64,page${page}@${opts.scale ?? 1}`;
  }
  dispose() {}
}

function makeEl(): HTMLCanvasElement {
  // The pool only needs `replaceWith` on the element for rebind; a bare object
  // is enough since we never touch a real DOM here.
  return { replaceWith: () => {} } as unknown as HTMLCanvasElement;
}

function makePool(
  opts: Partial<{ maxLive: number; renderer: FakeRenderer; withBytes: boolean }> = {},
) {
  const renderer = opts.renderer ?? new FakeRenderer();
  const pool = new PageRenderPool({
    ...(opts.withBytes === false ? {} : { pdfBytes: new Uint8Array([1, 2, 3]) }),
    ...(opts.maxLive !== undefined ? { maxLive: opts.maxLive } : {}),
    fabric: fakeFabric(),
    createRenderer: () => renderer as unknown as never,
  });
  return { pool, renderer };
}

beforeEach(() => {
  FakeFabricCanvas.nextId = 0;
});

describe("PageRenderPool.acquire / release", () => {
  it("returns the same canvas for a repeated acquire of the same index", async () => {
    const { pool } = makePool();
    const a = await pool.acquire(0, makeEl());
    const b = await pool.acquire(0, makeEl());
    expect(a).toBe(b);
    expect(pool.liveCount).toBe(1);
  });

  it("recycles a released canvas instead of allocating a new one", async () => {
    const { pool } = makePool();
    const first = (await pool.acquire(0, makeEl())) as unknown as FakeFabricCanvas;
    expect(pool.liveCount).toBe(1);

    pool.release(0);
    expect(pool.liveCount).toBe(0);
    expect(pool.freeCount).toBe(1);
    expect(first.cleared).toBe(1); // cleared on release

    const reused = (await pool.acquire(1, makeEl())) as unknown as FakeFabricCanvas;
    expect(reused.id).toBe(first.id); // same instance recycled
    expect(pool.freeCount).toBe(0);
  });

  it("release of an unknown index is a no-op", async () => {
    const { pool } = makePool();
    await pool.acquire(0, makeEl());
    expect(() => pool.release(99)).not.toThrow();
    expect(pool.liveCount).toBe(1);
  });
});

describe("PageRenderPool LRU eviction", () => {
  it("never exceeds maxLive and evicts the least-recently-used canvas", async () => {
    const { pool } = makePool({ maxLive: 2 });
    const c0 = (await pool.acquire(0, makeEl())) as unknown as FakeFabricCanvas;
    await pool.acquire(1, makeEl());
    expect(pool.liveCount).toBe(2);

    // Touch index 1 so index 0 becomes the LRU victim.
    await pool.acquire(1, makeEl());
    // Acquire a 3rd page → cap exceeded → index 0 evicted (disposed).
    await pool.acquire(2, makeEl());

    expect(pool.liveCount).toBe(2);
    expect(c0.disposed).toBe(1);
    // Evicted canvas is disposed, NOT recycled.
    expect(pool.freeCount).toBe(0);
  });

  it("defaults to DEFAULT_MAX_LIVE", async () => {
    const { pool } = makePool({ maxLive: undefined });
    for (let i = 0; i < DEFAULT_MAX_LIVE + 3; i += 1) {
      // Always re-touch index 0 so it stays the most-recently-used and survives.
      await pool.acquire(i, makeEl());
      await pool.acquire(0, makeEl());
    }
    expect(pool.liveCount).toBeLessThanOrEqual(DEFAULT_MAX_LIVE);
  });
});

describe("PageRenderPool.renderBackground", () => {
  it("loads the document once and memoises per (index, scaleBucket)", async () => {
    const { pool, renderer } = makePool();

    const a = await pool.renderBackground(0, 2);
    const b = await pool.renderBackground(0, 2);
    expect(a).toBe(b);
    expect(renderer.loaded).toBe(1); // doc opened once
    expect(renderer.renderCalls).toHaveLength(1);
    // 0-based index → 1-based page for the renderer.
    expect(renderer.renderCalls[0]).toEqual({ page: 1, scale: 2 });
  });

  it("treats near-identical scales as the same bucket (cache hit)", async () => {
    const { pool, renderer } = makePool();
    await pool.renderBackground(0, 2.001);
    await pool.renderBackground(0, 2.002);
    expect(renderer.renderCalls).toHaveLength(1); // bucketed to the same key
  });

  it("renders distinct buckets for clearly different scales", async () => {
    const { pool, renderer } = makePool();
    await pool.renderBackground(0, 1);
    await pool.renderBackground(0, 3);
    expect(renderer.renderCalls).toHaveLength(2);
  });

  it("rejects when no pdfBytes were provided", async () => {
    const { pool } = makePool({ withBytes: false });
    await expect(pool.renderBackground(0, 2)).rejects.toThrow(/pdfBytes/);
  });
});

describe("PageRenderPool.replaceBytes", () => {
  it("invalidates only the changed pages' backgrounds, preserving live + free canvases", async () => {
    const { pool, renderer } = makePool();

    // Populate the background cache for three pages.
    await pool.renderBackground(0, 2);
    await pool.renderBackground(1, 2);
    await pool.renderBackground(2, 2);
    expect(renderer.renderCalls).toHaveLength(3);
    expect(renderer.loaded).toBe(1);

    // One live + one recycled canvas — neither must be touched by replaceBytes.
    await pool.acquire(0, makeEl());
    await pool.acquire(1, makeEl());
    pool.release(1);
    expect(pool.liveCount).toBe(1);
    expect(pool.freeCount).toBe(1);

    pool.replaceBytes(new Uint8Array([9, 9, 9]), [2]);

    // Canvases are left intact (no re-create, no dispose).
    expect(pool.liveCount).toBe(1);
    expect(pool.freeCount).toBe(1);

    // Unchanged pages (0, 1) keep their memoised bitmaps → no re-render.
    await pool.renderBackground(0, 2);
    await pool.renderBackground(1, 2);
    expect(renderer.renderCalls).toHaveLength(3);

    // The changed page (2) was invalidated → re-renders against reloaded bytes.
    await pool.renderBackground(2, 2);
    expect(renderer.renderCalls).toHaveLength(4);
    expect(renderer.renderCalls[3]).toEqual({ page: 3, scale: 2 });
    // Renderer was disposed + lazily reloaded once for the changed page.
    expect(renderer.loaded).toBe(2);
  });

  it("clears the entire background cache when no indices are given", async () => {
    const { pool, renderer } = makePool();
    await pool.renderBackground(0, 2);
    await pool.renderBackground(1, 2);
    expect(renderer.renderCalls).toHaveLength(2);

    pool.replaceBytes(new Uint8Array([7]));

    // Every page re-renders (whole cache dropped).
    await pool.renderBackground(0, 2);
    await pool.renderBackground(1, 2);
    expect(renderer.renderCalls).toHaveLength(4);
  });

  it("is a no-op after dispose", () => {
    const { pool } = makePool();
    pool.dispose();
    expect(() => pool.replaceBytes(new Uint8Array([1]), [0])).not.toThrow();
  });
});

describe("PageRenderPool.dispose", () => {
  it("disposes live + free canvases and blocks further use", async () => {
    const { pool } = makePool();
    const live = (await pool.acquire(0, makeEl())) as unknown as FakeFabricCanvas;
    await pool.acquire(1, makeEl());
    pool.release(1);

    pool.dispose();
    expect(live.disposed).toBe(1);
    expect(pool.liveCount).toBe(0);
    expect(pool.freeCount).toBe(0);

    await expect(pool.acquire(2, makeEl())).rejects.toThrow(/dispose/);
    await expect(pool.renderBackground(0, 2)).rejects.toThrow(/dispose/);
  });
});
