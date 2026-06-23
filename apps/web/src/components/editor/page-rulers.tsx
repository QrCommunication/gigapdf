"use client";

/**
 * page-rulers.tsx
 *
 * Word-like horizontal + vertical rulers for the active page. The rulers are
 * anchored to the page itself (rendered inside the active page sheet), so their
 * `0` is exactly the page's top-left corner and they scroll naturally with the
 * page — no viewport/scroll maths.
 *
 *   - the HORIZONTAL ruler sits in the gutter just above the page and spans its
 *     width, measuring the page width (PDF points) in the chosen {@link RulerUnit};
 *   - the VERTICAL ruler sits in the gutter just left of the page and spans its
 *     height.
 *
 * Tick positions come from the pure {@link computeTicks} helper (no DOM, fully
 * tested). On top of the ticks the rulers optionally draw Word-style MARGIN
 * MARKERS — a shaded band over each margin region plus a draggable handle at the
 * margin line. The handles share their live positions + drag gestures with the
 * page-sheet guide lines through the owning {@link PageMarginOverlay}, so the
 * ruler and the guides are one system, never two.
 *
 * Ticks/labels stay `pointer-events-none`; ONLY the margin handles are
 * `pointer-events-auto`.
 */

import React, { useMemo } from "react";
import { computeTicks, type RulerUnit } from "./lib/ruler-ticks";
import type { MarginGuidePx, MarginSide } from "./lib/ruler-margins";

/** Thickness (px) of each ruler bar. */
export const RULER_THICKNESS_PX = 18;

/**
 * Live margin state + drag arming shared with the page-sheet guides. The owning
 * {@link PageMarginOverlay} holds pointer capture and resolves move/up, so the
 * ruler handles only need to ARM a drag (`onSideDown`).
 */
export interface RulerMarginControls {
  /** Live margin line positions (px) within the sheet. */
  guidePx: MarginGuidePx;
  /** Begin dragging a side's margin from its ruler handle. */
  onSideDown: (side: MarginSide, e: React.PointerEvent<HTMLDivElement>) => void;
}

export interface PageRulersProps {
  /** Page width in PDF points (drives the horizontal ruler ticks). */
  pageWidthPts: number;
  /** Page height in PDF points (drives the vertical ruler ticks). */
  pageHeightPts: number;
  /** Current zoom factor (1 = 100%): points → CSS px. */
  zoom: number;
  /** Display unit for tick labels. */
  unit: RulerUnit;
  /**
   * Optional Word-style margin markers (shaded band + draggable handle) drawn on
   * the rulers. Omit to render passive rulers (ticks only).
   */
  margins?: RulerMarginControls;
}

