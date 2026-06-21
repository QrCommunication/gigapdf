"use client";

/**
 * continuous-page-view.tsx
 *
 * The Word-like CONTINUOUS, VIRTUALISED multi-page scroller. Every page in the
 * document is stacked vertically in ONE scroll view, but only the pages inside
 * the viewport (plus a buffer band) actually mount a Fabric canvas — the rest
 * are pre-sized DOM placeholders. This keeps a 100+ page document scrolling
 * smoothly: at most a handful of canvases are live (bounded further by the
 * pool's `maxLive` cap).
 *
 * Windowing mechanics:
 *   - `computePageLayout(pages, zoom)` gives each page a fixed vertical slot
 *     (top/height/width). A `position:relative` content div of `totalHeight`
 *     holds the absolutely-positioned slots → the scrollbar is correct and the
 *     content never reflows when pages mount/unmount.
 *   - ONE `IntersectionObserver` (root = the scroll element, `rootMargin` = a
 *     ~2-page buffer band) watches a zero-cost sentinel per page. Intersecting
 *     sentinels — already widened by the buffer band — drive
 *     `viewStore.visiblePages`. Only those pages render a canvas.
 *   - A rAF-throttled scroll handler maps the scroll position to the page in
 *     focus (`pageIndexAtScroll`) → `viewStore.currentPageIndex` (the indicator)
 *     and detects fling velocity → `viewStore.isFastScrolling` (suppresses
 *     canvas hydration mid-fling, hydrates on settle ~120 ms later).
 *
 * Active page: clicking into a page sets it active (`onActivatePage`); the
 * active page renders a real embedded `<EditorCanvas>` (full editing), while the
 * other in-window pages render cheap read-only bitmaps.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import type { PageObject, Element, Bounds, Tool } from "@giga-pdf/types";
import { useViewStore } from "@giga-pdf/editor";
import { clientLogger } from "@/lib/client-logger";
import { PageSlot } from "./page-slot";
import type { EditorCanvasHandle } from "./editor-canvas";
import { PageRenderPool } from "./lib/page-render-pool";
import { computePageLayout, pageIndexAtScroll } from "./lib/page-layout";
import { readAllPageMargins, type PageMargins } from "./lib/page-margins";
import type { RulerUnit } from "./lib/ruler-ticks";

/** Pages of buffer kept mounted on each side of the visible window. */
const BUFFER_PAGES = 2;

/** Milliseconds of scroll stillness before we consider a fling "settled". */
const SETTLE_MS = 120;

/** px/ms scroll speed above which we treat the motion as a fast fling. */
const FAST_SCROLL_VELOCITY = 1.5;

/** Vertical alignment of a page when programmatically scrolled into view. */
export type ScrollAlign = "start" | "center";

export interface ContinuousPageViewHandle {
  /** Smoothly scroll page `index` to the top (`start`) or centre of the view. */
  scrollToPage: (index: number, align?: ScrollAlign) => void;
}

