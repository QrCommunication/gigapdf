import { apiClient } from '../client';
import type { UploadResponse, PresignedUrlResponse } from '@giga-pdf/types';

/**
 * Upload service for file uploads using presigned URLs
 */
export const uploadService = {
  /**
   * Get presigned URL for file upload
   */
  getPresignedUrl: async (
    fileName: string,
    fileType: string,
    fileSize: number
  ): Promise<PresignedUrlResponse> => {
    const response = await apiClient.post<PresignedUrlResponse>('/uploads/presigned-url', {
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize,
    });
    return response.data;
  },

  /**
   * Upload file to presigned URL
   */
  uploadToPresignedUrl: async (
    url: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<void> => {
    await apiClient.put(url, file, {
      headers: {
        'Content-Type': file.type,
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = (progressEvent.loaded / progressEvent.total) * 100;
          onProgress(progress);
        }
      },
    });
  },

  /**
   * Complete upload and create document
   */
  completeUpload: async (
    uploadId: string,
    documentData?: {
      title?: string;
      folder_id?: string;
    }
  ): Promise<UploadResponse> => {
    const response = await apiClient.post<UploadResponse>(
      `/uploads/${uploadId}/complete`,
      documentData
    );
    return response.data;
  },

  /**
   * Upload file directly (small files)
   */
  uploadDirect: async (
    file: File,
    documentData?: {
      title?: string;
      folder_id?: string;
    },
    onProgress?: (progress: number) => void
  ): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    if (documentData?.title) {
      formData.append('title', documentData.title);
    }
    if (documentData?.folder_id) {
      formData.append('folder_id', documentData.folder_id);
    }

    const response = await apiClient.post<UploadResponse>('/uploads/direct', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = (progressEvent.loaded / progressEvent.total) * 100;
          onProgress(progress);
        }
      },
    });
    return response.data;
  },

  /**
   * Cancel upload
   */
  cancelUpload: async (uploadId: string): Promise<void> => {
    await apiClient.delete(`/uploads/${uploadId}`);
  },

  /**
   * Get upload status
   */
  getUploadStatus: async (uploadId: string): Promise<UploadResponse> => {
    const response = await apiClient.get<UploadResponse>(`/uploads/${uploadId}`);
    return response.data;
  },
};
