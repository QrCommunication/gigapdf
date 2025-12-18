import { apiClient } from '../client';
import type { OcrJob, OcrRequest, OcrResult } from '@giga-pdf/types';

/**
 * OCR service for text recognition
 */
export const ocrService = {
  /**
   * Start OCR processing for a document or page
   */
  startOcr: async (documentId: string, data: OcrRequest): Promise<OcrJob> => {
    const response = await apiClient.post<OcrJob>(
      `/documents/${documentId}/ocr`,
      data
    );
    return response.data;
  },

  /**
   * Get OCR job status
   */
  getOcrStatus: async (jobId: string): Promise<OcrJob> => {
    const response = await apiClient.get<OcrJob>(`/ocr/${jobId}`);
    return response.data;
  },

  /**
   * Get OCR results
   */
  getOcrResults: async (jobId: string): Promise<OcrResult> => {
    const response = await apiClient.get<OcrResult>(`/ocr/${jobId}/results`);
    return response.data;
  },

  /**
   * Cancel OCR job
   */
  cancelOcr: async (jobId: string): Promise<void> => {
    await apiClient.delete(`/ocr/${jobId}`);
  },

  /**
   * List OCR jobs for a document
   */
  listOcrJobs: async (documentId: string): Promise<OcrJob[]> => {
    const response = await apiClient.get<OcrJob[]>(`/documents/${documentId}/ocr`);
    return response.data;
  },

  /**
   * Apply OCR results to document (create text elements)
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
