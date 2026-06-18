"use client";

/**
 * page-margin-guides.tsx
 *
 * The four draggable margin guide lines overlaid on a page sheet in the
 * Word-like editor. Each guide marks one side's margin (top/right/bottom/left);
 * dragging a guide moves the corresponding margin, and on drop the new margins
 * (in PDF points) are committed via {@link PageMarginGuidesProps.onCommit}.
 *
 * Coordinate model
 * ────────────────
 * Margins are PDF points; the page sheet is rendered at `zoom` (1pt → 1px at
 * zoom 1), so `px = pts * zoom` and `pts = px / zoom`. Guide positions are kept
 * in px (for crisp dragging) and converted back to points only on commit.
 *
 * The component lives inside the (position:relative) page sheet and fills it
 * absolutely; the guides are the only pointer-interactive elements (the rest is
 * `pointer-events-none`), so they never steal clicks from the page body.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageMargins } from "./lib/page-margins";
import {
  screenMarginsFromPage,
  pageMarginsFromScreen,
} from "./lib/margin-rotation";

/** Which side a guide controls (on the displayed sheet). */
type Side = "top" | "right" | "bottom" | "left";

export interface PageMarginGuidesProps {
  /** Rendered (displayed) page width in CSS px. */
  width: number;
  /** Rendered (displayed) page height in CSS px. */
  height: number;
  /** Current zoom factor (1 = 100%): points ↔ px. */
  zoom: number;
  /** Current margins in PDF points, on the page's intrinsic (un-rotated) box. */
  margins: PageMargins;
  /** Page `/Rotate` (CW). Margins are mapped to/from screen space accordingly. */
  rotation?: number;
  /** Commit new margins (PDF points, intrinsic box) when a guide is dropped. */
  onCommit: (margins: PageMargins) => void;
}

/** Clamp `v` into `[min, max]`. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Live px positions of the four guides, derived from the committed margins but
 * overridden locally while a drag is in progress.
 */
interface GuidePx {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Margins (points) → guide line positions (px) within a width×height sheet. */
function marginsToPx(m: PageMargins, zoom: number, width: number, height: number): GuidePx {
  return {
    top: m.top * zoom,
    bottom: height - m.bottom * zoom,
    left: m.left * zoom,
    right: width - m.right * zoom,
  };
}

export function PageMarginGuides({
  width,
  height,
  zoom,
  margins,
  rotation = 0,
  onCommit,
}: PageMarginGuidesProps) {
  // Guides work in SCREEN space (the displayed sheet's edges). Map the page's
  // intrinsic margins into screen space for display; the inverse runs on commit.
  const screenMargins = useMemo(
    () => screenMarginsFromPage(margins, rotation),
    [margins, rotation],
  );

  const [px, setPx] = useState<GuidePx>(() =>
    marginsToPx(screenMargins, zoom, width, height),
  );
  const draggingRef = useRef<Side | null>(null);
  // Latest guide positions mirrored into a ref so the pointerup handler reads
  // the final value without re-binding listeners. Synced in an effect (never
  // mutated during render).
  const pxRef = useRef(px);
  useEffect(() => {
    pxRef.current = px;
  }, [px]);

  // Re-sync from committed margins / geometry when not mid-drag (zoom change,
  // page swap, external margin update).
  useEffect(() => {
    if (draggingRef.current === null) {
      setPx(marginsToPx(screenMargins, zoom, width, height));
    }
  }, [screenMargins, zoom, width, height]);

  const safeZoom = zoom > 0 ? zoom : 1;

  // Convert the current px guide positions back to PDF-point margins (page's
  // intrinsic box), clamped to a sane non-overlapping range.
  const pxToMargins = useCallback(
    (g: GuidePx): PageMargins => {
      const screen: PageMargins = {
        top: clamp(g.top, 0, height) / safeZoom,
        bottom: clamp(height - g.bottom, 0, height) / safeZoom,
        left: clamp(g.left, 0, width) / safeZoom,
        right: clamp(width - g.right, 0, width) / safeZoom,
      };
      return pageMarginsFromScreen(screen, rotation);
    },
    [width, height, safeZoom, rotation],
  );

  const onPointerDown = useCallback(
    (side: Side) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = side;
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [],
  );

  // Pointer move/up are bound on the overlay element (which has capture), so a
  // drag tracks the pointer even when it leaves the thin guide line.
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const side = draggingRef.current;
      if (!side) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setPx((prev) => {
        if (side === "top") {
          return { ...prev, top: clamp(e.clientY - rect.top, 0, prev.bottom) };
        }
        if (side === "bottom") {
          return { ...prev, bottom: clamp(e.clientY - rect.top, prev.top, height) };
        }
        if (side === "left") {
          return { ...prev, left: clamp(e.clientX - rect.left, 0, prev.right) };
        }
        return { ...prev, right: clamp(e.clientX - rect.left, prev.left, width) };
      });
    },
    [width, height],
  );

  const endDrag = useCallback(() => {
    if (draggingRef.current === null) return;
    draggingRef.current = null;
    onCommit(pxToMargins(pxRef.current));
  }, [onCommit, pxToMargins]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      data-margin-guides="true"
    >
      <GuideLine orientation="horizontal" pos={px.top} onPointerDown={onPointerDown("top")} />
      <GuideLine orientation="horizontal" pos={px.bottom} onPointerDown={onPointerDown("bottom")} />
      <GuideLine orientation="vertical" pos={px.left} onPointerDown={onPointerDown("left")} />
      <GuideLine orientation="vertical" pos={px.right} onPointerDown={onPointerDown("right")} />
    </div>
  );
}

/** A single dashed margin line with a wider invisible hit-area for dragging. */
function GuideLine({
  orientation,
  pos,
  onPointerDown,
}: {
  orientation: "horizontal" | "vertical";
  pos: number;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const isH = orientation === "horizontal";
  const HIT = 9; // px hit-area thickness, centred on the line
  return (
    <div
      role="separator"
      aria-orientation={isH ? "horizontal" : "vertical"}
      onPointerDown={onPointerDown}
      className="pointer-events-auto absolute"
      style={
        isH
          ? {
              left: 0,
              right: 0,
              top: pos - HIT / 2,
              height: HIT,
              cursor: "row-resize",
            }
          : {
              top: 0,
              bottom: 0,
              left: pos - HIT / 2,
              width: HIT,
              cursor: "col-resize",
            }
      }
    >
      {/* The visible 1px dashed line, centred in the hit-area. */}
      <span
        className="absolute"
        style={
          isH
            ? {
                left: 0,
                right: 0,
                top: HIT / 2,
                height: 0,
                borderTop: "1px dashed var(--color-primary, #6366f1)",
              }
            : {
                top: 0,
                bottom: 0,
                left: HIT / 2,
                width: 0,
                borderLeft: "1px dashed var(--color-primary, #6366f1)",
              }
        }
      />
    </div>
  );
}
