import { apiClient } from '../client';
import type {
  Element,
  CreateElementRequest,
  UpdateElementRequest,
} from '@giga-pdf/types';

/**
 * Element service (text, images, shapes, etc.)
 */
export const elementService = {
  /**
   * List elements for a document
   */
  list: async (documentId: string, pageId?: string): Promise<Element[]> => {
    const response = await apiClient.get<Element[]>(`/documents/${documentId}/elements`, {
      params: { page_id: pageId },
    });
    return response.data;
  },

  /**
   * Get a single element
   */
  get: async (documentId: string, elementId: string): Promise<Element> => {
    const response = await apiClient.get<Element>(
      `/documents/${documentId}/elements/${elementId}`
    );
    return response.data;
  },

  /**
   * Create a new element
   */
  create: async (documentId: string, data: CreateElementRequest): Promise<Element> => {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements`,
      data
    );
    return response.data;
  },

  /**
   * Update an element
   */
  update: async (
    documentId: string,
    elementId: string,
    data: UpdateElementRequest
  ): Promise<Element> => {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}`,
      data
    );
    return response.data;
  },

  /**
   * Bulk update elements
   */
  bulkUpdate: async (
    documentId: string,
    updates: Array<{ id: string; data: UpdateElementRequest }>
  ): Promise<Element[]> => {
    const response = await apiClient.patch<Element[]>(
      `/documents/${documentId}/elements/bulk`,
      { updates }
    );
    return response.data;
  },

  /**
   * Delete an element
   */
  delete: async (documentId: string, elementId: string): Promise<void> => {
    await apiClient.delete(`/documents/${documentId}/elements/${elementId}`);
  },

  /**
   * Bulk delete elements
   */
  bulkDelete: async (documentId: string, elementIds: string[]): Promise<void> => {
    await apiClient.post(`/documents/${documentId}/elements/bulk-delete`, {
      element_ids: elementIds,
    });
  },

  /**
   * Duplicate an element
   */
  duplicate: async (documentId: string, elementId: string): Promise<Element> => {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/duplicate`
    );
    return response.data;
  },

  /**
   * Update element z-index (layer order)
   */
  updateZIndex: async (
    documentId: string,
    elementId: string,
    zIndex: number
  ): Promise<Element> => {
    const response = await apiClient.patch<Element>(
      `/documents/${documentId}/elements/${elementId}/z-index`,
      { z_index: zIndex }
    );
    return response.data;
  },

  /**
   * Bring element to front
   */
  bringToFront: async (documentId: string, elementId: string): Promise<Element> => {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/bring-to-front`
    );
    return response.data;
  },

  /**
   * Send element to back
   */
  sendToBack: async (documentId: string, elementId: string): Promise<Element> => {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/send-to-back`
    );
    return response.data;
  },

  /**
   * Group elements
   */
  group: async (documentId: string, elementIds: string[]): Promise<Element> => {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/group`,
      { element_ids: elementIds }
    );
    return response.data;
  },

  /**
   * Ungroup elements
   */
  ungroup: async (documentId: string, groupId: string): Promise<Element[]> => {
    const response = await apiClient.post<Element[]>(
      `/documents/${documentId}/elements/${groupId}/ungroup`
    );
    return response.data;
  },
};
