import { apiClient } from '../client';
import type { StoredDocument, StorageFolder } from '@giga-pdf/types';

/**
 * Storage service for managing documents and folders (persistent CRUD layer)
 *
 * Backend endpoints: /storage/*  and  /quota/*
 */
export const storageService = {
  // ─── Documents ────────────────────────────────────────────────────────────

  /**
   * List stored documents
   * Backend: GET /storage/documents
   */
  listDocuments: async (params?: {
    folder_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<StoredDocument[]> => {
    const response = await apiClient.get<StoredDocument[]>('/storage/documents', { params });
    return response.data;
  },

  /**
   * Create a document record in storage
   * Backend: POST /storage/documents
   */
  createDocument: async (data: {
    title?: string;
    folder_id?: string;
  }): Promise<StoredDocument> => {
    const response = await apiClient.post<StoredDocument>('/storage/documents', data);
    return response.data;
  },

  /**
   * Load a stored document into the processing engine
   * Backend: POST /storage/documents/{id}/load
   */
  loadDocument: async (id: string): Promise<{ document_id: string }> => {
    const response = await apiClient.post<{ document_id: string }>(
      `/storage/documents/${id}/load`
    );
    return response.data;
  },

  /**
   * Update document metadata
   * Backend: PATCH /storage/documents/{id}
   */
  updateDocument: async (
    id: string,
    data: { title?: string; folder_id?: string }
  ): Promise<StoredDocument> => {
    const response = await apiClient.patch<StoredDocument>(`/storage/documents/${id}`, data);
    return response.data;
  },

  /**
   * Delete a stored document
   * Backend: DELETE /storage/documents/{id}
   */
  deleteDocument: async (id: string): Promise<void> => {
    await apiClient.delete(`/storage/documents/${id}`);
  },

  /**
   * Move a document to a different folder
   * Backend: PATCH /storage/documents/{id}/move
   */
  moveDocument: async (id: string, folderId: string | null): Promise<StoredDocument> => {
    const response = await apiClient.patch<StoredDocument>(
      `/storage/documents/${id}/move`,
      { folder_id: folderId }
    );
    return response.data;
  },

  /**
   * List document versions
   * Backend: GET /storage/documents/{id}/versions
   */
  listVersions: async (id: string): Promise<unknown[]> => {
    const response = await apiClient.get<unknown[]>(`/storage/documents/${id}/versions`);
    return response.data;
  },

  /**
   * Create a new version snapshot
   * Backend: POST /storage/documents/{id}/versions
   */
  createVersion: async (id: string, label?: string): Promise<unknown> => {
    const response = await apiClient.post<unknown>(`/storage/documents/${id}/versions`, {
      label,
    });
    return response.data;
  },

  // ─── Folders ──────────────────────────────────────────────────────────────

  /**
   * List folders
   * Backend: GET /storage/folders
   */
  listFolders: async (): Promise<StorageFolder[]> => {
    const response = await apiClient.get<StorageFolder[]>('/storage/folders');
    return response.data;
  },

  /**
   * Create a folder
   * Backend: POST /storage/folders
   */
  createFolder: async (data: { name: string; parent_id?: string }): Promise<StorageFolder> => {
    const response = await apiClient.post<StorageFolder>('/storage/folders', data);
    return response.data;
  },

  /**
   * Delete a folder
   * Backend: DELETE /storage/folders/{id}
   */
  deleteFolder: async (id: string): Promise<void> => {
    await apiClient.delete(`/storage/folders/${id}`);
  },

  /**
   * Move a folder
   * Backend: PATCH /storage/folders/{id}/move
   */
  moveFolder: async (id: string, parentId: string | null): Promise<StorageFolder> => {
    const response = await apiClient.patch<StorageFolder>(
      `/storage/folders/${id}/move`,
      { parent_id: parentId }
    );
    return response.data;
  },

  /**
   * Get folder statistics
   * Backend: GET /storage/folders/{id}/stats
   */
  getFolderStats: async (id: string): Promise<{
    document_count: number;
    total_size: number;
  }> => {
    const response = await apiClient.get<{
      document_count: number;
      total_size: number;
    }>(`/storage/folders/${id}/stats`);
    return response.data;
  },

  // ─── Quota ────────────────────────────────────────────────────────────────

  /**
   * Get current user's quota usage
   * Backend: GET /quota/me
   */
  getQuota: async (): Promise<{
    used: number;
    limit: number;
    unit: string;
  }> => {
    const response = await apiClient.get<{
      used: number;
      limit: number;
      unit: string;
    }>('/quota/me');
    return response.data;
  },

  /**
   * Get effective quota (after plan overrides)
   * Backend: GET /quota/effective
   */
  getEffectiveQuota: async (): Promise<{
    used: number;
    limit: number;
    unit: string;
  }> => {
    const response = await apiClient.get<{
      used: number;
      limit: number;
      unit: string;
    }>('/quota/effective');
    return response.data;
  },

  /**
   * Get available quota plans
   * Backend: GET /quota/plans
   */
  getQuotaPlans: async (): Promise<unknown[]> => {
    const response = await apiClient.get<unknown[]>('/quota/plans');
    return response.data;
  },
};
