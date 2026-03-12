import { apiClient } from '../client';
import type { ExportJob, ExportRequest, ExportFormat } from '@giga-pdf/types';

/**
 * Export service for PDF generation and downloads
 *
 * Backend endpoints:
 *   POST /documents/{document_id}/export      → create async export job
 *   GET  /documents/{document_id}/export/{job_id} → poll job status
 */
export const exportService = {
  /**
   * Create export job
   * Backend: POST /documents/{document_id}/export
   */
  createExport: async (documentId: string, data: ExportRequest): Promise<ExportJob> => {
    const response = await apiClient.post<ExportJob>(
      `/documents/${documentId}/export`,
      data
    );
    return response.data;
  },

  /**
   * Get export job status
   * Backend: GET /documents/{document_id}/export/{job_id}
   */
  getExportStatus: async (documentId: string, jobId: string): Promise<ExportJob> => {
    const response = await apiClient.get<ExportJob>(
      `/documents/${documentId}/export/${jobId}`
    );
    return response.data;
  },

  /**
   * Download exported file
   * TODO: Backend endpoint not yet implemented — no standalone download URL endpoint
   */
  downloadExport: async (exportId: string): Promise<Blob> => {
    const response = await apiClient.get<Blob>(`/exports/${exportId}/download`, {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Cancel export job
   * Backend: DELETE /jobs/{job_id} (jobs are cancelled via the jobs endpoint)
   */
  cancelExport: async (jobId: string): Promise<void> => {
    await apiClient.delete(`/jobs/${jobId}`);
  },

  /**
   * List export jobs for a document
   * TODO: Backend endpoint not yet implemented
   */
  listExports: async (documentId: string): Promise<ExportJob[]> => {
    const response = await apiClient.get<ExportJob[]>(
      `/documents/${documentId}/exports`
    );
    return response.data;
  },

  /**
   * Export document directly (blocking, returns binary)
   * Backend: POST /documents/{document_id}/export with responseType blob
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
   * TODO: Backend endpoint not yet implemented
   */
  getDownloadUrl: async (exportId: string): Promise<{ url: string; expires_at: string }> => {
    const response = await apiClient.get<{ url: string; expires_at: string }>(
      `/exports/${exportId}/url`
    );
    return response.data;
  },
};
