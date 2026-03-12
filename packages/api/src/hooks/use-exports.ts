import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { exportService } from '../services/exports';
import type { ExportJob, ExportRequest, ExportFormat } from '@giga-pdf/types';

/**
 * Query keys for export-related queries
 */
export const exportKeys = {
  all: ['exports'] as const,
  lists: () => [...exportKeys.all, 'list'] as const,
  list: (documentId: string) => [...exportKeys.lists(), documentId] as const,
  details: () => [...exportKeys.all, 'detail'] as const,
  detail: (documentId: string, jobId: string) =>
    [...exportKeys.details(), documentId, jobId] as const,
};

/**
 * Hook to create export job
 * Backend: POST /documents/{document_id}/export
 */
export const useCreateExport = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, data }: { documentId: string; data: ExportRequest }) =>
      exportService.createExport(documentId, data),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: exportKeys.list(documentId) });
    },
  });
};

/**
 * Hook to get export status
 * Backend: GET /documents/{document_id}/export/{job_id}
 */
export const useExportStatus = (
  documentId: string,
  jobId: string,
  enabled = true
) => {
  return useQuery({
    queryKey: exportKeys.detail(documentId, jobId),
    queryFn: () => exportService.getExportStatus(documentId, jobId),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as ExportJob | undefined;
      // Refetch every 2 seconds while export is processing
      return data && data.status === 'processing' ? 2000 : false;
    },
  });
};

/**
 * Hook to download exported file
 * TODO: Backend endpoint not yet implemented
 */
export const useDownloadExport = () => {
  return useMutation({
    mutationFn: (exportId: string) => exportService.downloadExport(exportId),
  });
};

/**
 * Hook to cancel export
 * Backend: DELETE /jobs/{job_id}
 */
export const useCancelExport = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => exportService.cancelExport(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: exportKeys.details() });
    },
  });
};

/**
 * Hook to list exports for a document
 * TODO: Backend endpoint not yet implemented
 */
export const useExports = (documentId: string, enabled = true) => {
  return useQuery({
    queryKey: exportKeys.list(documentId),
    queryFn: () => exportService.listExports(documentId),
    enabled,
  });
};

/**
 * Hook to export document directly (blocking)
 * Backend: POST /documents/{document_id}/export
 */
export const useExportDirect = () => {
  return useMutation({
    mutationFn: ({
      documentId,
      format,
      options,
    }: {
      documentId: string;
      format?: ExportFormat;
      options?: {
        quality?: 'low' | 'medium' | 'high';
        pages?: number[];
        flatten?: boolean;
      };
    }) => exportService.exportDirect(documentId, format, options),
  });
};

/**
 * Hook to get export download URL
 * TODO: Backend endpoint not yet implemented
 */
export const useExportDownloadUrl = (exportId: string, enabled = true) => {
  return useQuery({
    queryKey: [...exportKeys.details(), exportId, 'url'],
    queryFn: () => exportService.getDownloadUrl(exportId),
    enabled,
    staleTime: 0, // Always refetch as the URL expires
  });
};

/**
 * Combined hook for full export and download workflow
 */
export const useExportAndDownload = () => {
  const createExport = useCreateExport();
  const downloadExport = useDownloadExport();

  const exportAndDownload = async (
    documentId: string,
    data: ExportRequest,
    onStatusChange?: (status: ExportJob) => void
  ) => {
    // Create export job
    const exportJob = await createExport.mutateAsync({ documentId, data });

    // Poll for completion
    const pollInterval = setInterval(async () => {
      try {
        const status = await exportService.getExportStatus(documentId, exportJob.id);
        if (onStatusChange) onStatusChange(status);

        if (status.status === 'completed') {
          clearInterval(pollInterval);
          // Download the file
          const blob = await downloadExport.mutateAsync(exportJob.id);

          // Create download link
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = status.file_name || `export-${exportJob.id}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        } else if (status.status === 'failed') {
          clearInterval(pollInterval);
          throw new Error(status.error || 'Export failed');
        }
      } catch (error) {
        clearInterval(pollInterval);
        throw error;
      }
    }, 2000);

    return exportJob;
  };

  return {
    exportAndDownload,
    isLoading: createExport.isPending || downloadExport.isPending,
    error: createExport.error || downloadExport.error,
  };
};