export interface ContinuousPageViewProps {
  /** All pages of the document, in order. */
  pages: PageObject[];
  /** Current zoom factor (1 = 100%). */
  zoom: number;
  /** The PDF binary backing the page backgrounds (single source of truth). */
  pdfFile: File | null;
  /** Document ID (session backend) — forwarded to the active page's EditorCanvas. */
  documentId?: string | null;
  /** Active tool — forwarded to the active page's EditorCanvas (create/select/…). */
  tool?: Tool;
  /** 0-based index of the active/focused page (editable EditorCanvas). */
  activePageIndex: number;
  /** Click into a page → caller updates the active page (+ selection store). */
  onActivatePage: (index: number) => void;
  /** Show the horizontal + vertical rulers along the page edges. */
  showRulers?: boolean;
  /** Display unit for the rulers (px/mm/cm/in/pt). Defaults to "mm". */
  rulerUnit?: RulerUnit;
  /**
   * Commit new margins (PDF points) for a page after its margin guide is
   * dropped. When omitted, the draggable margin guides are not rendered.
   */
  onMarginsCommit?: (index: number, margins: PageMargins) => void;
  /**
   * Resolves the registered FontFace name for an embedded PDF font. Forwarded to
   * the active page's EditorCanvas so the continuous (Word-like) view resolves
   * embedded fonts identically to the single-page editor.
   */
  getFontFaceName?: (originalName: string) => string | null;
  /**
   * Element CREATED at mouse on the ACTIVE page. Wired to the same page.tsx
   * handler as the single-page editor (scene graph + queue + apply-elements
   * bake → save).
   */
  onElementAdded?: (element: Element) => void;
  /**
   * Element moved/resized/rotated or text retyped on the ACTIVE page. Wired to
   * the same page.tsx handler as the single-page editor (queueUpdate →
   * apply-elements bake → save), so continuous editing persists identically.
   */
  onElementModified?: (element: Element, oldBounds?: Bounds) => void;
  /**
   * Z-order change (bringToFront/sendToBack) on the ACTIVE page. Wired to the
   * same page.tsx handler (queueReorder → engine `reorderElement` bake → save).
   */
  onElementReordered?: (element: Element, toFront: boolean) => void;
  /** Element removed on the ACTIVE page (same pipeline as single-page). */
  onElementRemoved?: (elementId: string) => void;
  /** Selection changed on the ACTIVE page (drives the page-scoped panels). */
  onSelectionChanged?: (elementIds: string[]) => void;
  /**
   * The ACTIVE page's imperative handle. Routing this to page.tsx's
   * `setCanvasHandle` makes the toolbar (delete/undo/redo/duplicate/format/
   * addImage) drive the ACTIVE page automatically — the same handle the
   * single-page editor exposes.
   */
  onCanvasReady?: (handle: EditorCanvasHandle) => void;
}

/**
 * Continuous virtualised page scroller. Reads/writes the view store for
 * visibility, focus and scroll telemetry; owns the shared {@link PageRenderPool}.
 */
