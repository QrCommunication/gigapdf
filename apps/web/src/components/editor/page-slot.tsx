"use client";

/**
 * page-slot.tsx
 *
 * One virtualised page in the continuous (Word-like) scroller. The slot is an
 * absolutely-positioned, *fixed-size* box (its top/height/width come from the
 * `computePageLayout` slot, so the scroll content never shifts as pages mount
 * or unmount). Inside it sits a {@link PageChrome} sheet.
 *
 * Mounting strategy (the heart of the windowing):
 *   - `isVisible` → mount a real {@link PageCanvasHost} (Fabric canvas). The
 *     focused page uses `mode="full"` (editable overlay); the rest render a
 *     cheap bitmap background only.
 *   - off-window → render a lightweight placeholder (the server thumbnail if we
 *     have one, otherwise a sized skeleton). Zero canvas, zero Fabric — pure DOM.
 *
 * Because the box is pre-sized to the exact rendered page dimensions, swapping
 * between placeholder and canvas causes no layout shift.
 */

import React from "react";
import type { PageObject } from "@giga-pdf/types";
import { PageChrome } from "./page-chrome";
import { PageCanvasHost } from "./page-canvas-host";
import { PageMarginGuides } from "./page-margin-guides";
import { PageRulers } from "./page-rulers";
import { effectivePagePoints } from "./lib/page-layout";
import type { PageMargins } from "./lib/page-margins";
import type { PageRenderPool } from "./lib/page-render-pool";
import type { PageSlot as PageSlotGeometry } from "./lib/page-layout";
import type { RulerUnit } from "./lib/ruler-ticks";

export interface PageSlotProps {
  /** The page to render. */
  page: PageObject;
  /** 0-based index of the page in the document (pool key + active-page key). */
  index: number;
  /** Current zoom factor (1 = 100%): page points → CSS px. */
  zoom: number;
  /** Pre-computed vertical slot geometry (top / height / width in CSS px). */
  slot: PageSlotGeometry;
  /** Whether this page is inside the virtualisation window (mount a canvas). */
  isVisible: boolean;
  /** Whether this page is the active/focused one (editable overlay + ring). */
  isActive: boolean;
  /** Shared canvas + background-render pool. */
  pool: PageRenderPool;
  /** Show the rulers (active page only). */
  showRulers?: boolean;
  /** Ruler display unit. */
  rulerUnit?: RulerUnit;
  /**
   * This page's margins (PDF points), or `null` if unknown / not loaded yet.
   * Draggable margin guides render only when present AND the page is active.
   */
  margins?: PageMargins | null;
  /** Commit new margins (PDF points) for THIS page after a guide is dropped. */
  onMarginsCommit?: (index: number, margins: PageMargins) => void;
  /** Click into the page body → caller sets the active page. */
  onActivate?: (index: number) => void;
  /** Forwarded to the canvas host once the page finishes rendering. */
  onReady?: (index: number) => void;
  /** Forwarded to the canvas host when it releases its pool slot. */
  onDispose?: (index: number) => void;
}

/**
 * A single positioned page in the continuous scroller. Memoised: the parent
 * re-renders on every scroll/visibility change, but a slot only needs to
 * re-render when its own inputs change.
 */
function PageSlotImpl({
  page,
  index,
  zoom,
  slot,
  isVisible,
  isActive,
  pool,
  showRulers = false,
  rulerUnit = "mm",
  margins,
  onMarginsCommit,
  onActivate,
  onReady,
  onDispose,
}: PageSlotProps) {
  // Draggable margin guides on the active page, once its margins are known.
  // The guides map the engine's intrinsic (un-rotated) margins to/from screen
  // space using the page rotation, so they work at any /Rotate.
  const showGuides =
    isActive && margins != null && onMarginsCommit !== undefined;
  // Rulers anchor to the active page; convert its rotated box to displayed points.
  const showPageRulers = isActive && showRulers;
  const pts = effectivePagePoints(page);

  return (
    <div
      className="absolute left-0 right-0 flex justify-center"
      style={{ top: slot.top, height: slot.height }}
      data-page-index={index}
      onMouseDown={onActivate ? () => onActivate(index) : undefined}
    >
      <PageChrome
        width={slot.width}
        height={slot.height}
        pageNumber={page.pageNumber}
        active={isActive}
      >
        {isVisible ? (
          <PageCanvasHost
            page={page}
            index={index}
            scale={zoom}
            mode={isActive ? "full" : "background"}
            pool={pool}
            {...(onReady ? { onReady } : {})}
            {...(onDispose ? { onDispose } : {})}
          />
        ) : (
          <PageSlotPlaceholder
            thumbnailUrl={page.preview?.thumbnailUrl ?? null}
            width={slot.width}
            height={slot.height}
            pageNumber={page.pageNumber}
          />
        )}
        {showPageRulers ? (
          <PageRulers
            pageWidthPts={pts.w}
            pageHeightPts={pts.h}
            zoom={zoom}
            unit={rulerUnit}
          />
        ) : null}
        {showGuides ? (
          <PageMarginGuides
            width={slot.width}
            height={slot.height}
            zoom={zoom}
            margins={margins}
            rotation={page.dimensions.rotation}
            onCommit={(m) => onMarginsCommit(index, m)}
          />
        ) : null}
      </PageChrome>
    </div>
  );
}

export const PageSlot = React.memo(PageSlotImpl);

interface PageSlotPlaceholderProps {
  thumbnailUrl: string | null;
  width: number;
  height: number;
  pageNumber: number;
}

/**
 * Off-window stand-in: a server thumbnail scaled to the slot, or a neutral
 * skeleton. Always fills the (pre-sized) sheet, so no layout shift on swap.
 */
function PageSlotPlaceholder({
  thumbnailUrl,
  width,
  height,
  pageNumber,
}: PageSlotPlaceholderProps) {
  if (thumbnailUrl) {
    // Ephemeral page preview (data: URL or signed S3 URL), not a static asset —
    // next/image would add no value and break on opaque/remote sources.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbnailUrl}
        alt={`Page ${pageNumber}`}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        draggable={false}
        style={{ width, height, display: "block", objectFit: "fill" }}
      />
    );
  }

  return (
    <div
      className="h-full w-full animate-pulse bg-gray-100"
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
