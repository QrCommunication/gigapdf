/**
 * Document Selectors - Memoized selectors for document data
 */

import type { UUID, PageObject } from "@giga-pdf/types";
import { useDocumentStore } from "../stores/document-store";

/**
 * Get current document ID
 */
export function useDocumentId(): UUID | null {
  return useDocumentStore((state) => state.documentId);
}

/**
 * Get document title
 */
export function useDocumentTitle(): string {
  return useDocumentStore((state) => state.title);
}

/**
 * Get document version
 */
export function useDocumentVersion(): number {
  return useDocumentStore((state) => state.version);
}

/**
 * Get all pages
 */
export function usePages(): PageObject[] {
  return useDocumentStore((state) => state.pages);
}

/**
 * Get page count
 */
export function usePageCount(): number {
  return useDocumentStore((state) => state.pages.length);
}

/**
 * Get page by ID
 */
export function usePage(pageId: UUID): PageObject | undefined {
  return useDocumentStore((state) =>
    state.pages.find((p) => p.pageId === pageId)
  );
}

/**
 * Get page by index
 */
export function usePageByIndex(index: number): PageObject | undefined {
  return useDocumentStore((state) => state.pages[index]);
}

/**
 * Check if document is dirty (has unsaved changes)
 */
export function useIsDirty(): boolean {
  return useDocumentStore((state) => state.isDirty);
}

/**
 * Check if document is loading
 */
export function useIsLoading(): boolean {
  return useDocumentStore((state) => state.isLoading);
}

/**
 * Get document error
 */
export function useDocumentError(): string | null {
  return useDocumentStore((state) => state.error);
}

/**
 * Get last saved timestamp
 */
export function useLastSaved(): Date | null {
  return useDocumentStore((state) => state.lastSaved);
}

/**
 * Get total element count across all pages
 */
export function useTotalElementCount(): number {
  return useDocumentStore((state) =>
    state.pages.reduce((total, page) => total + page.elements.length, 0)
  );
}

/**
 * Check if document has pages
 */
export function useHasPages(): boolean {
  return useDocumentStore((state) => state.pages.length > 0);
}

/**
 * Get document statistics
 */
export function useDocumentStats() {
  return useDocumentStore((state) => ({
    pageCount: state.pages.length,
    elementCount: state.pages.reduce(
      (total, page) => total + page.elements.length,
      0
    ),
    isDirty: state.isDirty,
    lastSaved: state.lastSaved,
    version: state.version,
  }));
}
