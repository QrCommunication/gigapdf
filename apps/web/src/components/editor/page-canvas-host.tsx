"use client";

/**
 * page-canvas-host.tsx
 *
 * Renders a single PDF page onto its own pooled `fabric.Canvas` for the
 * Word-like continuous editor view. Each host:
 *
 *   1. mounts one `<canvas>` sized to the page (points × scale, rotation-aware);
 *   2. acquires a recycled `fabric.Canvas` from the shared {@link PageRenderPool};
 *   3. paints the PDF background at index 0 (via the shared `addPdfBackground`);
 *   4. **only when `mode === 'full'`** builds the editable Fabric overlay by
 *      reusing `renderElementsOverlay` from `render-elements.ts` — the same core
 *      the single-page editor uses, never re-implemented here;
 *   5. releases its pool slot on unmount.
 *
 * `mode === 'background'` renders the bitmap only (cheap, for off-focus pages in
 * the virtualised list). This component never wires page-mutation callbacks —
 * continuous-mode editing is Phase 2.
 */

import React, { useEffect, useRef } from "react";
import type { PageObject } from "@giga-pdf/types";
import type { Canvas as FabricCanvas } from "fabric";
import { clientLogger } from "@/lib/client-logger";
import {
  renderElementsOverlay,
  type RenderElementsOptions,
} from "./render-elements";
import { addPdfBackground, backgroundRenderScale } from "./lib/pdf-background";
import { effectivePagePoints } from "./lib/page-layout";
import type { PageRenderPool } from "./lib/page-render-pool";

export interface PageCanvasHostProps {
  /** Page to render. */
  page: PageObject;
  /** 0-based index of the page in the document (the pool key). */
  index: number;
  /** Zoom factor (1 = 100%): page points → CSS px for this host's canvas. */
  scale: number;
  /**
   * `'background'` paints only the rasterised PDF bitmap. `'full'` additionally
   * builds the editable element overlay (the focused/active page).
   */
  mode: "background" | "full";
  /** Shared pool providing the recycled canvas + memoised page backgrounds. */
  pool: PageRenderPool;
  /** Optional read-only selection callback forwarded to the overlay (`full` only). */
  onElementSelected?: RenderElementsOptions["onElementSelected"];
  /** Notified once the page (background + overlay) has finished rendering. */
  onReady?: (index: number) => void;
  /** Notified when the host releases its pool slot on unmount. */
  onDispose?: (index: number) => void;
}

/**
 * One page → one pooled Fabric canvas. Re-renders whenever `page`, `scale` or
 * `mode` changes; releases the pool slot on unmount.
 */
export function PageCanvasHost({
  page,
  index,
  scale,
  mode,
  pool,
  onElementSelected,
  onReady,
  onDispose,
}: PageCanvasHostProps) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);

  // Keep the latest callbacks in refs so the render effect does not re-run (and
  // re-rasterise the page) merely because a parent passed new closures.
  const onReadyRef = useRef(onReady);
  const onDisposeRef = useRef(onDispose);
  const onElementSelectedRef = useRef(onElementSelected);
  useEffect(() => {
    onReadyRef.current = onReady;
    onDisposeRef.current = onDispose;
    onElementSelectedRef.current = onElementSelected;
  });

  const { w: pageW, h: pageH } = effectivePagePoints(page);
  const cssWidth = pageW * scale;
  const cssHeight = pageH * scale;

  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) {
      return;
    }

    // `cancelled` guards against the effect being torn down (unmount, dep
    // change) while an async render is still in flight: a stale completion must
    // not touch a canvas the pool may have already recycled.
    let cancelled = false;
    let acquired: FabricCanvas | null = null;

    void (async () => {
      let canvas: FabricCanvas;
      try {
        canvas = await pool.acquire(index, el);
      } catch (err) {
        clientLogger.warn("[PageCanvasHost] acquire failed:", err);
        return;
      }
      if (cancelled) {
        // Effect already cleaned up; release immediately and bail.
        pool.release(index);
        return;
      }
      acquired = canvas;

      // Size the Fabric canvas to the page bitmap (points), then apply zoom so
      // the whole scene (background + overlay) scales together — mirrors the
      // single-page editor: overlay coords stay in points, canvas zoom = scale.
      const withDims = canvas as unknown as {
        setDimensions?: (d: { width: number; height: number }) => void;
        setZoom?: (z: number) => void;
        backgroundColor?: string;
        clear: () => void;
        renderAll: () => void;
        requestRenderAll: () => void;
      };
      try {
        canvas.clear();
        withDims.backgroundColor = "#ffffff";
        withDims.setDimensions?.({ width: cssWidth, height: cssHeight });
        withDims.setZoom?.(scale);
      } catch (err) {
        clientLogger.warn("[PageCanvasHost] canvas setup failed:", err);
      }

      // --- PDF background (index 0) -----------------------------------------
      const renderScale = backgroundRenderScale(
        typeof window !== "undefined" ? window.devicePixelRatio : 2,
      );
      try {
        const dataUrl = await pool.renderBackground(index, renderScale);
        if (cancelled) {
          return;
        }
        const fabric = await import("fabric");
        if (cancelled) {
          return;
        }
        await addPdfBackground(
          canvas,
          fabric as unknown as typeof import("fabric"),
          dataUrl,
          renderScale,
        );
      } catch (err) {
        clientLogger.warn("[PageCanvasHost] background render failed:", err);
      }
      if (cancelled) {
        return;
      }

      // --- Editable overlay (full mode only) --------------------------------
      // Reuses the shared `renderElementsOverlay` core — identical Fabric object
      // construction as the single-page editor, never duplicated here.
      if (mode === "full" && page.elements && page.elements.length > 0) {
        try {
          const fabric = await import("fabric");
          if (cancelled) {
            return;
          }
          await renderElementsOverlay(
            canvas,
            page.elements,
            fabric as unknown as typeof import("fabric"),
            {
              scale: 1,
              ...(onElementSelectedRef.current
                ? { onElementSelected: onElementSelectedRef.current }
                : {}),
            },
          );
        } catch (err) {
          clientLogger.warn("[PageCanvasHost] overlay render failed:", err);
        }
      }
      if (cancelled) {
        return;
      }

      try {
        withDims.requestRenderAll();
      } catch {
        // ignore — canvas may have been recycled
      }
      onReadyRef.current?.(index);
    })();

    return () => {
      cancelled = true;
      if (acquired) {
        pool.release(index);
        onDisposeRef.current?.(index);
      }
    };
    // Re-render on page identity, geometry, mode or pool change. Callbacks are
    // read via refs (kept stable) so new closures don't force re-rasterisation.
  }, [pool, index, page.pageId, page.elements, mode, scale, cssWidth, cssHeight]);

  return (
    <canvas
      ref={canvasElRef}
      width={cssWidth}
      height={cssHeight}
      style={{ width: cssWidth, height: cssHeight, display: "block" }}
    />
  );
}