/** One ruler bar (horizontal or vertical) rendered from pre-computed ticks. */
function RulerBar({
  orientation,
  lengthPts,
  zoom,
  unit,
  margins,
}: {
  orientation: "horizontal" | "vertical";
  lengthPts: number;
  zoom: number;
  unit: RulerUnit;
  margins?: RulerMarginControls;
}) {
  const ticks = useMemo(
    () => computeTicks(lengthPts, zoom, unit),
    [lengthPts, zoom, unit],
  );
  const isH = orientation === "horizontal";
  const tickFull = RULER_THICKNESS_PX * 0.55;
  const tickMinor = RULER_THICKNESS_PX * 0.3;

  // Margin marker positions (px) for this orientation: the two sides whose
  // lines run perpendicular to the bar. Horizontal bar → left/right; vertical
  // bar → top/bottom. `start`/`end` are the near/far margin line offsets.
  const lengthPx = (lengthPts > 0 ? lengthPts : 0) * (zoom > 0 ? zoom : 1);
  const startSide: MarginSide = isH ? "left" : "top";
  const endSide: MarginSide = isH ? "right" : "bottom";
  const startPos = isH ? margins?.guidePx.left : margins?.guidePx.top;
  const endPos = isH ? margins?.guidePx.right : margins?.guidePx.bottom;

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
      // The bar holds passive ticks (aria-hidden) plus, optionally, interactive
      // margin handles. It must NOT itself be aria-hidden when handles exist, or
      // the handles' a11y semantics would be hidden too.
      aria-hidden={margins ? undefined : "true"}
      data-ruler={orientation}
    >
      {ticks.map((tick, i) => {
        const len = tick.major ? tickFull : tickMinor;
        return (
          <React.Fragment key={i}>
            <span
              className="pointer-events-none absolute bg-gray-400"
              style={
                isH
                  ? { left: tick.posPx, bottom: 0, width: 1, height: len }
                  : { top: tick.posPx, right: 0, height: 1, width: len }
              }
            />
            {tick.major && tick.label !== undefined ? (
              <span
                className="pointer-events-none absolute select-none"
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

      {margins && startPos !== undefined && endPos !== undefined ? (
        <>
          {/* Shaded bands over the two margin regions (near edge → start line,
              end line → far edge). pointer-events-none: only the handles drag. */}
          <MarginBand orientation={orientation} from={0} to={startPos} />
          <MarginBand orientation={orientation} from={endPos} to={lengthPx} />
          {/* Draggable handles at the two margin lines. */}
          <MarginHandle
            orientation={orientation}
            pos={startPos}
            onPointerDown={(e) => margins.onSideDown(startSide, e)}
          />
          <MarginHandle
            orientation={orientation}
            pos={endPos}
            onPointerDown={(e) => margins.onSideDown(endSide, e)}
          />
        </>
      ) : null}
    </div>
  );
}

/** Shaded margin region on a ruler bar, from `from`px to `to`px along it. */
function MarginBand({
  orientation,
  from,
  to,
}: {
  orientation: "horizontal" | "vertical";
  from: number;
  to: number;
}) {
  const start = Math.min(from, to);
  const size = Math.max(0, Math.abs(to - from));
  if (size <= 0) return null;
  const isH = orientation === "horizontal";
  return (
    <span
      className="pointer-events-none absolute bg-primary/10"
      style={
        isH
          ? { left: start, top: 0, width: size, bottom: 0 }
          : { top: start, left: 0, height: size, right: 0 }
      }
      aria-hidden="true"
    />
  );
}

/**
 * A Word-style margin handle on the ruler bar (a small accent marker). The
 * visible nub is centred on the margin line; a wider invisible hit-area makes it
 * easy to grab. The drag is armed by the owning overlay (pointer move/up bound
 * there, with capture), so the handle tracks the pointer off the bar too.
 */
function MarginHandle({
  orientation,
  pos,
  onPointerDown,
}: {
  orientation: "horizontal" | "vertical";
  pos: number;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const isH = orientation === "horizontal";
  const HIT = 11; // px hit-area thickness, centred on the line
  return (
    <div
      role="separator"
      aria-orientation={isH ? "vertical" : "horizontal"}
      onPointerDown={onPointerDown}
      className="pointer-events-auto absolute"
      data-margin-handle={isH ? "horizontal" : "vertical"}
      style={
        isH
          ? {
              left: pos - HIT / 2,
              top: 0,
              bottom: 0,
              width: HIT,
              cursor: "col-resize",
            }
          : {
              top: pos - HIT / 2,
              left: 0,
              right: 0,
              height: HIT,
              cursor: "row-resize",
            }
      }
    >
      {/* Visible accent nub centred on the line. */}
      <span
        className="absolute bg-primary"
        style={
          isH
            ? {
                left: HIT / 2 - 3,
                top: 2,
                width: 6,
                height: RULER_THICKNESS_PX - 6,
                borderRadius: 2,
              }
            : {
                top: HIT / 2 - 3,
                left: 2,
                height: 6,
                width: RULER_THICKNESS_PX - 6,
                borderRadius: 2,
              }
        }
      />
    </div>
  );
}

/**
 * Horizontal + vertical rulers anchored to the (position:relative) active page
 * sheet. The bars sit in the gutter above / left of the page via `bottom:100%`
 * / `right:100%`, so they never cover page content. When `margins` is provided,
 * each bar also renders the shaded margin bands + draggable handles.
 */
export function PageRulers({
  pageWidthPts,
  pageHeightPts,
  zoom,
  unit,
  margins,
}: PageRulersProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <RulerBar
        orientation="horizontal"
        lengthPts={pageWidthPts}
        zoom={zoom}
        unit={unit}
        {...(margins ? { margins } : {})}
      />
      <RulerBar
        orientation="vertical"
        lengthPts={pageHeightPts}
        zoom={zoom}
        unit={unit}
        {...(margins ? { margins } : {})}
      />
    </div>
  );
}
