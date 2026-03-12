import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uploadService } from '../services/uploads';
import { storageKeys } from './use-storage';
import type { UploadResponse } from '@giga-pdf/types';

/**
 * Query keys for upload-related queries
 */
export const uploadKeys = {
  all: ['uploads'] as const,
  status: (uploadId: string) => [...uploadKeys.all, 'status', uploadId] as const,
};

/**
 * Hook to upload a PDF file directly (multipart/form-data)
 * Backend: POST /documents/upload
 */
export const useUploadDirect = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      file,
      documentData,
      onProgress,
    }: {
      file: File;
      documentData?: {
        title?: string;
        folder_id?: string;
      };
      onProgress?: (progress: number) => void;
    }) => uploadService.uploadDirect(file, documentData, onProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
  });
};

/**
 * Hook to unlock a password-protected document
 * Backend: POST /documents/{document_id}/unlock
 */
export const useUnlockDocument = () => {
  return useMutation({
    mutationFn: ({
      documentId,
      password,
    }: {
      documentId: string;
      password: string;
    }) => uploadService.unlockDocument(documentId, password),
  });
};

/**
 * Hook to get presigned URL for upload
 * TODO: Backend endpoint not yet implemented — use useUploadDirect instead
 */
export const useGetPresignedUrl = () => {
  return useMutation({
    mutationFn: ({
      fileName,
      fileType,
      fileSize,
    }: {
      fileName: string;
      fileType: string;
      fileSize: number;
    }) => uploadService.getPresignedUrl(fileName, fileType, fileSize),
  });
};

/**
 * Hook to upload file to presigned URL
 * TODO: Backend endpoint not yet implemented — use useUploadDirect instead
 */
export const useUploadToPresignedUrl = () => {
  return useMutation({
    mutationFn: ({
      url,
      file,
      onProgress,
    }: {
      url: string;
      file: File;
      onProgress?: (progress: number) => void;
    }) => uploadService.uploadToPresignedUrl(url, file, onProgress),
  });
};

/**
 * Hook to complete upload
 * TODO: Backend endpoint not yet implemented — use useUploadDirect instead
 */
export const useCompleteUpload = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      uploadId,
      documentData,
    }: {
      uploadId: string;
      documentData?: {
        title?: string;
        folder_id?: string;
      };
    }) => uploadService.completeUpload(uploadId, documentData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.documents() });
    },
  });
};

/**
 * Hook to cancel upload
 * TODO: Backend endpoint not yet implemented
 */
export const useCancelUpload = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (uploadId: string) => uploadService.cancelUpload(uploadId),
    onSuccess: (_, uploadId) => {
      queryClient.removeQueries({ queryKey: uploadKeys.status(uploadId) });
    },
  });
};

/**
 * Hook to get upload status
 * TODO: Backend endpoint not yet implemented
 */
export const useUploadStatus = (uploadId: string, enabled = true) => {
  return useQuery({
    queryKey: uploadKeys.status(uploadId),
    queryFn: () => uploadService.getUploadStatus(uploadId),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as UploadResponse | undefined;
      // Refetch every 2 seconds while upload is in progress
      return data && data.status === 'processing' ? 2000 : false;
    },
  });
};

/**
 * Simplified combined hook for direct file upload
 * Uses POST /documents/upload (multipart/form-data)
 */
export const useFileUpload = () => {
  const uploadDirect = useUploadDirect();

  const uploadFile = async (
    file: File,
    documentData?: {
      title?: string;
      folder_id?: string;
    },
    onProgress?: (progress: number) => void
  ) => {
    return uploadDirect.mutateAsync({ file, documentData, onProgress });
  };

  return {
    uploadFile,
    isLoading: uploadDirect.isPending,
    error: uploadDirect.error,
  };
};
