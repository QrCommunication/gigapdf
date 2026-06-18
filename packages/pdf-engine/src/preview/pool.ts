/**
 * Canvas-pool lifecycle stubs (kept for API compatibility).
 *
 * The former pdfjs + `node-canvas` rasterisation path has been fully replaced by
 * the native WASM rasteriser (`renderPage`), so no off-screen canvas is created
 * any more. `setCanvasPoolSize` / `destroyCanvasPool` are retained as no-ops so
 * the public preview API stays stable; the `canvas` dependency is gone.
 */

/** No-op: kept for API compatibility (no canvas pool exists any more). */
export function setCanvasPoolSize(_size: number): void {
  /* intentionally empty — native rendering needs no canvas pool */
}

/** No-op: kept for API compatibility (no canvas pool exists any more). */
export function destroyCanvasPool(): void {
  /* intentionally empty */
}
