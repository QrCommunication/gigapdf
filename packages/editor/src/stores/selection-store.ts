/**
 * Selection Store - Element selection state management
 * Manages selected elements, multi-select, and hover state
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import type { UUID } from "@giga-pdf/types";
import type { SelectionState } from "../types";

// Immer 10+ does NOT make Map/Set draftable by default. Without this opt-in
// every set((state) => state.selectedElementIds.delete(id)) throws
// "[Immer] minified error nr: 0" — the error the user saw on every text
// element delete and on every Fabric onDeselect. Idempotent: safe to call
// multiple times if other stores import it too.
enableMapSet();

export interface SelectionStore extends SelectionState {
  // Actions
  selectElement: (elementId: UUID, pageId: UUID, addToSelection?: boolean) => void;
  selectElements: (elementIds: UUID[], pageId: UUID) => void;
  deselectElement: (elementId: UUID) => void;
  clearSelection: () => void;
  toggleElement: (elementId: UUID, pageId: UUID) => void;
  selectAll: (elementIds: UUID[], pageId: UUID) => void;
  setSelectionBounds: (bounds: SelectionState["selectionBounds"]) => void;
  setHoveredElement: (elementId: UUID | null) => void;
  isSelected: (elementId: UUID) => boolean;
  getSelectedCount: () => number;
  reset: () => void;
}

const initialState: SelectionState = {
  selectedElementIds: new Set(),
  selectedPageId: null,
  isMultiSelect: false,
  selectionBounds: null,
  hoveredElementId: null,
};

export const useSelectionStore: UseBoundStore<StoreApi<SelectionStore>> = create<SelectionStore>()(
  immer((set, get) => ({
    ...initialState,

    selectElement: (elementId, pageId, addToSelection = false) =>
      set((state) => {
        if (addToSelection && state.selectedPageId === pageId) {
          state.selectedElementIds.add(elementId);
          state.isMultiSelect = state.selectedElementIds.size > 1;
        } else {
          state.selectedElementIds = new Set([elementId]);
          state.selectedPageId = pageId;
          state.isMultiSelect = false;
        }
      }),

    selectElements: (elementIds, pageId) =>
      set((state) => {
        state.selectedElementIds = new Set(elementIds);
        state.selectedPageId = pageId;
        state.isMultiSelect = elementIds.length > 1;
      }),

    deselectElement: (elementId) =>
      set((state) => {
        state.selectedElementIds.delete(elementId);
        state.isMultiSelect = state.selectedElementIds.size > 1;
        if (state.selectedElementIds.size === 0) {
          state.selectedPageId = null;
          state.selectionBounds = null;
        }
      }),

    clearSelection: () =>
      set((state) => {
        state.selectedElementIds = new Set();
        state.selectedPageId = null;
        state.isMultiSelect = false;
        state.selectionBounds = null;
      }),

    toggleElement: (elementId, pageId) =>
      set((state) => {
        if (state.selectedElementIds.has(elementId)) {
          state.selectedElementIds.delete(elementId);
          if (state.selectedElementIds.size === 0) {
            state.selectedPageId = null;
            state.selectionBounds = null;
          }
        } else {
          if (state.selectedPageId !== pageId) {
            // Different page, clear previous selection
            state.selectedElementIds = new Set([elementId]);
            state.selectedPageId = pageId;
          } else {
            state.selectedElementIds.add(elementId);
          }
        }
        state.isMultiSelect = state.selectedElementIds.size > 1;
      }),

    selectAll: (elementIds, pageId) =>
      set((state) => {
        state.selectedElementIds = new Set(elementIds);
        state.selectedPageId = pageId;
        state.isMultiSelect = elementIds.length > 1;
      }),

    setSelectionBounds: (bounds) =>
      set((state) => {
        state.selectionBounds = bounds;
      }),

    setHoveredElement: (elementId) =>
      set((state) => {
        state.hoveredElementId = elementId;
      }),

    isSelected: (elementId) => {
      return get().selectedElementIds.has(elementId);
    },

    getSelectedCount: () => {
      return get().selectedElementIds.size;
    },

    reset: () => set(initialState),
  }))
);
