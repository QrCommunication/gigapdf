import { apiClient } from '../client';
import type { Job, JobStatus } from '@giga-pdf/types';

/**
 * Job service for tracking async operations
 */
export const jobService = {
  /**
   * Get job status
   */
  getJob: async (jobId: string): Promise<Job> => {
    const response = await apiClient.get<Job>(`/jobs/${jobId}`);
    return response.data;
  },

  /**
   * List jobs for current user
   */
  listJobs: async (params?: {
    status?: JobStatus;
    type?: string;
    limit?: number;
    offset?: number;
  }): Promise<Job[]> => {
    const response = await apiClient.get<Job[]>('/jobs', { params });
    return response.data;
  },

  /**
   * Cancel a job
   */
  cancelJob: async (jobId: string): Promise<Job> => {
    const response = await apiClient.post<Job>(`/jobs/${jobId}/cancel`);
    return response.data;
  },

  /**
   * Retry a failed job
   */
  retryJob: async (jobId: string): Promise<Job> => {
    const response = await apiClient.post<Job>(`/jobs/${jobId}/retry`);
    return response.data;
  },

  /**
   * Delete a job
   */
  deleteJob: async (jobId: string): Promise<void> => {
    await apiClient.delete(`/jobs/${jobId}`);
  },

  /**
   * Get job result
   */
  getJobResult: async <T = unknown>(jobId: string): Promise<T> => {
    const response = await apiClient.get<T>(`/jobs/${jobId}/result`);
    return response.data;
  },

  /**
   * Clear completed jobs
   */
  clearCompleted: async (): Promise<{ deleted: number }> => {
    const response = await apiClient.post<{ deleted: number }>('/jobs/clear-completed');
    return response.data;
  },
};
