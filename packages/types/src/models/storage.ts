/**
 * Storage models for persistent document storage.
 */

import type { UUID } from "./common";

export interface StoredDocument {
  storedDocumentId: UUID;
  name: string;
  folderId: UUID | null;
  ownerId: string;
  pageCount: number;
  currentVersion: number;
  createdAt: string;
  modifiedAt: string;
  tags: string[];
  thumbnailUrl: string | null;
  isDeleted: boolean;
}

export interface StorageFolder {
  folderId: UUID;
  name: string;
  parentId: UUID | null;
  ownerId: string;
  createdAt: string;
  documentCount: number;
}

export interface DocumentVersion {
  versionId: UUID;
  documentId: UUID;
  versionNumber: number;
  comment: string | null;
  createdBy: string;
  createdAt: string;
  fileSizeBytes: number;
}

export interface PresignedUrlInfo {
  url: string;
  partNumber: number;
  expiresAt: string;
}

export interface StorageInfo {
  usedBytes: number;
  limitBytes: number;
  availableBytes: number;
}
