import { apiClient } from '../client';
import type { Page, CreatePageRequest, UpdatePageRequest } from '@giga-pdf/types';

/**
 * Page service
 */
export const pageService = {
  /**
   * List pages for a document
   */
  list: async (documentId: string): Promise<Page[]> => {
    const response = await apiClient.get<Page[]>(`/documents/${documentId}/pages`);
    return response.data;
  },

  /**
   * Get a single page
   */
  get: async (documentId: string, pageId: string): Promise<Page> => {
    const response = await apiClient.get<Page>(
      `/documents/${documentId}/pages/${pageId}`
    );
    return response.data;
  },

  /**
   * Create a new page
   */
  create: async (documentId: string, data: CreatePageRequest): Promise<Page> => {
    const response = await apiClient.post<Page>(`/documents/${documentId}/pages`, data);
    return response.data;
  },

  /**
   * Update a page
   */
  update: async (
    documentId: string,
    pageId: string,
    data: UpdatePageRequest
  ): Promise<Page> => {
    const response = await apiClient.patch<Page>(
      `/documents/${documentId}/pages/${pageId}`,
      data
    );
    return response.data;
  },

  /**
   * Delete a page
   */
  delete: async (documentId: string, pageId: string): Promise<void> => {
    await apiClient.delete(`/documents/${documentId}/pages/${pageId}`);
  },

  /**
   * Duplicate a page
   */
  duplicate: async (documentId: string, pageId: string): Promise<Page> => {
    const response = await apiClient.post<Page>(
      `/documents/${documentId}/pages/${pageId}/duplicate`
    );
    return response.data;
  },

  /**
   * Reorder pages
   */
  reorder: async (documentId: string, pageIds: string[]): Promise<Page[]> => {
    const response = await apiClient.post<Page[]>(
      `/documents/${documentId}/pages/reorder`,
      { page_ids: pageIds }
    );
    return response.data;
  },

  /**
   * Move page to another document
   */
  move: async (
    documentId: string,
    pageId: string,
    targetDocumentId: string,
    position?: number
  ): Promise<Page> => {
    const response = await apiClient.post<Page>(
      `/documents/${documentId}/pages/${pageId}/move`,
      {
        target_document_id: targetDocumentId,
        position,
      }
    );
    return response.data;
  },

  /**
   * Get page thumbnail
   */
  getThumbnail: async (
    documentId: string,
    pageId: string,
    width?: number,
    height?: number
  ): Promise<Blob> => {
    const response = await apiClient.get<Blob>(
      `/documents/${documentId}/pages/${pageId}/thumbnail`,
      {
        params: { width, height },
        responseType: 'blob',
      }
    );
    return response.data;
  },
};
