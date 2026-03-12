import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ocrService } from '../services/ocr';
import type { OcrJob, OcrRequest } from '@giga-pdf/types';

/**
 * Query keys for OCR-related queries
 */
export const ocrKeys = {
  all: ['ocr'] as const,
  status: (documentId: string) => [...ocrKeys.all, 'status', documentId] as const,
  languages: (documentId: string) => [...ocrKeys.all, 'languages', documentId] as const,
  // Legacy keys kept for backward compatibility
  lists: () => [...ocrKeys.all, 'list'] as const,
  list: (documentId: string) => [...ocrKeys.lists(), documentId] as const,
  details: () => [...ocrKeys.all, 'detail'] as const,
  detail: (jobId: string) => [...ocrKeys.details(), jobId] as const,
  results: (jobId: string) => [...ocrKeys.detail(jobId), 'results'] as const,
};

/**
 * Hook to start OCR processing
 * Backend: POST /documents/{document_id}/ocr
 */
export const useStartOcr = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, data }: { documentId: string; data: OcrRequest }) =>
      ocrService.startOcr(documentId, data),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: ocrKeys.status(documentId) });
    },
  });
};

/**
 * Hook to get OCR status for a document
 * Backend: GET /documents/{document_id}/ocr/status
 */
export const useOcrStatus = (documentId: string, enabled = true) => {
  return useQuery({
    queryKey: ocrKeys.status(documentId),
    queryFn: () => ocrService.getOcrStatus(documentId),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as OcrJob | undefined;
      // Refetch every 2 seconds while OCR is processing
      return data && data.status === 'processing' ? 2000 : false;
    },
  });
};

/**
 * Hook to get supported OCR languages
 * Backend: GET /documents/{document_id}/ocr/languages
 */
export const useOcrLanguages = (documentId: string, enabled = true) => {
  return useQuery({
    queryKey: ocrKeys.languages(documentId),
    queryFn: () => ocrService.getOcrLanguages(documentId),
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes — language list rarely changes
  });
};

/**
 * Hook to get OCR results
 * TODO: Backend endpoint not yet implemented
 */
export const useOcrResults = (jobId: string, enabled = true) => {
  return useQuery({
    queryKey: ocrKeys.results(jobId),
    queryFn: () => ocrService.getOcrResults(jobId),
    enabled,
  });
};

/**
 * Hook to cancel OCR job
 * Backend: DELETE /jobs/{job_id}
 */
export const useCancelOcr = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => ocrService.cancelOcr(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrKeys.details() });
    },
  });
};

/**
 * Hook to list OCR jobs for a document
 * TODO: Backend endpoint not yet implemented
 */
export const useOcrJobs = (documentId: string, enabled = true) => {
  return useQuery({
    queryKey: ocrKeys.list(documentId),
    queryFn: () => ocrService.listOcrJobs(documentId),
    enabled,
  });
};

/**
 * Hook to apply OCR results to document
 * TODO: Backend endpoint not yet implemented
 */
export const useApplyOcrResults = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentId,
      jobId,
      options,
    }: {
      documentId: string;
      jobId: string;
      options?: {
        confidence_threshold?: number;
        create_elements?: boolean;
      };
    }) => ocrService.applyOcrResults(documentId, jobId, options),
    onSuccess: (_, { documentId }) => {
      // Invalidate elements as new text elements may have been created
      queryClient.invalidateQueries({ queryKey: ['elements', 'list', documentId] });
    },
  });
};
