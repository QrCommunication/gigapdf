import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { jobService } from '../services/jobs';
import type { Job, JobStatus } from '@giga-pdf/types';

/**
 * Query keys for job-related queries
 */
export const jobKeys = {
  all: ['jobs'] as const,
  lists: () => [...jobKeys.all, 'list'] as const,
  list: (params?: { status?: JobStatus; type?: string }) =>
    [...jobKeys.lists(), params] as const,
  details: () => [...jobKeys.all, 'detail'] as const,
  detail: (jobId: string) => [...jobKeys.details(), jobId] as const,
  result: (jobId: string) => [...jobKeys.detail(jobId), 'result'] as const,
};

/**
 * Hook to get job status
 */
export const useJob = (jobId: string, enabled = true) => {
  return useQuery({
    queryKey: jobKeys.detail(jobId),
    queryFn: () => jobService.getJob(jobId),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as Job | undefined;
      // Refetch every 2 seconds while job is processing
      return data && (data.status === 'pending' || data.status === 'processing')
        ? 2000
        : false;
    },
  });
};

/**
 * Hook to list jobs
 */
export const useJobs = (params?: {
  status?: JobStatus;
  type?: string;
  limit?: number;
  offset?: number;
}) => {
  return useQuery({
    queryKey: jobKeys.list(params),
    queryFn: () => jobService.listJobs(params),
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * Hook to cancel a job
 */
export const useCancelJob = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => jobService.cancelJob(jobId),
    onSuccess: (data: Job) => {
      queryClient.setQueryData(jobKeys.detail(data.id), data);
      queryClient.invalidateQueries({ queryKey: jobKeys.lists() });
    },
  });
};

/**
 * Hook to retry a failed job
 */
export const useRetryJob = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => jobService.retryJob(jobId),
    onSuccess: (data: Job) => {
      queryClient.setQueryData(jobKeys.detail(data.id), data);
      queryClient.invalidateQueries({ queryKey: jobKeys.lists() });
    },
  });
};

/**
 * Hook to delete a job
 */
export const useDeleteJob = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => jobService.deleteJob(jobId),
    onSuccess: (_, jobId) => {
      queryClient.removeQueries({ queryKey: jobKeys.detail(jobId) });
      queryClient.invalidateQueries({ queryKey: jobKeys.lists() });
    },
  });
};

/**
 * Hook to get job result
 */
export const useJobResult = <T = unknown>(jobId: string, enabled = true) => {
  return useQuery({
    queryKey: jobKeys.result(jobId),
    queryFn: () => jobService.getJobResult<T>(jobId),
    enabled,
  });
};

/**
 * Hook to clear completed jobs
 */
export const useClearCompletedJobs = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: jobService.clearCompleted,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.lists() });
    },
  });
};
