import { apiClient } from '../client';
import type {
  Document,
  CreateDocumentRequest,
  UpdateDocumentRequest,
  PaginatedResponse,
  DocumentListParams,
} from '@giga-pdf/types';

/**
 * Document service
 */
export const documentService = {
  /**
   * List documents with pagination and filtering
   */
  list: async (params?: DocumentListParams): Promise<PaginatedResponse<Document>> => {
    const response = await apiClient.get<PaginatedResponse<Document>>('/documents', {
      params,
    });
    return response.data;
  },

  /**
   * Get a single document by ID
   */
  get: async (id: string): Promise<Document> => {
    const response = await apiClient.get<Document>(`/documents/${id}`);
    return response.data;
  },

  /**
   * Create a new document
   */
  create: async (data: CreateDocumentRequest): Promise<Document> => {
    const response = await apiClient.post<Document>('/documents', data);
    return response.data;
  },

  /**
   * Update a document
   */
  update: async (id: string, data: UpdateDocumentRequest): Promise<Document> => {
    const response = await apiClient.patch<Document>(`/documents/${id}`, data);
    return response.data;
  },

  /**
   * Delete a document
   */
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/documents/${id}`);
  },

  /**
   * Duplicate a document
   */
  duplicate: async (id: string, title?: string): Promise<Document> => {
    const response = await apiClient.post<Document>(`/documents/${id}/duplicate`, {
      title,
    });
    return response.data;
  },

  /**
   * Share a document with collaborators
   */
  share: async (
    id: string,
    data: { email: string; permission: 'view' | 'edit' }[]
  ): Promise<Document> => {
    const response = await apiClient.post<Document>(`/documents/${id}/share`, {
      collaborators: data,
    });
    return response.data;
  },

  /**
   * Remove collaborator from document
   */
  removeCollaborator: async (id: string, userId: string): Promise<Document> => {
    const response = await apiClient.delete<Document>(
      `/documents/${id}/collaborators/${userId}`
    );
    return response.data;
  },

  /**
   * Update collaborator permission
   */
  updateCollaboratorPermission: async (
    id: string,
    userId: string,
    permission: 'view' | 'edit'
  ): Promise<Document> => {
    const response = await apiClient.patch<Document>(
      `/documents/${id}/collaborators/${userId}`,
      { permission }
    );
    return response.data;
  },

  /**
   * Get document history/versions
   */
  getHistory: async (id: string): Promise<unknown[]> => {
    const response = await apiClient.get<unknown[]>(`/documents/${id}/history`);
    return response.data;
  },

  /**
   * Restore document to a specific version
   */
  restoreVersion: async (id: string, versionId: string): Promise<Document> => {
    const response = await apiClient.post<Document>(`/documents/${id}/restore`, {
      version_id: versionId,
    });
    return response.data;
  },
};
