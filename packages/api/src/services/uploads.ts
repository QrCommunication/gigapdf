import { apiClient } from '../client';
import type { UploadResponse } from '@giga-pdf/types';

/**
 * Upload service
 *
 * The backend exposes a single multipart upload endpoint:
 *   POST /documents/upload  (multipart/form-data with `file` field)
 *
 * Presigned-URL flow is not implemented on the backend — use uploadDirect instead.
 */
export const uploadService = {
  /**
   * Upload a PDF file directly (multipart/form-data)
   * Backend: POST /documents/upload
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

    const response = await apiClient.post<UploadResponse>('/documents/upload', formData, {
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
   * Unlock a password-protected document
   * Backend: POST /documents/{document_id}/unlock
   */
  unlockDocument: async (documentId: string, password: string): Promise<UploadResponse> => {
    const response = await apiClient.post<UploadResponse>(
      `/documents/${documentId}/unlock`,
      { password }
    );
    return response.data;
  },

  /**
   * Get presigned URL for file upload
   * TODO: Backend endpoint not yet implemented — use uploadDirect instead
   */
  getPresignedUrl: async (
    fileName: string,
    fileType: string,
    fileSize: number
  ): Promise<{ upload_id: string; upload_url: string }> => {
    const response = await apiClient.post<{ upload_id: string; upload_url: string }>(
      '/uploads/presigned-url',
      {
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
      }
    );
    return response.data;
  },

  /**
   * Upload file to presigned URL
   * TODO: Backend endpoint not yet implemented — use uploadDirect instead
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
   * TODO: Backend endpoint not yet implemented — use uploadDirect instead
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
   * Cancel upload
   * TODO: Backend endpoint not yet implemented
   */
  cancelUpload: async (uploadId: string): Promise<void> => {
    await apiClient.delete(`/uploads/${uploadId}`);
  },

  /**
   * Get upload status
   * TODO: Backend endpoint not yet implemented
   */
  getUploadStatus: async (uploadId: string): Promise<UploadResponse> => {
    const response = await apiClient.get<UploadResponse>(`/uploads/${uploadId}`);
    return response.data;
  },
};
