import { apiClient } from '../client';
import type { OcrJob, OcrRequest, OcrResult } from '@giga-pdf/types';

/**
 * OCR service for text recognition
 *
 * Backend endpoints:
 *   POST /documents/{document_id}/ocr              → start OCR
 *   GET  /documents/{document_id}/ocr/status       → get OCR status
 *   GET  /documents/{document_id}/ocr/languages    → list supported languages
 */
export const ocrService = {
  /**
   * Start OCR processing for a document
   * Backend: POST /documents/{document_id}/ocr
   */
  startOcr: async (documentId: string, data: OcrRequest): Promise<OcrJob> => {
    const response = await apiClient.post<OcrJob>(
      `/documents/${documentId}/ocr`,
      data
    );
    return response.data;
  },

  /**
   * Get OCR status for a document
   * Backend: GET /documents/{document_id}/ocr/status
   */
  getOcrStatus: async (documentId: string): Promise<OcrJob> => {
    const response = await apiClient.get<OcrJob>(
      `/documents/${documentId}/ocr/status`
    );
    return response.data;
  },

  /**
   * Get OCR results
   * TODO: Backend endpoint not yet implemented — no dedicated results endpoint
   */
  getOcrResults: async (jobId: string): Promise<OcrResult> => {
    const response = await apiClient.get<OcrResult>(`/ocr/${jobId}/results`);
    return response.data;
  },

  /**
   * Cancel OCR job
   * Backend: DELETE /jobs/{job_id} (jobs cancelled via the jobs endpoint)
   */
  cancelOcr: async (jobId: string): Promise<void> => {
    await apiClient.delete(`/jobs/${jobId}`);
  },

  /**
   * Get supported OCR languages for a document
   * Backend: GET /documents/{document_id}/ocr/languages
   */
  getOcrLanguages: async (documentId: string): Promise<string[]> => {
    const response = await apiClient.get<string[]>(
      `/documents/${documentId}/ocr/languages`
    );
    return response.data;
  },

  /**
   * List OCR jobs for a document
   * TODO: Backend endpoint not yet implemented
   */
  listOcrJobs: async (documentId: string): Promise<OcrJob[]> => {
    const response = await apiClient.get<OcrJob[]>(`/documents/${documentId}/ocr`);
    return response.data;
  },

  /**
   * Apply OCR results to document (create text elements)
   * TODO: Backend endpoint not yet implemented
   */
  applyOcrResults: async (
    documentId: string,
    jobId: string,
    options?: {
      confidence_threshold?: number;
      create_elements?: boolean;
    }
  ): Promise<{ message: string; elements_created: number }> => {
    const response = await apiClient.post<{
      message: string;
      elements_created: number;
    }>(`/documents/${documentId}/ocr/${jobId}/apply`, options);
    return response.data;
  },
};
