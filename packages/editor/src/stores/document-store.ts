/**
 * Document Store - Main document state management.
 *
 * @deprecated As of 2026-05-01, the canonical scene graph for the web editor
 * lives in `apps/web/src/hooks/use-document.ts` (a React useState-based hook)
 * which talks directly to /api/pdf/parse-from-s3 and merges Redis backend
 * elements at reload (see fix #1 Option C). This Zustand store and its
 * selectors / actions / middleware are NOT consumed by any app today and
 * exist as dead code awaiting a future unified state strategy.
 *
 * If you find yourself reaching for useDocumentStore, prefer:
 *   - In apps/web: useDocument() from `@/hooks/use-document`
 *   - For new shared logic: build it into use-document instead, OR migrate
 *     use-document into this store in a single refactor PR (do NOT mirror
 *     state across both — you'll get drift bugs that are very hard to debug).
 *
 * Manages document metadata, pages, and elements.
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { UUID, PageObject } from "@giga-pdf/types";
import type { DocumentState } from "../types";

export interface DocumentStore extends DocumentState {
  // Actions
  setDocument: (documentId: UUID, title: string, pages: PageObject[]) => void;
  updateTitle: (title: string) => void;
  setPages: (pages: PageObject[]) => void;
  addPage: (page: PageObject, index?: number) => void;
  removePage: (pageId: UUID) => void;
  updatePage: (pageId: UUID, updates: Partial<PageObject>) => void;
  reorderPages: (fromIndex: number, toIndex: number) => void;
  setVersion: (version: number) => void;
  setDirty: (isDirty: boolean) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  markSaved: () => void;
  reset: () => void;
}

const initialState: DocumentState = {
  documentId: null,
  title: "Untitled Document",
  version: 0,
  pages: [],
  lastSaved: null,
  isDirty: false,
  isLoading: false,
  error: null,
};

export const useDocumentStore: UseBoundStore<StoreApi<DocumentStore>> = create<DocumentStore>()(
  immer((set) => ({
    ...initialState,

    setDocument: (documentId, title, pages) =>
      set((state) => {
        state.documentId = documentId;
        state.title = title;
        state.pages = pages;
        state.version = 0;
        state.isDirty = false;
        state.error = null;
      }),

    updateTitle: (title) =>
      set((state) => {
        state.title = title;
        state.isDirty = true;
      }),

    setPages: (pages) =>
      set((state) => {
        state.pages = pages;
        state.isDirty = true;
      }),

    addPage: (page, index) =>
      set((state) => {
        if (index !== undefined && index >= 0 && index <= state.pages.length) {
          state.pages.splice(index, 0, page);
        } else {
          state.pages.push(page);
        }
        state.isDirty = true;
      }),

    removePage: (pageId) =>
      set((state) => {
        const index = state.pages.findIndex((p) => p.pageId === pageId);
        if (index !== -1) {
          state.pages.splice(index, 1);
          // Update page numbers
          state.pages.forEach((p, idx) => {
            p.pageNumber = idx + 1;
          });
          state.isDirty = true;
        }
      }),

    updatePage: (pageId, updates) =>
      set((state) => {
        const pageIndex = state.pages.findIndex((p) => p.pageId === pageId);
        if (pageIndex !== -1 && state.pages[pageIndex]) {
          Object.assign(state.pages[pageIndex]!, updates);
          state.isDirty = true;
        }
      }),

    reorderPages: (fromIndex, toIndex) =>
      set((state) => {
        if (
          fromIndex < 0 ||
          fromIndex >= state.pages.length ||
          toIndex < 0 ||
          toIndex >= state.pages.length
        ) {
          return;
        }

        const [movedPage] = state.pages.splice(fromIndex, 1);
        if (movedPage) {
          state.pages.splice(toIndex, 0, movedPage);
        }

        // Update page numbers
        state.pages.forEach((p, idx) => {
          p.pageNumber = idx + 1;
        });

        state.isDirty = true;
      }),

    setVersion: (version) =>
      set((state) => {
        state.version = version;
      }),

    setDirty: (isDirty) =>
      set((state) => {
        state.isDirty = isDirty;
      }),

    setLoading: (isLoading) =>
      set((state) => {
        state.isLoading = isLoading;
      }),

    setError: (error) =>
      set((state) => {
        state.error = error;
      }),

    markSaved: () =>
      set((state) => {
        state.lastSaved = new Date();
        state.isDirty = false;
      }),

    reset: () => set(initialState),
  }))
);
