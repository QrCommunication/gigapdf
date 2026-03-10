/**
 * Canvas Store - Canvas and viewport state management
 * Manages zoom, pan, active tool, and viewport dimensions
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Tool } from "@giga-pdf/types";
import type { CanvasState, ViewportDimensions } from "../types";

export interface CanvasStore extends CanvasState {
  // Actions
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
  resetZoom: () => void;
  setPan: (x: number, y: number) => void;
  panBy: (deltaX: number, deltaY: number) => void;
  setActiveTool: (tool: Tool, subtype?: string | null) => void;
  setViewport: (dimensions: ViewportDimensions) => void;
  toggleGrid: () => void;
  setGridEnabled: (enabled: boolean) => void;
  toggleSnapToGrid: () => void;
  setSnapToGrid: (enabled: boolean) => void;
  setGridSize: (size: number) => void;
  toggleRulers: () => void;
  setShowRulers: (show: boolean) => void;
  setCurrentPage: (pageIndex: number) => void;
  nextPage: () => void;
  previousPage: () => void;
  reset: () => void;
}

const initialState: CanvasState = {
  zoom: 1.0,
  minZoom: 0.1,
  maxZoom: 5.0,
  panOffset: { x: 0, y: 0 },
  activeTool: "select",
  activeSubtype: null,
  viewport: { width: 800, height: 600 },
  gridEnabled: false,
  snapToGrid: false,
  gridSize: 10,
  showRulers: false,
  currentPageIndex: 0,
};

export const useCanvasStore: UseBoundStore<StoreApi<CanvasStore>> = create<CanvasStore>()(
  immer((set) => ({
    ...initialState,

    setZoom: (zoom) =>
      set((state) => {
        state.zoom = Math.max(
          state.minZoom,
          Math.min(state.maxZoom, zoom)
        );
      }),

    zoomIn: () =>
      set((state) => {
        const newZoom = state.zoom * 1.2;
        state.zoom = Math.min(state.maxZoom, newZoom);
      }),

    zoomOut: () =>
      set((state) => {
        const newZoom = state.zoom / 1.2;
        state.zoom = Math.max(state.minZoom, newZoom);
      }),

    zoomToFit: () =>
      set((state) => {
        // Calculate zoom to fit current page in viewport
        // This is a simplified calculation - actual implementation
        // would need to consider page dimensions
        state.zoom = 1.0;
        state.panOffset = { x: 0, y: 0 };
      }),

    resetZoom: () =>
      set((state) => {
        state.zoom = 1.0;
        state.panOffset = { x: 0, y: 0 };
      }),

    setPan: (x, y) =>
      set((state) => {
        state.panOffset = { x, y };
      }),

    panBy: (deltaX, deltaY) =>
      set((state) => {
        state.panOffset.x += deltaX;
        state.panOffset.y += deltaY;
      }),

    setActiveTool: (tool, subtype = null) =>
      set((state) => {
        state.activeTool = tool;
        state.activeSubtype = subtype;
      }),

    setViewport: (dimensions) =>
      set((state) => {
        state.viewport = dimensions;
      }),

    toggleGrid: () =>
      set((state) => {
        state.gridEnabled = !state.gridEnabled;
      }),

    setGridEnabled: (enabled) =>
      set((state) => {
        state.gridEnabled = enabled;
      }),

    toggleSnapToGrid: () =>
      set((state) => {
        state.snapToGrid = !state.snapToGrid;
      }),

    setSnapToGrid: (enabled) =>
      set((state) => {
        state.snapToGrid = enabled;
      }),

    setGridSize: (size) =>
      set((state) => {
        state.gridSize = Math.max(1, size);
      }),

    toggleRulers: () =>
      set((state) => {
        state.showRulers = !state.showRulers;
      }),

    setShowRulers: (show) =>
      set((state) => {
        state.showRulers = show;
      }),

    setCurrentPage: (pageIndex) =>
      set((state) => {
        state.currentPageIndex = Math.max(0, pageIndex);
      }),

    nextPage: () =>
      set((state) => {
        state.currentPageIndex += 1;
      }),

    previousPage: () =>
      set((state) => {
        state.currentPageIndex = Math.max(0, state.currentPageIndex - 1);
      }),

    reset: () => set(initialState),
  }))
);
