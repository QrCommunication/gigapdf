/**
 * Element Selectors - Memoized selectors for element data
 */

import type { UUID, Element, ElementType } from "@giga-pdf/types";
import { useDocumentStore } from "../stores/document-store";

/**
 * Get all elements from a page
 */
export function usePageElements(pageId: UUID): Element[] {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    return page?.elements ?? [];
  });
}

/**
 * Get a specific element by ID
 */
export function useElement(
  pageId: UUID,
  elementId: UUID
): Element | undefined {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    return page?.elements.find((e) => e.elementId === elementId);
  });
}

/**
 * Get elements by type on a page
 */
export function useElementsByType(
  pageId: UUID,
  type: ElementType
): Element[] {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    return page?.elements.filter((e) => e.type === type) ?? [];
  });
}

/**
 * Get element count on a page
 */
export function usePageElementCount(pageId: UUID): number {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    return page?.elements.length ?? 0;
  });
}

/**
 * Get visible elements on a page
 */
export function useVisibleElements(pageId: UUID): Element[] {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    return page?.elements.filter((e) => e.visible) ?? [];
  });
}

/**
 * Get locked elements on a page
 */
export function useLockedElements(pageId: UUID): Element[] {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    return page?.elements.filter((e) => e.locked) ?? [];
  });
}

/**
 * Check if element exists
 */
export function useElementExists(pageId: UUID, elementId: UUID): boolean {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    return page?.elements.some((e) => e.elementId === elementId) ?? false;
  });
}

/**
 * Get elements in a specific layer
 */
export function useElementsByLayer(
  pageId: UUID,
  layerId: UUID | null
): Element[] {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    return page?.elements.filter((e) => e.layerId === layerId) ?? [];
  });
}

/**
 * Get element index (z-order) on a page
 */
export function useElementIndex(pageId: UUID, elementId: UUID): number {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    return page?.elements.findIndex((e) => e.elementId === elementId) ?? -1;
  });
}

/**
 * Check if element is on top (highest z-index)
 */
export function useIsElementOnTop(pageId: UUID, elementId: UUID): boolean {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    if (!page || page.elements.length === 0) return false;
    const topElement = page.elements[page.elements.length - 1];
    return topElement?.elementId === elementId;
  });
}

/**
 * Check if element is on bottom (lowest z-index)
 */
export function useIsElementOnBottom(pageId: UUID, elementId: UUID): boolean {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    if (!page || page.elements.length === 0) return false;
    const bottomElement = page.elements[0];
    return bottomElement?.elementId === elementId;
  });
}

/**
 * Get elements count by type on a page
 */
export function useElementCountByType(pageId: UUID): Record<ElementType, number> {
  return useDocumentStore((state) => {
    const page = state.pages.find((p) => p.pageId === pageId);
    const counts: Record<ElementType, number> = {
      text: 0,
      image: 0,
      shape: 0,
      annotation: 0,
      form_field: 0,
    };

    if (page) {
      page.elements.forEach((element) => {
        counts[element.type]++;
      });
    }

    return counts;
  });
}
