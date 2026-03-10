/**
 * S3 delete operations.
 *
 * Handles single and batch file deletion from S3-compatible storage.
 */

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  type ObjectIdentifier,
} from '@aws-sdk/client-s3';
import { getS3Client, getS3ConfigFromEnv } from '../client';

/**
 * Delete options
 */
export interface DeleteOptions {
  /** S3 object key (path in bucket) */
  key: string;
  /** Version ID for versioned objects */
  versionId?: string;
}

/**
 * Delete result
 */
export interface DeleteResult {
  /** S3 object key */
  key: string;
  /** Whether the deletion was successful */
  success: boolean;
  /** Version ID if applicable */
  versionId?: string;
}

/**
 * Batch delete options
 */
export interface BatchDeleteOptions {
  /** Array of object keys to delete */
  keys: string[];
  /** Whether to continue on error (default: true) */
  continueOnError?: boolean;
}

/**
 * Batch delete result
 */
export interface BatchDeleteResult {
  /** Successfully deleted objects */
  deleted: DeleteResult[];
  /** Failed deletions with errors */
  errors: Array<{
    key: string;
    code?: string;
    message?: string;
  }>;
  /** Total number of objects processed */
  total: number;
  /** Number of successful deletions */
  successCount: number;
  /** Number of failed deletions */
  errorCount: number;
}

/**
 * Delete a single file from S3
 */
export async function deleteFile(options: DeleteOptions): Promise<DeleteResult> {
  const { key, versionId } = options;

  const config = getS3ConfigFromEnv();
  const client = getS3Client();

  const command = new DeleteObjectCommand({
    Bucket: config.bucket,
    Key: key,
    VersionId: versionId,
  });

  try {
    const response = await client.send(command);

    return {
      key,
      success: true,
      versionId: response.VersionId,
    };
  } catch (error) {
    return {
      key,
      success: false,
    };
  }
}

/**
 * Delete multiple files from S3
 */
export async function deleteFiles(options: BatchDeleteOptions): Promise<BatchDeleteResult> {
  const { keys, continueOnError = true } = options;

  if (keys.length === 0) {
    return {
      deleted: [],
      errors: [],
      total: 0,
      successCount: 0,
      errorCount: 0,
    };
  }

  const config = getS3ConfigFromEnv();
  const client = getS3Client();

  // S3 allows up to 1000 objects per delete request
  const BATCH_SIZE = 1000;
  const batches: string[][] = [];

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    batches.push(keys.slice(i, i + BATCH_SIZE));
  }

  const deleted: DeleteResult[] = [];
  const errors: Array<{ key: string; code?: string; message?: string }> = [];

  for (const batch of batches) {
    const objects: ObjectIdentifier[] = batch.map((key) => ({ Key: key }));

    const command = new DeleteObjectsCommand({
      Bucket: config.bucket,
      Delete: {
        Objects: objects,
        Quiet: false,
      },
    });

    try {
      const response = await client.send(command);

      // Add successful deletions
      if (response.Deleted) {
        for (const item of response.Deleted) {
          if (item.Key) {
            deleted.push({
              key: item.Key,
              success: true,
              versionId: item.VersionId,
            });
          }
        }
      }

      // Add errors
      if (response.Errors) {
        for (const error of response.Errors) {
          if (error.Key) {
            errors.push({
              key: error.Key,
              code: error.Code,
              message: error.Message,
            });
          }
        }
      }
    } catch (error) {
      // If batch fails entirely, mark all as errors
      if (!continueOnError) {
        throw error;
      }

      for (const key of batch) {
        errors.push({
          key,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  return {
    deleted,
    errors,
    total: keys.length,
    successCount: deleted.length,
    errorCount: errors.length,
  };
}

/**
 * Delete files by prefix (folder)
 */
export async function deleteByPrefix(prefix: string): Promise<BatchDeleteResult> {
  // Import list operation
  const { listFiles } = await import('./list');

  // List all files with the prefix
  const listResult = await listFiles({ prefix });

  if (listResult.objects.length === 0) {
    return {
      deleted: [],
      errors: [],
      total: 0,
      successCount: 0,
      errorCount: 0,
    };
  }

  // Delete all listed files
  const keys = listResult.objects.map((obj) => obj.key);
  return deleteFiles({ keys });
}

/**
 * Check if an object exists before deleting
 */
export async function safeDelete(key: string): Promise<DeleteResult> {
  // Import list operation
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');

  const config = getS3ConfigFromEnv();
  const client = getS3Client();

  try {
    // Check if object exists
    const headCommand = new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key,
    });

    await client.send(headCommand);

    // Object exists, proceed with deletion
    return deleteFile({ key });
  } catch (error: any) {
    // Object doesn't exist
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return {
        key,
        success: true, // Consider non-existent as successfully deleted
      };
    }

    // Other error
    return {
      key,
      success: false,
    };
  }
}
