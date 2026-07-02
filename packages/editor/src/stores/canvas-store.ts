/**
 * Canvas Store - Canvas and viewport state management
 * Manages zoom, pan, active tool, and viewport dimensions
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  Tool,
  ShapeType,
  AnnotationType,
  FieldType,
  FieldCreationKind,
} from "@giga-pdf/types";
import type { CanvasState, RulerUnit, ViewportDimensions } from "../types";

/** Map a creation palette kind to the underlying PDF field type. */
function fieldKindToFieldType(kind: FieldCreationKind): FieldType {
  switch (kind) {
    case "checkbox":
      return "checkbox";
    case "radio_group":
      return "radio";
    case "dropdown":
      return "dropdown";
    case "listbox":
      return "listbox";
    case "text":
    case "multiline":
    case "date":
    default:
      return "text";
  }
}

export interface CanvasStore extends CanvasState {
  // Actions
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
  resetZoom: () => void;
  setFitMode: (mode: CanvasState["fitMode"]) => void;
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
  setViewMode: (mode: CanvasState["viewMode"]) => void;
  setRulerUnit: (unit: RulerUnit) => void;
  setCurrentPage: (pageIndex: number) => void;
  nextPage: () => void;
  previousPage: () => void;
  // Tool options actions
  setShapeType: (shapeType: ShapeType) => void;
  setAnnotationType: (annotationType: AnnotationType) => void;
  setFieldType: (fieldType: FieldType) => void;
  setFieldKind: (fieldKind: FieldCreationKind) => void;
  setStrokeColor: (color: string) => void;
  setFillColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  reset: () => void;
}

const initialState: CanvasState = {
  zoom: 1.0,
  minZoom: 0.1,
  maxZoom: 8.0,
  // Fit the page to the viewport WIDTH on load so the document fills the canvas
  // area (a bare `zoom: 1.0` leaves an A4 page smaller than a wide viewport —
  // "la taille du formulaire est pas bonne, ça doit occuper tout l'espace"). The
  // continuous scroller computes the exact zoom from its live width; a manual
  // zoom clears fitMode upstream, so this only governs the initial view.
  fitMode: "width",
  panOffset: { x: 0, y: 0 },
  activeTool: "select",
  activeSubtype: null,
  viewport: { width: 800, height: 600 },
  gridEnabled: false,
  snapToGrid: false,
  gridSize: 10,
  showRulers: false,
  viewMode: "continuous",
  rulerUnit: "mm",
  currentPageIndex: 0,
  // Tool options defaults
  shapeType: "rectangle",
  annotationType: "highlight",
  fieldType: "text",
  fieldKind: "text",
  strokeColor: "#000000",
  fillColor: "transparent",
  strokeWidth: 2,
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

    setFitMode: (mode) =>
      set((state) => {
        state.fitMode = mode;
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

    setViewMode: (mode) =>
      set((state) => {
        state.viewMode = mode;
      }),

    setRulerUnit: (unit) =>
      set((state) => {
        state.rulerUnit = unit;
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

    // Tool options
    setShapeType: (shapeType) =>
      set((state) => {
        state.shapeType = shapeType;
      }),

    setAnnotationType: (annotationType) =>
      set((state) => {
        state.annotationType = annotationType;
      }),

    setFieldType: (fieldType) =>
      set((state) => {
        state.fieldType = fieldType;
      }),

    // Garde fieldType (type PDF de base) synchronisé : le reste du code
    // (rendu, bake) ne connaît que FieldType — fieldKind n'est qu'un
    // raffinement de création (multiline/date/radio_group).
    setFieldKind: (fieldKind) =>
      set((state) => {
        state.fieldKind = fieldKind;
        state.fieldType = fieldKindToFieldType(fieldKind);
      }),

    setStrokeColor: (color) =>
      set((state) => {
        state.strokeColor = color;
      }),

    setFillColor: (color) =>
      set((state) => {
        state.fillColor = color;
      }),

    setStrokeWidth: (width) =>
      set((state) => {
        state.strokeWidth = Math.max(0.5, width);
      }),

    reset: () => set(initialState),
  }))
);
