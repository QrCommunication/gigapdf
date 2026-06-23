"use client";

/**
 * page-margin-overlay.tsx
 *
 * The single owner of the Word-like editor's draggable page margins for ONE
 * page sheet. It renders BOTH presentational surfaces and shares one live drag
 * state between them, so the ruler handles and the on-sheet guide lines are one
 * system (drag either → both move; drop → one commit):
 *
 *   - {@link PageRulers} — horizontal + vertical rulers (ticks) with margin
 *     handles + shaded bands in the gutter above / left of the sheet;
 *   - {@link PageMarginGuides} — the dashed guide lines drawn across the sheet.
 *
 * Coordinate model & all px↔point maths live in the pure `lib/ruler-margins.ts`
 * helper (unit-tested). The overlay keeps the four margins as live *screen*-px
 * positions while dragging and converts back to page-intrinsic PDF points (via
 * the page rotation) only on commit, exactly like the previous self-contained
 * guides did — so behaviour is unchanged, just shared with the rulers.
 *
 * Reused identically by the continuous view (`page-slot.tsx`) and the single-
 * page editor (`editor-canvas.tsx`).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageMargins } from "./lib/page-margins";
import type { RulerUnit } from "./lib/ruler-ticks";
import {
  applyGuideDrag,
  guidePxToMargins,
  marginsToGuidePx,
  type MarginGuidePx,
  type MarginSide,
} from "./lib/ruler-margins";
import { PageRulers } from "./page-rulers";
import { PageMarginGuides } from "./page-margin-guides";

export interface PageMarginOverlayProps {
  /** Rendered (displayed) page width in CSS px (page points × zoom). */
  width: number;
  /** Rendered (displayed) page height in CSS px (page points × zoom). */
  height: number;
  /** Current zoom factor (1 = 100%): points ↔ px. */
  zoom: number;
  /** Display unit for the ruler tick labels. */
  unit: RulerUnit;
  /** Current margins in PDF points, on the page's intrinsic (un-rotated) box. */
  margins: PageMargins;
  /** Page `/Rotate` (CW). Margins are mapped to/from screen space accordingly. */
  rotation?: number;
  /** Commit new margins (PDF points, intrinsic box) when a drag is dropped. */
  onCommit: (margins: PageMargins) => void;
}

/**
 * Margin controller: owns the live drag state and renders the rulers + guides.
 * One capture target (the sheet-filling overlay) handles pointer move/up for
 * BOTH surfaces, so every drag resolves in the same (sheet-relative) px space.
 */
export function PageMarginOverlay({
  width,
  height,
  zoom,
  unit,
  margins,
  rotation = 0,
  onCommit,
}: PageMarginOverlayProps) {
  // Ruler ticks measure the displayed page box in points (px = pts × zoom).
  const widthPts = zoom > 0 ? width / zoom : width;
  const heightPts = zoom > 0 ? height / zoom : height;

  // Live margin line positions (px), seeded from the committed margins (mapped
  // through rotation) and overridden locally while a drag is in progress.
  const initialPx = useMemo(
    () => marginsToGuidePx(margins, rotation, zoom, width, height),
    [margins, rotation, zoom, width, height],
  );
  const [guidePx, setGuidePx] = useState<MarginGuidePx>(initialPx);
  const draggingRef = useRef<MarginSide | null>(null);
  // Latest positions mirrored into a ref so the pointerup handler reads the
  // final value without re-binding listeners (synced in an effect, never during
  // render).
  const guidePxRef = useRef(guidePx);
  useEffect(() => {
    guidePxRef.current = guidePx;
  }, [guidePx]);

  // Re-sync from committed margins / geometry when NOT mid-drag (zoom change,
  // page swap, rotation change, external margin update).
  useEffect(() => {
    if (draggingRef.current === null) {
      setGuidePx(initialPx);
    }
  }, [initialPx]);

  // Single capture target (the sheet-filling overlay) so pointer move/up route
  // here regardless of which handle/guide started the drag.
  const captureRef = useRef<HTMLDivElement | null>(null);

  const onSideDown = useCallback(
    (side: MarginSide, e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = side;
      captureRef.current?.setPointerCapture?.(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const side = draggingRef.current;
      if (!side) return;
      // currentTarget is the sheet-filling capture overlay → its rect is the
      // sheet, so (clientX/Y − rect) is the pointer offset inside the sheet.
      const rect = e.currentTarget.getBoundingClientRect();
      const posX = e.clientX - rect.left;
      const posY = e.clientY - rect.top;
      const pos = side === "left" || side === "right" ? posX : posY;
      setGuidePx((prev) => applyGuideDrag(prev, side, pos, width, height));
    },
    [width, height],
  );

  const onPointerEnd = useCallback(() => {
    if (draggingRef.current === null) return;
    draggingRef.current = null;
    onCommit(
      guidePxToMargins(guidePxRef.current, rotation, zoom, width, height),
    );
  }, [onCommit, rotation, zoom, width, height]);

  const rulerMargins = useMemo(
    () => ({ guidePx, onSideDown }),
    [guidePx, onSideDown],
  );

  return (
    // Sheet-filling capture overlay. pointer-events-none so it never blocks the
    // page body; the handles/guides inside re-enable pointer events on their hit
    // areas. Move/up are bound here and read THIS element's rect (= the sheet).
    <div
      ref={captureRef}
      className="pointer-events-none absolute inset-0 z-10"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      data-margin-overlay="true"
    >
      <PageRulers
        pageWidthPts={widthPts}
        pageHeightPts={heightPts}
        zoom={zoom}
        unit={unit}
        margins={rulerMargins}
      />
      <PageMarginGuides guidePx={guidePx} onSideDown={onSideDown} />
    </div>
  );
}
