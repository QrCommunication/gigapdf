import { apiClient } from '../client';
import type { ExportJob, ExportRequest, ExportFormat } from '@giga-pdf/types';

/**
 * Export service for PDF generation and downloads
 */
export const exportService = {
  /**
   * Create export job
   */
  createExport: async (documentId: string, data: ExportRequest): Promise<ExportJob> => {
    const response = await apiClient.post<ExportJob>(
      `/documents/${documentId}/exports`,
      data
    );
    return response.data;
  },

  /**
   * Get export job status
   */
  getExportStatus: async (exportId: string): Promise<ExportJob> => {
    const response = await apiClient.get<ExportJob>(`/exports/${exportId}`);
    return response.data;
  },

  /**
   * Download exported file
   */
  downloadExport: async (exportId: string): Promise<Blob> => {
    const response = await apiClient.get<Blob>(`/exports/${exportId}/download`, {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Cancel export job
   */
  cancelExport: async (exportId: string): Promise<void> => {
    await apiClient.delete(`/exports/${exportId}`);
  },

  /**
   * List export jobs for a document
   */
  listExports: async (documentId: string): Promise<ExportJob[]> => {
    const response = await apiClient.get<ExportJob[]>(
      `/documents/${documentId}/exports`
    );
    return response.data;
  },

  /**
   * Export document directly (blocking)
   */
  exportDirect: async (
    documentId: string,
    format: ExportFormat = 'pdf',
    options?: {
      quality?: 'low' | 'medium' | 'high';
      pages?: number[];
      flatten?: boolean;
    }
  ): Promise<Blob> => {
    const response = await apiClient.post<Blob>(
      `/documents/${documentId}/export`,
      {
        format,
        ...options,
      },
      {
        responseType: 'blob',
      }
    );
    return response.data;
  },

  /**
   * Get export download URL (temporary signed URL)
   */
  getDownloadUrl: async (exportId: string): Promise<{ url: string; expires_at: string }> => {
    const response = await apiClient.get<{ url: string; expires_at: string }>(
      `/exports/${exportId}/url`
    );
    return response.data;
  },
};
