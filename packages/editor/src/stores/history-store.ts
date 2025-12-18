/**
 * History Store - Undo/Redo state management
 * Manages history snapshots with a maximum stack size of 50
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { PageObject } from "@giga-pdf/types";
import type { HistoryState, HistorySnapshot } from "../types";

export interface HistoryStore extends HistoryState {
  // Actions
  pushSnapshot: (
    pages: PageObject[],
    version: number,
    description: string
  ) => void;
  undo: () => HistorySnapshot | null;
  redo: () => HistorySnapshot | null;
  clear: () => void;
  clearRedo: () => void;
  getUndoDescription: () => string | null;
  getRedoDescription: () => string | null;
  reset: () => void;
}

const MAX_STACK_SIZE = 50;

const initialState: HistoryState = {
  undoStack: [],
  redoStack: [],
  maxStackSize: MAX_STACK_SIZE,
  canUndo: false,
  canRedo: false,
};

export const useHistoryStore = create<HistoryStore>()(
  immer((set, get) => ({
    ...initialState,

    pushSnapshot: (pages, version, description) =>
      set((state) => {
        const snapshot: HistorySnapshot = {
          id: `snapshot-${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
          documentVersion: version,
          pages: JSON.parse(JSON.stringify(pages)), // Deep clone
          description,
        };

        state.undoStack.push(snapshot);

        // Limit stack size
        if (state.undoStack.length > state.maxStackSize) {
          state.undoStack.shift();
        }

        // Clear redo stack when new action is performed
        state.redoStack = [];

        state.canUndo = state.undoStack.length > 0;
        state.canRedo = false;
      }),

    undo: () => {
      const state = get();
      if (state.undoStack.length === 0) {
        return null;
      }

      const snapshot = state.undoStack[state.undoStack.length - 1];
      if (!snapshot) {
        return null;
      }

      set((draft) => {
        const poppedSnapshot = draft.undoStack.pop();
        if (poppedSnapshot) {
          draft.redoStack.push(poppedSnapshot);
        }

        draft.canUndo = draft.undoStack.length > 0;
        draft.canRedo = draft.redoStack.length > 0;
      });

      return snapshot;
    },

    redo: () => {
      const state = get();
      if (state.redoStack.length === 0) {
        return null;
      }

      const snapshot = state.redoStack[state.redoStack.length - 1];
      if (!snapshot) {
        return null;
      }

      set((draft) => {
        const poppedSnapshot = draft.redoStack.pop();
        if (poppedSnapshot) {
          draft.undoStack.push(poppedSnapshot);

          // Limit stack size
          if (draft.undoStack.length > draft.maxStackSize) {
            draft.undoStack.shift();
          }
        }

        draft.canUndo = draft.undoStack.length > 0;
        draft.canRedo = draft.redoStack.length > 0;
      });

      return snapshot;
    },

    clear: () =>
      set((state) => {
        state.undoStack = [];
        state.redoStack = [];
        state.canUndo = false;
        state.canRedo = false;
      }),

    clearRedo: () =>
      set((state) => {
        state.redoStack = [];
        state.canRedo = false;
      }),

    getUndoDescription: () => {
      const state = get();
      if (state.undoStack.length === 0) {
        return null;
      }
      const lastSnapshot = state.undoStack[state.undoStack.length - 1];
      return lastSnapshot?.description ?? null;
    },

    getRedoDescription: () => {
      const state = get();
      if (state.redoStack.length === 0) {
        return null;
      }
      const lastSnapshot = state.redoStack[state.redoStack.length - 1];
      return lastSnapshot?.description ?? null;
    },

    reset: () => set(initialState),
  }))
);
