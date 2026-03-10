/**
 * Async job models for long-running operations.
 */

import type { UUID } from "./common";

export type JobType = "ocr" | "export" | "merge" | "split" | "upload" | "convert";

export type JobStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface JobError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface JobObject {
  jobId: UUID;
  type: JobType;
  status: JobStatus;
  progress: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: Record<string, unknown> | null;
  error: JobError | null;
  documentId: UUID | null;
  websocketChannel: string | null;
}

export interface JobListItem {
  jobId: UUID;
  type: JobType;
  status: JobStatus;
  progress: number;
  createdAt: string;
}
