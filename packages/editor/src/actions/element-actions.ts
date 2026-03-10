/**
 * Element Actions - Create, update, delete elements
 */

import type { UUID, Element, Bounds } from "@giga-pdf/types";
import { useDocumentStore } from "../stores/document-store";
import { useHistoryStore } from "../stores/history-store";
import { useSelectionStore } from "../stores/selection-store";

export interface CreateElementOptions {
  pageId: UUID;
  element: Omit<Element, "elementId">;
}

export interface UpdateElementOptions {
  pageId: UUID;
  elementId: UUID;
  updates: Partial<Element>;
}

export interface DeleteElementOptions {
  pageId: UUID;
  elementId: UUID;
}

export interface MoveElementOptions {
  pageId: UUID;
  elementId: UUID;
  x: number;
  y: number;
}

export interface ResizeElementOptions {
  pageId: UUID;
  elementId: UUID;
  bounds: Bounds;
}

export interface DuplicateElementOptions {
  pageId: UUID;
  elementId: UUID;
  offsetX?: number;
  offsetY?: number;
}

/**
 * Create a new element on a page
 */
export function createElement(options: CreateElementOptions): UUID {
  const { pageId, element } = options;
  const documentStore = useDocumentStore.getState();
  const historyStore = useHistoryStore.getState();

  // Generate new element ID
  const elementId = `element-${Date.now()}-${Math.random()}` as UUID;
  const newElement: Element = {
    ...element,
    elementId,
  } as Element;

  // Find the page and add the element
  const page = documentStore.pages.find((p) => p.pageId === pageId);
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  // Save current state to history
  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    `Create ${element.type} element`
  );

  // Update the page with the new element
  documentStore.updatePage(pageId, {
    elements: [...page.elements, newElement],
  });

  return elementId;
}

/**
 * Update an existing element
 */
export function updateElement(options: UpdateElementOptions): void {
  const { pageId, elementId, updates } = options;
  const documentStore = useDocumentStore.getState();
  const historyStore = useHistoryStore.getState();

  const page = documentStore.pages.find((p) => p.pageId === pageId);
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  const elementIndex = page.elements.findIndex(
    (e) => e.elementId === elementId
  );
  if (elementIndex === -1) {
    throw new Error(`Element ${elementId} not found`);
  }

  // Save current state to history
  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    "Update element"
  );

  // Update the element
  const updatedElements = [...page.elements];
  updatedElements[elementIndex] = {
    ...updatedElements[elementIndex],
    ...updates,
  } as Element;

  documentStore.updatePage(pageId, {
    elements: updatedElements,
  });
}

/**
 * Delete an element from a page
 */
export function deleteElement(options: DeleteElementOptions): void {
  const { pageId, elementId } = options;
  const documentStore = useDocumentStore.getState();
  const historyStore = useHistoryStore.getState();
  const selectionStore = useSelectionStore.getState();

  const page = documentStore.pages.find((p) => p.pageId === pageId);
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  // Save current state to history
  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    "Delete element"
  );

  // Remove the element
  const updatedElements = page.elements.filter(
    (e) => e.elementId !== elementId
  );

  documentStore.updatePage(pageId, {
    elements: updatedElements,
  });

  // Deselect the element if it was selected
  if (selectionStore.isSelected(elementId)) {
    selectionStore.deselectElement(elementId);
  }
}

/**
 * Delete multiple elements at once
 */
export function deleteElements(pageId: UUID, elementIds: UUID[]): void {
  const documentStore = useDocumentStore.getState();
  const historyStore = useHistoryStore.getState();
  const selectionStore = useSelectionStore.getState();

  const page = documentStore.pages.find((p) => p.pageId === pageId);
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  // Save current state to history
  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    `Delete ${elementIds.length} elements`
  );

  // Remove all specified elements
  const elementIdSet = new Set(elementIds);
  const updatedElements = page.elements.filter(
    (e) => !elementIdSet.has(e.elementId)
  );

  documentStore.updatePage(pageId, {
    elements: updatedElements,
  });

  // Clear selection
  selectionStore.clearSelection();
}

/**
 * Move an element to a new position
 */
export function moveElement(options: MoveElementOptions): void {
  const { pageId, elementId, x, y } = options;

  updateElement({
    pageId,
    elementId,
    updates: {
      bounds: {
        x,
        y,
        width: 0, // Will be merged with existing bounds
        height: 0,
      } as Bounds,
    },
  });
}

/**
 * Resize an element
 */
export function resizeElement(options: ResizeElementOptions): void {
  const { pageId, elementId, bounds } = options;

  updateElement({
    pageId,
    elementId,
    updates: { bounds },
  });
}

/**
 * Duplicate an element
 */
export function duplicateElement(options: DuplicateElementOptions): UUID {
  const { pageId, elementId, offsetX = 20, offsetY = 20 } = options;
  const documentStore = useDocumentStore.getState();

  const page = documentStore.pages.find((p) => p.pageId === pageId);
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  const element = page.elements.find((e) => e.elementId === elementId);
  if (!element) {
    throw new Error(`Element ${elementId} not found`);
  }

  // Create a deep copy with offset position
  const duplicatedElement = JSON.parse(JSON.stringify(element)) as Element;
  duplicatedElement.bounds.x += offsetX;
  duplicatedElement.bounds.y += offsetY;

  // Remove elementId so createElement generates a new one
  const { elementId: _, ...elementWithoutId } = duplicatedElement;

  return createElement({
    pageId,
    element: elementWithoutId as Omit<Element, "elementId">,
  });
}

/**
 * Bring element to front (z-index)
 */
export function bringToFront(pageId: UUID, elementId: UUID): void {
  const documentStore = useDocumentStore.getState();
  const historyStore = useHistoryStore.getState();

  const page = documentStore.pages.find((p) => p.pageId === pageId);
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  const elementIndex = page.elements.findIndex(
    (e) => e.elementId === elementId
  );
  if (elementIndex === -1) {
    throw new Error(`Element ${elementId} not found`);
  }

  // Save current state to history
  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    "Bring to front"
  );

  // Move element to end of array (top of z-order)
  const updatedElements = [...page.elements];
  const [element] = updatedElements.splice(elementIndex, 1);
  if (element) {
    updatedElements.push(element);
  }

  documentStore.updatePage(pageId, {
    elements: updatedElements,
  });
}

/**
 * Send element to back (z-index)
 */
export function sendToBack(pageId: UUID, elementId: UUID): void {
  const documentStore = useDocumentStore.getState();
  const historyStore = useHistoryStore.getState();

  const page = documentStore.pages.find((p) => p.pageId === pageId);
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  const elementIndex = page.elements.findIndex(
    (e) => e.elementId === elementId
  );
  if (elementIndex === -1) {
    throw new Error(`Element ${elementId} not found`);
  }

  // Save current state to history
  historyStore.pushSnapshot(
    documentStore.pages,
    documentStore.version,
    "Send to back"
  );

  // Move element to start of array (bottom of z-order)
  const updatedElements = [...page.elements];
  const [element] = updatedElements.splice(elementIndex, 1);
  if (element) {
    updatedElements.unshift(element);
  }

  documentStore.updatePage(pageId, {
    elements: updatedElements,
  });
}
