/**
 * View Store - Scroll / viewport tracking for the Word-like continuous view.
 *
 * Tracks which pages are currently visible (virtualization), the active page
 * (the one most in focus), the page the caret/selection lives on, and the raw
 * scroll geometry. Kept separate from the canvas store: the canvas store owns
 * zoom/tool/pan (persistent editor prefs), while this store is pure
 * viewport-derived state recomputed on every scroll/resize.
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import { enableMapSet } from "immer";
import { immer } from "zustand/middleware/immer";

// Immer needs this opt-in to support Set/Map drafts (visiblePages is a Set).
// Idempotent — safe to call even though other stores already enabled it.
enableMapSet();

export interface ViewState {
  /** Indices of pages currently intersecting the viewport (for virtualization). */
  visiblePages: Set<number>;
  /** Index of the page most prominently in view (e.g. covering the viewport centre). */
  activePageIndex: number;
  /** Index of the page the caret / current selection belongs to. */
  currentPageIndex: number;
  /** Raw vertical scroll offset of the page container, in pixels. */
  scrollTop: number;
  /** Viewport height in pixels. */
  viewportHeight: number;
  /** Viewport width in pixels. */
  viewportWidth: number;
  /**
   * True while the user is scrolling fast — lets the renderer downgrade to
   * lightweight page placeholders and skip expensive work until it settles.
   */
  isFastScrolling: boolean;
}

export interface ViewStore extends ViewState {
  /** Replace the whole visible-page set from a list of indices. */
  setVisiblePages: (indices: number[]) => void;
  /** Mark a single page as visible. */
  addVisiblePage: (index: number) => void;
  /** Mark a single page as no longer visible. */
  removeVisiblePage: (index: number) => void;
  setActivePageIndex: (index: number) => void;
  setCurrentPageIndex: (index: number) => void;
  setViewport: (width: number, height: number) => void;
  setScrollTop: (scrollTop: number) => void;
  setFastScrolling: (value: boolean) => void;
  reset: () => void;
}

const initialState: ViewState = {
  visiblePages: new Set<number>(),
  activePageIndex: 0,
  currentPageIndex: 0,
  scrollTop: 0,
  viewportHeight: 0,
  viewportWidth: 0,
  isFastScrolling: false,
};

export const useViewStore: UseBoundStore<StoreApi<ViewStore>> = create<ViewStore>()(
  immer((set) => ({
    ...initialState,

    setVisiblePages: (indices) =>
      set((state) => {
        state.visiblePages = new Set(indices);
      }),

    addVisiblePage: (index) =>
      set((state) => {
        state.visiblePages.add(index);
      }),

    removeVisiblePage: (index) =>
      set((state) => {
        state.visiblePages.delete(index);
      }),

    setActivePageIndex: (index) =>
      set((state) => {
        state.activePageIndex = Math.max(0, index);
      }),

    setCurrentPageIndex: (index) =>
      set((state) => {
        state.currentPageIndex = Math.max(0, index);
      }),

    setViewport: (width, height) =>
      set((state) => {
        state.viewportWidth = Math.max(0, width);
        state.viewportHeight = Math.max(0, height);
      }),

    setScrollTop: (scrollTop) =>
      set((state) => {
        state.scrollTop = Math.max(0, scrollTop);
      }),

    setFastScrolling: (value) =>
      set((state) => {
        state.isFastScrolling = value;
      }),

    // Rebuild a fresh Set so the reset state never aliases the initial Set.
    reset: () =>
      set(() => ({
        ...initialState,
        visiblePages: new Set<number>(),
      })),
  }))
);
