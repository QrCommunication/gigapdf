/**
 * Page Actions - Add, remove, reorder pages
 */

import type { UUID, PageObject, Dimensions } from "@giga-pdf/types";
import { useDocumentStore } from "../stores/document-store";
import { useHistoryStore } from "../stores/history-store";
import { useCanvasStore } from "../stores/canvas-store";

export interface AddPageOptions {
  index?: number;
  dimensions?: Dimensions & { rotation?: 0 | 90 | 180 | 270 };
  template?: PageObject;
}

export interface RemovePageOptions {
  pageId: UUID;
}

export interface ReorderPageOptions {
  fromIndex: number;
  toIndex: number;
}

export interface DuplicatePageOptions {
  pageId: UUID;
  insertAfter?: boolean;
}

/**
 * Add a new page to the document
 */
export function addPage(options: AddPageOptions = {}): UUID {
  const { index, dimensions, template } = options;
  const documentStore = useDocumentStore.getState();
  const historyStore = useHistoryStore.getState();

  // Save current state to history
  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    "Add page"
  );

  // Generate new page ID
  const pageId = `page-${Date.now()}-${Math.random()}` as UUID;

  // Default dimensions (A4 at 72 DPI)
  const defaultDimensions: Dimensions & { rotation: 0 | 90 | 180 | 270 } = {
    width: 595,
    height: 842,
    rotation: 0,
  };

  // Create new page
  const newPage: PageObject = template
    ? {
        ...template,
        pageId,
        pageNumber: index !== undefined ? index + 1 : documentStore.pages.length + 1,
      }
    : {
        pageId,
        pageNumber: index !== undefined ? index + 1 : documentStore.pages.length + 1,
        dimensions: {
          ...(dimensions || defaultDimensions),
          rotation: (dimensions?.rotation ?? defaultDimensions.rotation) as 0 | 90 | 180 | 270,
        },
        mediaBox: {
          x: 0,
          y: 0,
          width: dimensions?.width || defaultDimensions.width,
          height: dimensions?.height || defaultDimensions.height,
        },
        cropBox: null,
        elements: [],
        preview: {
          thumbnailUrl: null,
          fullUrl: null,
        },
      };

  // Add page at specified index or at the end
  documentStore.addPage(newPage, index);

  return pageId;
}

/**
 * Remove a page from the document
 */
export function removePage(options: RemovePageOptions): void {
  const { pageId } = options;
  const documentStore = useDocumentStore.getState();
  const historyStore = useHistoryStore.getState();
  const canvasStore = useCanvasStore.getState();

  // Don't allow removing the last page
  if (documentStore.pages.length <= 1) {
    throw new Error("Cannot remove the last page");
  }

  // Find page index
  const pageIndex = documentStore.pages.findIndex((p) => p.pageId === pageId);
  if (pageIndex === -1) {
    throw new Error(`Page ${pageId} not found`);
  }

  // Save current state to history
  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    "Remove page"
  );

  // Remove the page
  documentStore.removePage(pageId);

  // Update current page index if necessary
  if (canvasStore.currentPageIndex >= documentStore.pages.length) {
    canvasStore.setCurrentPage(Math.max(0, documentStore.pages.length - 1));
  }
}

/**
 * Reorder pages in the document
 */
export function reorderPages(options: ReorderPageOptions): void {
  const { fromIndex, toIndex } = options;
  const documentStore = useDocumentStore.getState();
  const historyStore = useHistoryStore.getState();

  if (fromIndex === toIndex) {
    return;
  }

  if (
    fromIndex < 0 ||
    fromIndex >= documentStore.pages.length ||
    toIndex < 0 ||
    toIndex >= documentStore.pages.length
  ) {
    throw new Error("Invalid page indices");
  }

  // Save current state to history
  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    "Reorder pages"
  );

  // Reorder the pages
  documentStore.reorderPages(fromIndex, toIndex);
}

/**
 * Duplicate a page
 */
export function duplicatePage(options: DuplicatePageOptions): UUID {
  const { pageId, insertAfter = true } = options;
  const documentStore = useDocumentStore.getState();

  // Find the page to duplicate
  const pageIndex = documentStore.pages.findIndex((p) => p.pageId === pageId);
  if (pageIndex === -1) {
    throw new Error(`Page ${pageId} not found`);
  }

  const page = documentStore.pages[pageIndex];

  // Duplicate the page
  const insertIndex = insertAfter ? pageIndex + 1 : pageIndex;

  return addPage({
    index: insertIndex,
    template: page,
  });
}

/**
 * Update page dimensions
 */
export function updatePageDimensions(
  pageId: UUID,
  dimensions: Dimensions & { rotation?: 0 | 90 | 180 | 270 }
): void {
  const documentStore = useDocumentStore.getState();
  const historyStore = useHistoryStore.getState();

  const page = documentStore.pages.find((p) => p.pageId === pageId);
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  // Save current state to history
  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    "Update page dimensions"
  );

  // Update page dimensions
  documentStore.updatePage(pageId, {
    dimensions: {
      ...page.dimensions,
      ...dimensions,
    },
    mediaBox: {
      ...page.mediaBox,
      width: dimensions.width,
      height: dimensions.height,
    },
  });
}

/**
 * Rotate a page
 */
export function rotatePage(
  pageId: UUID,
  rotation: 0 | 90 | 180 | 270
): void {
  const documentStore = useDocumentStore.getState();
  const historyStore = useHistoryStore.getState();

  const page = documentStore.pages.find((p) => p.pageId === pageId);
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  // Save current state to history
  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    "Rotate page"
  );

  // Update page rotation
  documentStore.updatePage(pageId, {
    dimensions: {
      ...page.dimensions,
      rotation,
    },
  });
}

/**
 * Clear all elements from a page
 */
export function clearPage(pageId: UUID): void {
  const documentStore = useDocumentStore.getState();
  const historyStore = useHistoryStore.getState();

  const page = documentStore.pages.find((p) => p.pageId === pageId);
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  // Save current state to history
  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    "Clear page"
  );

  // Clear all elements
  documentStore.updatePage(pageId, {
    elements: [],
  });
}
