"use client";

/**
 * page-rulers.tsx
 *
 * Word-like horizontal + vertical rulers for the active page in the continuous
 * editor view. The rulers are anchored to the page itself (rendered inside the
 * active page sheet), so their `0` is exactly the page's top-left corner and
 * they scroll naturally with the page — no viewport/scroll maths.
 *
 *   - the HORIZONTAL ruler sits in the gutter just above the page and spans its
 *     width, measuring the page width (PDF points) in the chosen {@link RulerUnit};
 *   - the VERTICAL ruler sits in the gutter just left of the page and spans its
 *     height.
 *
 * Tick positions come from the pure {@link computeTicks} helper (no DOM, fully
 * tested). The component is presentational: it draws ticks + labels only.
 */

import React, { useMemo } from "react";
import { computeTicks, type RulerUnit } from "./lib/ruler-ticks";

/** Thickness (px) of each ruler bar. */
export const RULER_THICKNESS_PX = 18;

export interface PageRulersProps {
  /** Page width in PDF points (drives the horizontal ruler ticks). */
  pageWidthPts: number;
  /** Page height in PDF points (drives the vertical ruler ticks). */
  pageHeightPts: number;
  /** Current zoom factor (1 = 100%): points → CSS px. */
  zoom: number;
  /** Display unit for tick labels. */
  unit: RulerUnit;
}

/** One ruler bar (horizontal or vertical) rendered from pre-computed ticks. */
function RulerBar({
  orientation,
  lengthPts,
  zoom,
  unit,
}: {
  orientation: "horizontal" | "vertical";
  lengthPts: number;
  zoom: number;
  unit: RulerUnit;
}) {
  const ticks = useMemo(
    () => computeTicks(lengthPts, zoom, unit),
    [lengthPts, zoom, unit],
  );
  const isH = orientation === "horizontal";
  const tickFull = RULER_THICKNESS_PX * 0.55;
  const tickMinor = RULER_THICKNESS_PX * 0.3;

  return (
    <div
      className="absolute overflow-hidden bg-gray-50 text-[8px] leading-none text-gray-500"
      style={
        isH
          ? {
              // In the gutter just above the page sheet.
              bottom: "100%",
              left: 0,
              width: "100%",
              height: RULER_THICKNESS_PX,
              borderBottom: "1px solid #d1d5db",
            }
          : {
              // In the gutter just left of the page sheet.
              right: "100%",
              top: 0,
              height: "100%",
              width: RULER_THICKNESS_PX,
              borderRight: "1px solid #d1d5db",
            }
      }
      aria-hidden="true"
      data-ruler={orientation}
    >
      {ticks.map((tick, i) => {
        const len = tick.major ? tickFull : tickMinor;
        return (
          <React.Fragment key={i}>
            <span
              className="absolute bg-gray-400"
              style={
                isH
                  ? { left: tick.posPx, bottom: 0, width: 1, height: len }
                  : { top: tick.posPx, right: 0, height: 1, width: len }
              }
            />
            {tick.major && tick.label !== undefined ? (
              <span
                className="absolute select-none"
                style={
                  isH
                    ? { left: tick.posPx + 2, top: 1 }
                    : { top: tick.posPx + 2, left: 1, writingMode: "vertical-rl" }
                }
              >
                {tick.label}
              </span>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/**
 * Horizontal + vertical rulers anchored to the (position:relative) active page
 * sheet. The bars sit in the gutter above / left of the page via `bottom:100%`
 * / `right:100%`, so they never cover page content.
 */
export function PageRulers({
  pageWidthPts,
  pageHeightPts,
  zoom,
  unit,
}: PageRulersProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      <RulerBar
        orientation="horizontal"
        lengthPts={pageWidthPts}
        zoom={zoom}
        unit={unit}
      />
      <RulerBar
        orientation="vertical"
        lengthPts={pageHeightPts}
        zoom={zoom}
        unit={unit}
      />
    </div>
  );
}
