/**
 * S3 list operations.
 *
 * Handles listing objects and folders in S3-compatible storage.
 */

import {
  ListObjectsV2Command,
  ListObjectsV2CommandInput,
  type _Object,
  type CommonPrefix,
} from '@aws-sdk/client-s3';
import { getS3Client, getS3ConfigFromEnv } from '../client';

/**
 * List options
 */
export interface ListOptions {
  /** Prefix to filter objects (folder path) */
  prefix?: string;
  /** Delimiter for folder-like listing (default: '/') */
  delimiter?: string;
  /** Maximum number of objects to return (default: 1000) */
  maxKeys?: number;
  /** Continuation token for pagination */
  continuationToken?: string;
  /** Start after this key */
  startAfter?: string;
}

/**
 * S3 object metadata
 */
export interface S3Object {
  /** Object key (path) */
  key: string;
  /** Size in bytes */
  size: number;
  /** Last modified date */
  lastModified: Date;
  /** ETag */
  etag: string;
  /** Storage class */
  storageClass?: string;
  /** Object URL */
  url: string;
}

/**
 * S3 folder (common prefix)
 */
export interface S3Folder {
  /** Folder prefix (path) */
  prefix: string;
  /** Folder name */
  name: string;
}

/**
 * List result
 */
export interface ListResult {
  /** List of objects */
  objects: S3Object[];
  /** List of folders (common prefixes) */
  folders: S3Folder[];
  /** Whether there are more results */
  isTruncated: boolean;
  /** Continuation token for next page */
  nextContinuationToken?: string;
  /** Total number of objects returned */
  count: number;
  /** Prefix used for filtering */
  prefix?: string;
}

/**
 * List all options (for recursive listing)
 */
export interface ListAllOptions extends Omit<ListOptions, 'continuationToken' | 'maxKeys'> {
  /** Maximum total objects to retrieve (default: no limit) */
  maxTotal?: number;
  /** Progress callback */
  onProgress?: (count: number) => void;
}

/**
 * List files in S3 bucket
 */
export async function listFiles(options: ListOptions = {}): Promise<ListResult> {
  const { prefix, delimiter = '/', maxKeys = 1000, continuationToken, startAfter } = options;

  const config = getS3ConfigFromEnv();
  const client = getS3Client();

  const input: ListObjectsV2CommandInput = {
    Bucket: config.bucket,
    Prefix: prefix,
    Delimiter: delimiter,
    MaxKeys: maxKeys,
    ContinuationToken: continuationToken,
    StartAfter: startAfter,
  };

  const command = new ListObjectsV2Command(input);
  const response = await client.send(command);

  // Parse objects
  const objects: S3Object[] = (response.Contents || []).map((obj: _Object) => ({
    key: obj.Key!,
    size: obj.Size || 0,
    lastModified: obj.LastModified || new Date(),
    etag: obj.ETag || '',
    storageClass: obj.StorageClass,
    url: `${config.endpoint}/${config.bucket}/${obj.Key}`,
  }));

  // Parse folders
  const folders: S3Folder[] = (response.CommonPrefixes || []).map((cp: CommonPrefix) => ({
    prefix: cp.Prefix!,
    name: cp.Prefix!.split('/').filter(Boolean).pop() || '',
  }));

  return {
    objects,
    folders,
    isTruncated: response.IsTruncated || false,
    nextContinuationToken: response.NextContinuationToken,
    count: objects.length,
    prefix,
  };
}

/**
 * List all files recursively (handles pagination)
 */
export async function listAllFiles(options: ListAllOptions = {}): Promise<S3Object[]> {
  const { prefix, delimiter, startAfter, maxTotal, onProgress } = options;

  const allObjects: S3Object[] = [];
  let continuationToken: string | undefined;
  let hasMore = true;

  while (hasMore) {
    // Check if we've reached the max total
    if (maxTotal && allObjects.length >= maxTotal) {
      break;
    }

    // Calculate remaining keys to fetch
    const maxKeys = maxTotal ? Math.min(1000, maxTotal - allObjects.length) : 1000;

    const result = await listFiles({
      prefix,
      delimiter,
      maxKeys,
      continuationToken,
      startAfter,
    });

    allObjects.push(...result.objects);

    // Report progress
    if (onProgress) {
      onProgress(allObjects.length);
    }

    // Check if there are more results
    hasMore = result.isTruncated;
    continuationToken = result.nextContinuationToken;
  }

  return allObjects;
}

/**
 * List files in a folder (non-recursive)
 */
export async function listFolder(folderPath: string): Promise<ListResult> {
  // Ensure folder path ends with /
  const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;

  return listFiles({
    prefix,
    delimiter: '/',
  });
}

/**
 * Search files by name pattern
 */
export async function searchFiles(pattern: string, prefix?: string): Promise<S3Object[]> {
  const allObjects = await listAllFiles({ prefix, delimiter: '' });

  // Filter by pattern
  const regex = new RegExp(pattern, 'i');
  return allObjects.filter((obj) => regex.test(obj.key));
}

/**
 * Get total size of files in a prefix
 */
export async function getFolderSize(prefix: string): Promise<number> {
  const objects = await listAllFiles({ prefix, delimiter: '' });
  return objects.reduce((total, obj) => total + obj.size, 0);
}

/**
 * Count files in a prefix
 */
export async function countFiles(prefix?: string): Promise<number> {
  const objects = await listAllFiles({ prefix, delimiter: '' });
  return objects.length;
}

/**
 * Check if a prefix (folder) is empty
 */
export async function isFolderEmpty(prefix: string): Promise<boolean> {
  const result = await listFiles({ prefix, maxKeys: 1 });
  return result.objects.length === 0 && result.folders.length === 0;
}

/**
 * Get the most recently modified file
 */
export async function getLatestFile(prefix?: string): Promise<S3Object | null> {
  const objects = await listAllFiles({ prefix, delimiter: '' });

  if (objects.length === 0) {
    return null;
  }

  return objects.reduce((latest, obj) =>
    obj.lastModified > latest.lastModified ? obj : latest
  );
}

/**
 * Get file metadata without downloading
 */
export async function getFileMetadata(key: string): Promise<S3Object | null> {
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');

  const config = getS3ConfigFromEnv();
  const client = getS3Client();

  try {
    const command = new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key,
    });

    const response = await client.send(command);

    return {
      key,
      size: response.ContentLength || 0,
      lastModified: response.LastModified || new Date(),
      etag: response.ETag || '',
      url: `${config.endpoint}/${config.bucket}/${key}`,
    };
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(key: string): Promise<boolean> {
  const metadata = await getFileMetadata(key);
  return metadata !== null;
}
