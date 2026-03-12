import { apiClient } from '../client';
import type { Job, JobStatus } from '@giga-pdf/types';

/**
 * Job service for tracking async operations
 *
 * Backend endpoints:
 *   GET    /jobs/{job_id}   → get job status
 *   DELETE /jobs/{job_id}   → delete/cancel a job
 */
export const jobService = {
  /**
   * Get job status
   * Backend: GET /jobs/{job_id}
   */
  getJob: async (jobId: string): Promise<Job> => {
    const response = await apiClient.get<Job>(`/jobs/${jobId}`);
    return response.data;
  },

  /**
   * Delete a job
   * Backend: DELETE /jobs/{job_id}
   */
  deleteJob: async (jobId: string): Promise<void> => {
    await apiClient.delete(`/jobs/${jobId}`);
  },

  /**
   * List jobs for current user
   * TODO: Backend endpoint not yet implemented
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
   * TODO: Backend endpoint not yet implemented — use deleteJob to remove the job
   */
  cancelJob: async (jobId: string): Promise<Job> => {
    const response = await apiClient.post<Job>(`/jobs/${jobId}/cancel`);
    return response.data;
  },

  /**
   * Retry a failed job
   * TODO: Backend endpoint not yet implemented
   */
  retryJob: async (jobId: string): Promise<Job> => {
    const response = await apiClient.post<Job>(`/jobs/${jobId}/retry`);
    return response.data;
  },

  /**
   * Get job result
   * TODO: Backend endpoint not yet implemented — poll getJob until status is completed
   */
  getJobResult: async <T = unknown>(jobId: string): Promise<T> => {
    const response = await apiClient.get<T>(`/jobs/${jobId}/result`);
    return response.data;
  },

  /**
   * Clear completed jobs
   * TODO: Backend endpoint not yet implemented
   */
  clearCompleted: async (): Promise<{ deleted: number }> => {
    const response = await apiClient.post<{ deleted: number }>('/jobs/clear-completed');
    return response.data;
  },
};
