import { apiClient } from '../client';
import type {
  Element,
  CreateElementRequest,
  UpdateElementRequest,
} from '@giga-pdf/types';

/**
 * Element service (text, images, shapes, etc.)
 *
 * Backend endpoints use page_number (not pageId) in the path:
 *   GET/POST /documents/{document_id}/pages/{page_number}/elements
 *   GET/PATCH/DELETE /documents/{document_id}/elements/{element_id}
 *   PUT /documents/{document_id}/elements/{element_id}/move
 *   POST /documents/{document_id}/elements/{element_id}/duplicate
 *   POST /documents/{document_id}/elements/batch
 */
export const elementService = {
  /**
   * List elements for a specific page
   * Backend: GET /documents/{document_id}/pages/{page_number}/elements
   */
  list: async (documentId: string, pageNumber: number): Promise<Element[]> => {
    const response = await apiClient.get<Element[]>(
      `/documents/${documentId}/pages/${pageNumber}/elements`
    );
    return response.data;
  },

  /**
   * Get a single element
   * Backend: GET /documents/{document_id}/elements/{element_id}
   */
  get: async (documentId: string, elementId: string): Promise<Element> => {
    const response = await apiClient.get<Element>(
      `/documents/${documentId}/elements/${elementId}`
    );
    return response.data;
  },

  /**
   * Create a new element on a specific page
   * Backend: POST /documents/{document_id}/pages/{page_number}/elements
   */
  create: async (
    documentId: string,
    pageNumber: number,
    data: CreateElementRequest
  ): Promise<Element> => {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/pages/${pageNumber}/elements`,
      data
    );
    return response.data;
  },

  /**
   * Update an element
   * Backend: PATCH /documents/{document_id}/elements/{element_id}
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
   * Batch create/update elements
   * Backend: POST /documents/{document_id}/elements/batch
   */
  bulkUpdate: async (
    documentId: string,
    updates: Array<{ id: string; data: UpdateElementRequest }>
  ): Promise<Element[]> => {
    const response = await apiClient.post<Element[]>(
      `/documents/${documentId}/elements/batch`,
      { updates }
    );
    return response.data;
  },

  /**
   * Delete an element
   * Backend: DELETE /documents/{document_id}/elements/{element_id}
   */
  delete: async (documentId: string, elementId: string): Promise<void> => {
    await apiClient.delete(`/documents/${documentId}/elements/${elementId}`);
  },

  /**
   * Bulk delete elements
   * TODO: Backend endpoint not yet implemented
   */
  bulkDelete: async (documentId: string, elementIds: string[]): Promise<void> => {
    await apiClient.post(`/documents/${documentId}/elements/bulk-delete`, {
      element_ids: elementIds,
    });
  },

  /**
   * Duplicate an element
   * Backend: POST /documents/{document_id}/elements/{element_id}/duplicate
   */
  duplicate: async (documentId: string, elementId: string): Promise<Element> => {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/duplicate`
    );
    return response.data;
  },

  /**
   * Move element to a new position
   * Backend: PUT /documents/{document_id}/elements/{element_id}/move
   */
  move: async (
    documentId: string,
    elementId: string,
    position: { x: number; y: number; page_number?: number }
  ): Promise<Element> => {
    const response = await apiClient.put<Element>(
      `/documents/${documentId}/elements/${elementId}/move`,
      position
    );
    return response.data;
  },

  /**
   * Update element z-index (layer order)
   * TODO: Backend endpoint not yet implemented
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
   * TODO: Backend endpoint not yet implemented
   */
  bringToFront: async (documentId: string, elementId: string): Promise<Element> => {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/bring-to-front`
    );
    return response.data;
  },

  /**
   * Send element to back
   * TODO: Backend endpoint not yet implemented
   */
  sendToBack: async (documentId: string, elementId: string): Promise<Element> => {
    const response = await apiClient.post<Element>(
      `/documents/${documentId}/elements/${elementId}/send-to-back`
    );
    return response.data;
  },

  /**
   * Group elements
   * TODO: Backend endpoint not yet implemented
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
   * TODO: Backend endpoint not yet implemented
   */
  ungroup: async (documentId: string, groupId: string): Promise<Element[]> => {
    const response = await apiClient.post<Element[]>(
      `/documents/${documentId}/elements/${groupId}/ungroup`
    );
    return response.data;
  },
};
