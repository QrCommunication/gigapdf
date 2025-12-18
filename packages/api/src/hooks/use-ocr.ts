import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ocrService } from '../services/ocr';
import type { OcrJob, OcrRequest } from '@giga-pdf/types';

/**
 * Query keys for OCR-related queries
 */
export const ocrKeys = {
  all: ['ocr'] as const,
  lists: () => [...ocrKeys.all, 'list'] as const,
  list: (documentId: string) => [...ocrKeys.lists(), documentId] as const,
  details: () => [...ocrKeys.all, 'detail'] as const,
  detail: (jobId: string) => [...ocrKeys.details(), jobId] as const,
  results: (jobId: string) => [...ocrKeys.detail(jobId), 'results'] as const,
};

/**
 * Hook to start OCR processing
 */
export const useStartOcr = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, data }: { documentId: string; data: OcrRequest }) =>
      ocrService.startOcr(documentId, data),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: ocrKeys.list(documentId) });
    },
  });
};

/**
 * Hook to get OCR job status
 */
export const useOcrStatus = (jobId: string, enabled = true) => {
  return useQuery({
    queryKey: ocrKeys.detail(jobId),
    queryFn: () => ocrService.getOcrStatus(jobId),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as OcrJob | undefined;
      // Refetch every 2 seconds while OCR is processing
      return data && data.status === 'processing' ? 2000 : false;
    },
  });
};

/**
 * Hook to get OCR results
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
 */
export const useCancelOcr = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => ocrService.cancelOcr(jobId),
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: ocrKeys.detail(jobId) });
    },
  });
};

/**
 * Hook to list OCR jobs for a document
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