function ContinuousPageViewImpl(
  {
    pages,
    zoom,
    pdfFile,
    documentId,
    tool,
    activePageIndex,
    onActivatePage,
    showRulers = false,
    rulerUnit = "mm",
    onMarginsCommit,
    getFontFaceName,
    onElementAdded,
    onElementModified,
    onElementReordered,
    onElementRemoved,
    onSelectionChanged,
    onCanvasReady,
  }: ContinuousPageViewProps,
  ref: React.ForwardedRef<ContinuousPageViewHandle>,
) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Layout is pure geometry: recompute only when the page set or zoom changes.
  const { slots, totalHeight } = useMemo(
    () => computePageLayout(pages, zoom),
    [pages, zoom],
  );

  // View-store slices. Selectors only — we read `visiblePages` for rendering and
  // call setters from the observer / scroll handler. Actions are stable in
  // Zustand, so this selector object stays referentially cheap with useShallow.
  const {
    visiblePages,
    isFastScrolling,
    setVisiblePages,
    setCurrentPageIndex,
    setScrollTop,
    setViewport,
    setFastScrolling,
  } = useViewStore(
    useShallow((s) => ({
      visiblePages: s.visiblePages,
      isFastScrolling: s.isFastScrolling,
      setVisiblePages: s.setVisiblePages,
      setCurrentPageIndex: s.setCurrentPageIndex,
      setScrollTop: s.setScrollTop,
      setViewport: s.setViewport,
      setFastScrolling: s.setFastScrolling,
    })),
  );

  // ── Shared render pool, rebuilt when the PDF binary changes ────────────────
  const [pool, setPool] = useState<PageRenderPool | null>(null);

  // Per-page margins (PDF points), read from the binary; drives the draggable
  // guides. `null` entries (or a missing index) → no guides for that page.
  const [pageMargins, setPageMargins] = useState<Array<PageMargins | null>>([]);

  useEffect(() => {
    if (!pdfFile) {
      setPool(null);
      setPageMargins([]);
      return;
    }
    let cancelled = false;
    let created: PageRenderPool | null = null;

    void (async () => {
      try {
        const bytes = await pdfFile.arrayBuffer();
        if (cancelled) {
          return;
        }
        created = new PageRenderPool({ pdfBytes: bytes });
        setPool(created);
        // Read margins off the same bytes (cheap: opens one short-lived doc on
        // the already-loaded engine). Failure is non-fatal — just no guides.
        try {
          const margins = await readAllPageMargins(bytes);
          if (!cancelled) {
            setPageMargins(margins);
          }
        } catch (err) {
          clientLogger.warn("[ContinuousPageView] margin read failed:", err);
          if (!cancelled) {
            setPageMargins([]);
          }
        }
      } catch (err) {
        clientLogger.warn("[ContinuousPageView] pool init failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      created?.dispose();
      setPool(null);
    };
  }, [pdfFile]);

  // ── IntersectionObserver windowing ────────────────────────────────────────
  // One observer (root = scroll element). Each page owns a zero-size sentinel;
  // intersecting sentinels — widened by a ~BUFFER_PAGES band via rootMargin —
  // define the live window. We additionally union an index-based ±BUFFER_PAGES
  // ring so a single missed boundary observation never blanks a page.
  const sentinelsRef = useRef<Array<HTMLDivElement | null>>([]);
  const intersectingRef = useRef<Set<number>>(new Set());
  // Page nearest the viewport centre (from the scroll handler). Always kept in
  // the window so a page taller than the buffer band — whose top sentinel has
  // scrolled out — never blanks while it fills the viewport.
  const focusRef = useRef(0);

  // Trim stale tail entries when the document shrinks. The per-page ref callback
  // assigns by index (JS auto-grows the array), so we only need to drop the
  // overhang here — in an effect, to avoid mutating a ref during render.
  useEffect(() => {
    if (sentinelsRef.current.length > pages.length) {
      sentinelsRef.current.length = pages.length;
    }
  }, [pages.length]);

  const publishVisible = useCallback(() => {
    if (pages.length === 0) {
      setVisiblePages([]);
      return;
    }
    const base = intersectingRef.current;
    const focus = Math.min(Math.max(0, focusRef.current), pages.length - 1);

    let min: number;
    let max: number;
    if (base.size === 0) {
      // Nothing reported intersecting yet (initial mount): seed from the focus
      // page so the top of the document hydrates immediately.
      min = focus;
      max = focus;
    } else {
      min = Number.POSITIVE_INFINITY;
      max = Number.NEGATIVE_INFINITY;
      for (const i of base) {
        if (i < min) min = i;
        if (i > max) max = i;
      }
      // Always keep the focused page in the window (tall-page guard).
      min = Math.min(min, focus);
      max = Math.max(max, focus);
    }

    const from = Math.max(0, min - BUFFER_PAGES);
    const to = Math.min(pages.length - 1, max + BUFFER_PAGES);
    const next: number[] = [];
    for (let i = from; i <= to; i += 1) {
      next.push(i);
    }
    setVisiblePages(next);
  }, [pages.length, setVisiblePages]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || pages.length === 0) {
      return;
    }

    intersectingRef.current = new Set();

    const observer = new IntersectionObserver(
      (entries) => {
        const set = intersectingRef.current;
        for (const entry of entries) {
          const attr = (entry.target as HTMLElement).dataset.pageIndex;
          if (attr === undefined) {
            continue;
          }
          const idx = Number(attr);
          if (Number.isNaN(idx)) {
            continue;
          }
          if (entry.isIntersecting) {
            set.add(idx);
          } else {
            set.delete(idx);
          }
        }
        publishVisible();
      },
      {
        root,
        // Expand the root by a ~BUFFER_PAGES band so neighbours pre-hydrate.
        rootMargin: `${root.clientHeight}px 0px ${root.clientHeight}px 0px`,
        threshold: 0,
      },
    );

    for (const el of sentinelsRef.current) {
      if (el) {
        observer.observe(el);
      }
    }

    // Seed the window before the first intersection callback fires.
    publishVisible();

    return () => observer.disconnect();
    // Re-create the observer when the page count changes (sentinels change) or
    // the layout changes (zoom alters sentinel positions). `publishVisible` is
    // memoised on the page count.
  }, [pages.length, slots, publishVisible]);

  // ── Viewport size tracking (drives the rootMargin buffer + focus maths) ────
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) {
      return;
    }
    const update = () => setViewport(root.clientWidth, root.clientHeight);
    update();

    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const ro = new ResizeObserver(update);
    ro.observe(root);
    return () => ro.disconnect();
  }, [setViewport]);

  // ── rAF-throttled scroll handler: focus page + fling detection ─────────────
  const rafRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef(0);
  const lastScrollTimeRef = useRef(0);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest slots mirrored into a ref so the rAF callback reads current geometry
  // without re-binding (updated in an effect, never during render).
  const slotsRef = useRef(slots);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const root = scrollRef.current;
      if (!root) {
        return;
      }
      const top = root.scrollTop;
      const now = performance.now();

      // Velocity (px/ms) since the previous sample → fling detection.
      const dt = now - lastScrollTimeRef.current;
      const velocity = dt > 0 ? Math.abs(top - lastScrollTopRef.current) / dt : 0;
      lastScrollTopRef.current = top;
      lastScrollTimeRef.current = now;

      setScrollTop(top);

      const currentSlots = slotsRef.current;
      const focus = pageIndexAtScroll(currentSlots, top, root.clientHeight);
      setCurrentPageIndex(focus);

      // Track the focused page and refresh the window when it changes so the
      // mounted set follows slow scrolls and keeps tall pages alive even when
      // their top sentinel has left the IO band.
      if (focus !== focusRef.current) {
        focusRef.current = focus;
        publishVisible();
      }

      if (velocity > FAST_SCROLL_VELOCITY) {
        setFastScrolling(true);
        if (settleTimerRef.current) {
          clearTimeout(settleTimerRef.current);
        }
        settleTimerRef.current = setTimeout(() => {
          setFastScrolling(false);
          settleTimerRef.current = null;
        }, SETTLE_MS);
      }
    });
  }, [setScrollTop, setCurrentPageIndex, setFastScrolling, publishVisible]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
      }
    };
  }, []);

  // ── Imperative scrollToPage (used by sidebar / TOC / header / keyboard) ────
  useImperativeHandle(
    ref,
    () => ({
      scrollToPage: (index: number, align: ScrollAlign = "start") => {
        const root = scrollRef.current;
        const slot = slots[index];
        if (!root || !slot) {
          return;
        }
        const top =
          align === "center"
            ? slot.top - Math.max(0, (root.clientHeight - slot.height) / 2)
            : slot.top;
        root.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      },
    }),
    [slots],
  );

  return (
    <div
      ref={scrollRef}
      className="h-full w-full overflow-auto bg-gray-200"
      onScroll={handleScroll}
    >
      {/* Pre-sized content surface: total document height, absolute children. */}
      <div className="relative mx-auto" style={{ height: totalHeight }}>
        {pages.map((page, index) => {
          const slot = slots[index];
          if (!slot) {
            return null;
          }
          const isActive = index === activePageIndex;
          return (
            <React.Fragment key={page.pageId}>
              {/* Zero-size IO sentinel positioned at the slot top. */}
              <div
                ref={(el) => {
                  sentinelsRef.current[index] = el;
                }}
                data-page-index={index}
                className="pointer-events-none absolute left-0 h-px w-px"
                style={{ top: slot.top }}
                aria-hidden="true"
              />
              {pool ? (
                <PageSlot
                  page={page}
                  index={index}
                  zoom={zoom}
                  slot={slot}
                  // During a fast fling we keep only the active page hydrated and
                  // show cheap placeholders for the rest; the window re-hydrates
                  // ~SETTLE_MS after the scroll stops.
                  isVisible={
                    visiblePages.has(index) &&
                    (!isFastScrolling || isActive)
                  }
                  isActive={isActive}
                  pool={pool}
                  showRulers={showRulers}
                  rulerUnit={rulerUnit}
                  margins={pageMargins[index] ?? null}
                  {...(onMarginsCommit ? { onMarginsCommit } : {})}
                  {...(getFontFaceName ? { getFontFaceName } : {})}
                  {...(isActive ? { documentId } : {})}
                  {...(isActive && tool ? { tool } : {})}
                  {...(isActive && onElementAdded ? { onElementAdded } : {})}
                  {...(isActive && onElementModified
                    ? { onElementModified }
                    : {})}
                  {...(isActive && onElementReordered
                    ? { onElementReordered }
                    : {})}
                  {...(isActive && onElementRemoved
                    ? { onElementRemoved }
                    : {})}
                  {...(isActive && onSelectionChanged
                    ? { onSelectionChanged }
                    : {})}
                  {...(isActive && onCanvasReady ? { onCanvasReady } : {})}
                  onActivate={onActivatePage}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export const ContinuousPageView = forwardRef<
  ContinuousPageViewHandle,
  ContinuousPageViewProps
>(ContinuousPageViewImpl);
