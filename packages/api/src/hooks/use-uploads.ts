import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uploadService } from '../services/uploads';
import { documentKeys } from './use-documents';
import type { UploadResponse } from '@giga-pdf/types';

/**
 * Query keys for upload-related queries
 */
export const uploadKeys = {
  all: ['uploads'] as const,
  status: (uploadId: string) => [...uploadKeys.all, 'status', uploadId] as const,
};

/**
 * Hook to get presigned URL for upload
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
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
};

/**
 * Hook to upload file directly
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
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
};

/**
 * Hook to cancel upload
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
 * Combined hook for full upload workflow with presigned URL
 */
export const useFileUpload = () => {
  const getPresignedUrl = useGetPresignedUrl();
  const uploadToUrl = useUploadToPresignedUrl();
  const completeUpload = useCompleteUpload();

  const uploadFile = async (
    file: File,
    documentData?: {
      title?: string;
      folder_id?: string;
    },
    onProgress?: (progress: number) => void
  ) => {
    // Step 1: Get presigned URL
    const { upload_id, upload_url } = await getPresignedUrl.mutateAsync({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    });

    // Step 2: Upload to presigned URL
    await uploadToUrl.mutateAsync({
      url: upload_url,
      file,
      onProgress,
    });

    // Step 3: Complete upload
    const result = await completeUpload.mutateAsync({
      uploadId: upload_id,
      documentData,
    });

    return result;
  };

  return {
    uploadFile,
    isLoading:
      getPresignedUrl.isPending || uploadToUrl.isPending || completeUpload.isPending,
    error: getPresignedUrl.error || uploadToUrl.error || completeUpload.error,
  };
};
