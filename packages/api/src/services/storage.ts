import { apiClient } from '../client';
import type { StorageInfo, StorageQuota } from '@giga-pdf/types';

/**
 * Storage service for managing user storage
 */
export const storageService = {
  /**
   * Get storage information
   */
  getStorageInfo: async (): Promise<StorageInfo> => {
    const response = await apiClient.get<StorageInfo>('/storage');
    return response.data;
  },

  /**
   * Get storage quota
   */
  getQuota: async (): Promise<StorageQuota> => {
    const response = await apiClient.get<StorageQuota>('/storage/quota');
    return response.data;
  },

  /**
   * Get storage usage by type
   */
  getUsageByType: async (): Promise<{
    documents: number;
    uploads: number;
    exports: number;
    total: number;
  }> => {
    const response = await apiClient.get<{
      documents: number;
      uploads: number;
      exports: number;
      total: number;
    }>('/storage/usage');
    return response.data;
  },

  /**
   * Clean up temporary files
   */
  cleanupTemp: async (): Promise<{ freed_bytes: number; deleted_files: number }> => {
    const response = await apiClient.post<{
      freed_bytes: number;
      deleted_files: number;
    }>('/storage/cleanup');
    return response.data;
  },

  /**
   * Get largest files
   */
  getLargestFiles: async (limit = 10): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      size: number;
      created_at: string;
    }>
  > => {
    const response = await apiClient.get<
      Array<{
        id: string;
        name: string;
        type: string;
        size: number;
        created_at: string;
      }>
    >('/storage/largest', {
      params: { limit },
    });
    return response.data;
  },
};
