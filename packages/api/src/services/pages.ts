import { apiClient } from '../client';
import type { Page, CreatePageRequest } from '@giga-pdf/types';

/**
 * Page service
 *
 * Backend endpoints use page_number (integer, 1-based) not a page UUID:
 *   GET    /documents/{document_id}/pages/{page_number}
 *   POST   /documents/{document_id}/pages
 *   DELETE /documents/{document_id}/pages/{page_number}
 *   PUT    /documents/{document_id}/pages/reorder
 *   PUT    /documents/{document_id}/pages/{page_number}/rotate
 *   PUT    /documents/{document_id}/pages/{page_number}/resize
 *   POST   /documents/{document_id}/pages/extract
 *   GET    /documents/{document_id}/pages/{page_number}/preview
 */
export const pageService = {
  /**
   * Get a single page by page number
   * Backend: GET /documents/{document_id}/pages/{page_number}
   */
  get: async (documentId: string, pageNumber: number): Promise<Page> => {
    const response = await apiClient.get<Page>(
      `/documents/${documentId}/pages/${pageNumber}`
    );
    return response.data;
  },

  /**
   * Add a new page to a document
   * Backend: POST /documents/{document_id}/pages
   */
  create: async (documentId: string, data: CreatePageRequest): Promise<Page> => {
    const response = await apiClient.post<Page>(`/documents/${documentId}/pages`, data);
    return response.data;
  },

  /**
   * Delete a page by page number
   * Backend: DELETE /documents/{document_id}/pages/{page_number}
   */
  delete: async (documentId: string, pageNumber: number): Promise<void> => {
    await apiClient.delete(`/documents/${documentId}/pages/${pageNumber}`);
  },

  /**
   * Reorder pages
   * Backend: PUT /documents/{document_id}/pages/reorder
   */
  reorder: async (documentId: string, pageOrder: number[]): Promise<Page[]> => {
    const response = await apiClient.put<Page[]>(
      `/documents/${documentId}/pages/reorder`,
      { page_order: pageOrder }
    );
    return response.data;
  },

  /**
   * Rotate a page
   * Backend: PUT /documents/{document_id}/pages/{page_number}/rotate
   */
  rotate: async (
    documentId: string,
    pageNumber: number,
    angle: 90 | 180 | 270
  ): Promise<Page> => {
    const response = await apiClient.put<Page>(
      `/documents/${documentId}/pages/${pageNumber}/rotate`,
      { angle }
    );
    return response.data;
  },

  /**
   * Resize a page
   * Backend: PUT /documents/{document_id}/pages/{page_number}/resize
   */
  resize: async (
    documentId: string,
    pageNumber: number,
    dimensions: { width: number; height: number }
  ): Promise<Page> => {
    const response = await apiClient.put<Page>(
      `/documents/${documentId}/pages/${pageNumber}/resize`,
      dimensions
    );
    return response.data;
  },

  /**
   * Extract pages into a new document
   * Backend: POST /documents/{document_id}/pages/extract
   */
  extract: async (documentId: string, pageNumbers: number[]): Promise<{ document_id: string }> => {
    const response = await apiClient.post<{ document_id: string }>(
      `/documents/${documentId}/pages/extract`,
      { page_numbers: pageNumbers }
    );
    return response.data;
  },

  /**
   * Get page preview image
   * Backend: GET /documents/{document_id}/pages/{page_number}/preview
   */
  getPreview: async (
    documentId: string,
    pageNumber: number,
    params?: { width?: number; height?: number; format?: string }
  ): Promise<Blob> => {
    const response = await apiClient.get<Blob>(
      `/documents/${documentId}/pages/${pageNumber}/preview`,
      {
        params,
        responseType: 'blob',
      }
    );
    return response.data;
  },

  /**
   * Get page image by xref (embedded image in page)
   * Backend: GET /documents/{document_id}/pages/{page_number}/images/{image_xref}
   */
  getPageImage: async (
    documentId: string,
    pageNumber: number,
    imageXref: number
  ): Promise<Blob> => {
    const response = await apiClient.get<Blob>(
      `/documents/${documentId}/pages/${pageNumber}/images/${imageXref}`,
      { responseType: 'blob' }
    );
    return response.data;
  },

  /**
   * Duplicate a page
   * TODO: Backend endpoint not yet implemented
   */
  duplicate: async (documentId: string, pageNumber: number): Promise<Page> => {
    const response = await apiClient.post<Page>(
      `/documents/${documentId}/pages/${pageNumber}/duplicate`
    );
    return response.data;
  },

  /**
   * Move page to another document
   * TODO: Backend endpoint not yet implemented
   */
  move: async (
    documentId: string,
    pageNumber: number,
    targetDocumentId: string,
    position?: number
  ): Promise<Page> => {
    const response = await apiClient.post<Page>(
      `/documents/${documentId}/pages/${pageNumber}/move`,
      {
        target_document_id: targetDocumentId,
        position,
      }
    );
    return response.data;
  },
};
