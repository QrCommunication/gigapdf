"use client";

/**
 * page-margin-guides.tsx
 *
 * The four draggable margin GUIDE LINES drawn across a page sheet in the
 * Word-like editor (one per side: top/right/bottom/left). This is a *controlled*,
 * presentational surface: it renders the dashed lines at the px positions it is
 * given and only ARMS a drag (`onSideDown`); the pointer move/up + commit are
 * owned by {@link PageMarginOverlay}, which captures the pointer on a single
 * sheet-filling target. That owner holds the one live margin state shared with
 * the ruler handles, so the page guides and the ruler markers always move
 * together (no divergence).
 *
 * The component fills the (position:relative) page sheet absolutely; only the
 * guide hit-areas are pointer-interactive (the rest is `pointer-events-none`),
 * so they never steal clicks from the page body.
 *
 * Pure px↔point geometry lives in `lib/ruler-margins.ts`.
 */

import React from "react";
import type { MarginGuidePx, MarginSide } from "./lib/ruler-margins";

export interface PageMarginGuidesProps {
  /** Live guide line positions (px) within the sheet — owned by the overlay. */
  guidePx: MarginGuidePx;
  /** Begin dragging a side's guide (the overlay owns move/up + commit). */
  onSideDown: (side: MarginSide, e: React.PointerEvent<HTMLDivElement>) => void;
}

/**
 * Controlled margin-guide overlay: draws the four dashed lines at `guidePx` and
 * arms a drag on pointer-down. Pointer move/up are handled by the owning overlay
 * (which holds capture), so a drag tracks the pointer even off the thin line.
 */
export function PageMarginGuides({ guidePx, onSideDown }: PageMarginGuidesProps) {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      data-margin-guides="true"
    >
      <GuideLine
        orientation="horizontal"
        pos={guidePx.top}
        onPointerDown={(e) => onSideDown("top", e)}
      />
      <GuideLine
        orientation="horizontal"
        pos={guidePx.bottom}
        onPointerDown={(e) => onSideDown("bottom", e)}
      />
      <GuideLine
        orientation="vertical"
        pos={guidePx.left}
        onPointerDown={(e) => onSideDown("left", e)}
      />
      <GuideLine
        orientation="vertical"
        pos={guidePx.right}
        onPointerDown={(e) => onSideDown("right", e)}
      />
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
