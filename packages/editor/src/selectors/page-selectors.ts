/**
 * Page Selectors - Memoized selectors for page data
 */

import type { UUID, PageObject } from "@giga-pdf/types";
import { useDocumentStore } from "../stores/document-store";
import { useCanvasStore } from "../stores/canvas-store";

/**
 * Get current page based on canvas store
 */
export function useCurrentPage(): PageObject | undefined {
  const currentPageIndex = useCanvasStore((state) => state.currentPageIndex);
  return useDocumentStore((state) => state.pages[currentPageIndex]);
}

/**
 * Get current page ID
 */
export function useCurrentPageId(): UUID | null {
  const currentPageIndex = useCanvasStore((state) => state.currentPageIndex);
  const page = useDocumentStore((state) => state.pages[currentPageIndex]);
  return page?.pageId ?? null;
}

/**
 * Get current page index
 */
export function useCurrentPageIndex(): number {
  return useCanvasStore((state) => state.currentPageIndex);
}

/**
 * Get page dimensions
 */
export function usePageDimensions(pageId: UUID) {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    return page?.dimensions;
  });
}

/**
 * Get page index by ID
 */
export function usePageIndex(pageId: UUID): number {
  return useDocumentStore((state) =>
    state.pages.findIndex((p) => p.pageId === pageId)
  );
}

/**
 * Check if page is first
 */
export function useIsFirstPage(pageId: UUID): boolean {
  return useDocumentStore((state) => {
    const index = state.pages.findIndex((p) => p.pageId === pageId);
    return index === 0;
  });
}

/**
 * Check if page is last
 */
export function useIsLastPage(pageId: UUID): boolean {
  return useDocumentStore((state) => {
    const index = state.pages.findIndex((p) => p.pageId === pageId);
    return index === state.pages.length - 1;
  });
}

/**
 * Get next page
 */
export function useNextPage(pageId: UUID): PageObject | undefined {
  return useDocumentStore((state) => {
    const index = state.pages.findIndex((p) => p.pageId === pageId);
    return state.pages[index + 1];
  });
}

/**
 * Get previous page
 */
export function usePreviousPage(pageId: UUID): PageObject | undefined {
  return useDocumentStore((state) => {
    const index = state.pages.findIndex((p) => p.pageId === pageId);
    return index > 0 ? state.pages[index - 1] : undefined;
  });
}

/**
 * Get page thumbnails
 */
export function usePageThumbnails() {
  return useDocumentStore((state) =>
    state.pages.map((page) => ({
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      thumbnailUrl: page.preview.thumbnailUrl,
    }))
  );
}

/**
 * Get page aspect ratio
 */
export function usePageAspectRatio(pageId: UUID): number | undefined {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    if (!page) return undefined;

    const { width, height, rotation } = page.dimensions;

    // Swap width and height for 90 or 270 degree rotation
    if (rotation === 90 || rotation === 270) {
      return height / width;
    }

    return width / height;
  });
}

/**
 * Check if current page can go to next
 */
export function useCanGoToNextPage(): boolean {
  const currentIndex = useCanvasStore((state) => state.currentPageIndex);
  const pageCount = useDocumentStore((state) => state.pages.length);
  return currentIndex < pageCount - 1;
}

/**
 * Check if current page can go to previous
 */
export function useCanGoToPreviousPage(): boolean {
  const currentIndex = useCanvasStore((state) => state.currentPageIndex);
  return currentIndex > 0;
}
