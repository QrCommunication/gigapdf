"use client";

/**
 * page-canvas-host.tsx
 *
 * Renders a single PDF page as a READ-ONLY bitmap onto its own pooled
 * `fabric.Canvas` for the Word-like continuous editor view. Each host:
 *
 *   1. mounts one `<canvas>` sized to the page (points × scale, rotation-aware);
 *   2. acquires a recycled `fabric.Canvas` from the shared {@link PageRenderPool};
 *   3. paints the FULL PDF background (with text) at index 0 via the shared
 *      `addPdfBackground`;
 *   4. releases its pool slot on unmount.
 *
 * This host is used ONLY for INACTIVE pages in the continuous scroller — the
 * cheap, pixel-perfect bitmap. The ACTIVE/focused page renders a real embedded
 * `<EditorCanvas>` instead (full tooling: create/move/resize/retype/delete,
 * undo/redo, toolbar handle), so the editable overlay lives there, never here.
 */

import React, { useEffect, useRef } from "react";
import type { PageObject } from "@giga-pdf/types";
import type { Canvas as FabricCanvas } from "fabric";
import { clientLogger } from "@/lib/client-logger";
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
  /** Shared pool providing the recycled canvas + memoised page backgrounds. */
  pool: PageRenderPool;
  /**
   * Background revision. The continuous view bumps it when this page's content
   * was re-baked into the pool's new bytes — re-running the render effect so the
   * bitmap re-rasterises. Unchanged → the effect does not re-run, the existing
   * bitmap is kept (no re-raster for pages that did not change).
   */
  bgRevision?: number;
  /** Notified once the page background has finished rendering. */
  onReady?: (index: number) => void;
  /** Notified when the host releases its pool slot on unmount. */
  onDispose?: (index: number) => void;
}

/**
 * One inactive page → one pooled Fabric canvas painted with the full page
 * bitmap. Re-renders whenever `page` or `scale` changes; releases the pool slot
 * on unmount.
 */
export function PageCanvasHost({
  page,
  index,
  scale,
  pool,
  bgRevision = 0,
  onReady,
  onDispose,
}: PageCanvasHostProps) {
  // React only ever owns this <div>. The <canvas> is created IMPERATIVELY and
  // appended to it inside the render effect, because `fabric.Canvas(el)` (via
  // the pool's `acquire`) moves the element into a `.canvas-container` wrapper it
  // injects. If React owned the <canvas> (a JSX ref), its removeChild on unmount
  // would throw NotFoundError — the node has been relocated by Fabric. With the
  // <canvas> created here, React removes only this container <div> on unmount
  // (taking the canvas + Fabric wrapper with it) — no phantom removeChild.
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  // Keep the latest callbacks in refs so the render effect does not re-run (and
  // re-rasterise the page) merely because a parent passed new closures.
  const onReadyRef = useRef(onReady);
  const onDisposeRef = useRef(onDispose);
  useEffect(() => {
    onReadyRef.current = onReady;
    onDisposeRef.current = onDispose;
  });

  const { w: pageW, h: pageH } = effectivePagePoints(page);
  const cssWidth = pageW * scale;
  const cssHeight = pageH * scale;

  useEffect(() => {
    const host = containerRef.current;
    if (!host) {
      return;
    }

    // Create the <canvas> IMPERATIVELY and attach it to the container the React
    // owns. The pool's `acquire` will hand it to `fabric.Canvas(el)` (or
    // `el.replaceWith` a recycled node), relocating it into a Fabric wrapper —
    // which is why React must never own this element.
    const el = document.createElement("canvas");
    el.width = cssWidth;
    el.height = cssHeight;
    el.style.width = `${cssWidth}px`;
    el.style.height = `${cssHeight}px`;
    el.style.display = "block";
    host.appendChild(el);
    canvasElRef.current = el;

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
      // the scene scales together — mirrors the single-page editor: background
      // coords stay in points, canvas zoom = scale.
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
        // Recycle the Fabric canvas back to the pool (clear + free-list). The
        // pool keeps the DOM node alive for reuse; it is not removed here.
        pool.release(index);
        onDisposeRef.current?.(index);
      }
      // Detach any residual <canvas> (the impérative one and/or the pool's
      // recycled node Fabric left behind) so an in-place re-init (scale/page
      // change WITHOUT a React unmount) starts from an empty container instead
      // of stacking canvases. On a real React unmount this container <div> is
      // removed wholesale by React, so this is a best-effort cleanup for the
      // re-run path only.
      const container = containerRef.current;
      if (container) {
        for (const node of Array.from(container.querySelectorAll("canvas"))) {
          node.parentNode?.removeChild(node);
        }
      }
      canvasElRef.current = null;
    };
    // Re-render on page identity, geometry, pool change, OR a background-revision
    // bump (this page's content was re-baked → re-rasterise against the pool's
    // new bytes). Callbacks are read via refs (kept stable) so new closures
    // don't force re-rasterisation.
  }, [pool, index, page.pageId, scale, cssWidth, cssHeight, bgRevision]);

  return (
    <div
      ref={containerRef}
      style={{ width: cssWidth, height: cssHeight, display: "block" }}
    />
  );
}
