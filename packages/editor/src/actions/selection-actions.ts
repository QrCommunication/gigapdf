/**
 * Selection Actions - Manage element selection
 */

import type { UUID, Bounds } from "@giga-pdf/types";
import { useSelectionStore } from "../stores/selection-store";
import { useDocumentStore } from "../stores/document-store";

/**
 * Select a single element
 */
export function selectElement(
  elementId: UUID,
  pageId: UUID,
  addToSelection = false
): void {
  const selectionStore = useSelectionStore.getState();
  selectionStore.selectElement(elementId, pageId, addToSelection);
}

/**
 * Select multiple elements
 */
export function selectElements(elementIds: UUID[], pageId: UUID): void {
  const selectionStore = useSelectionStore.getState();
  selectionStore.selectElements(elementIds, pageId);
}

/**
 * Deselect an element
 */
export function deselectElement(elementId: UUID): void {
  const selectionStore = useSelectionStore.getState();
  selectionStore.deselectElement(elementId);
}

/**
 * Clear all selections
 */
export function clearSelection(): void {
  const selectionStore = useSelectionStore.getState();
  selectionStore.clearSelection();
}

/**
 * Toggle element selection
 */
export function toggleElement(elementId: UUID, pageId: UUID): void {
  const selectionStore = useSelectionStore.getState();
  selectionStore.toggleElement(elementId, pageId);
}

/**
 * Select all elements on the current page
 */
export function selectAllOnPage(pageId: UUID): void {
  const documentStore = useDocumentStore.getState();
  const selectionStore = useSelectionStore.getState();

  const page = documentStore.pages.find((p) => p.pageId === pageId);
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  const elementIds = page.elements.map((e) => e.elementId);
  selectionStore.selectAll(elementIds, pageId);
}

/**
 * Select elements within a bounds (selection rectangle)
 */
export function selectElementsInBounds(bounds: Bounds, pageId: UUID): void {
  const documentStore = useDocumentStore.getState();
  const selectionStore = useSelectionStore.getState();

  const page = documentStore.pages.find((p) => p.pageId === pageId);
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  // Find elements that intersect with the selection bounds
  const selectedIds = page.elements
    .filter((element) => {
      const elementBounds = element.bounds;
      return (
        elementBounds.x < bounds.x + bounds.width &&
        elementBounds.x + elementBounds.width > bounds.x &&
        elementBounds.y < bounds.y + bounds.height &&
        elementBounds.y + elementBounds.height > bounds.y
      );
    })
    .map((e) => e.elementId);

  selectionStore.selectElements(selectedIds, pageId);
}

/**
 * Check if an element is selected
 */
export function isElementSelected(elementId: UUID): boolean {
  const selectionStore = useSelectionStore.getState();
  return selectionStore.isSelected(elementId);
}

/**
 * Get the number of selected elements
 */
export function getSelectedCount(): number {
  const selectionStore = useSelectionStore.getState();
  return selectionStore.getSelectedCount();
}

/**
 * Get selected element IDs
 */
export function getSelectedElementIds(): UUID[] {
  const selectionStore = useSelectionStore.getState();
  return Array.from(selectionStore.selectedElementIds);
}

/**
 * Get selected page ID
 */
export function getSelectedPageId(): UUID | null {
  const selectionStore = useSelectionStore.getState();
  return selectionStore.selectedPageId;
}

/**
 * Set selection bounds (for drag selection rectangle)
 */
export function setSelectionBounds(bounds: Bounds | null): void {
  const selectionStore = useSelectionStore.getState();
  selectionStore.setSelectionBounds(bounds);
}

/**
 * Set hovered element
 */
export function setHoveredElement(elementId: UUID | null): void {
  const selectionStore = useSelectionStore.getState();
  selectionStore.setHoveredElement(elementId);
}
