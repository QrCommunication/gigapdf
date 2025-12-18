/**
 * S3 download operations.
 *
 * Handles file downloads and presigned URL generation for secure access.
 */

import { GetObjectCommand, GetObjectCommandInput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3Client, getS3ConfigFromEnv } from '../client';

/**
 * Download options
 */
export interface DownloadOptions {
  /** S3 object key (path in bucket) */
  key: string;
  /** Response content type override */
  responseContentType?: string;
  /** Response content disposition override */
  responseContentDisposition?: string;
  /** Version ID for versioned objects */
  versionId?: string;
}

/**
 * Download result
 */
export interface DownloadResult {
  /** File content as Buffer */
  body: Buffer;
  /** Content type */
  contentType?: string;
  /** Content length in bytes */
  contentLength?: number;
  /** ETag */
  etag?: string;
  /** Last modified date */
  lastModified?: Date;
  /** Metadata */
  metadata?: Record<string, string>;
}

/**
 * Presigned URL options
 */
export interface PresignedUrlOptions {
  /** S3 object key (path in bucket) */
  key: string;
  /** URL expiration time in seconds (default: 3600 = 1 hour) */
  expiresIn?: number;
  /** Response content type override */
  responseContentType?: string;
  /** Response content disposition override */
  responseContentDisposition?: string;
  /** Version ID for versioned objects */
  versionId?: string;
}

/**
 * Presigned URL result
 */
export interface PresignedUrlResult {
  /** Presigned URL */
  url: string;
  /** Expiration time in seconds */
  expiresIn: number;
  /** Expiration date */
  expiresAt: Date;
}

/**
 * Presigned upload URL options
 */
export interface PresignedUploadUrlOptions {
  /** S3 object key (path in bucket) */
  key: string;
  /** URL expiration time in seconds (default: 3600 = 1 hour) */
  expiresIn?: number;
  /** Content type */
  contentType?: string;
  /** Content length in bytes */
  contentLength?: number;
  /** File metadata */
  metadata?: Record<string, string>;
  /** Cache control header */
  cacheControl?: string;
}

/**
 * Download a file from S3
 */
export async function downloadFile(options: DownloadOptions): Promise<DownloadResult> {
  const { key, responseContentType, responseContentDisposition, versionId } = options;

  const config = getS3ConfigFromEnv();
  const client = getS3Client();

  const input: GetObjectCommandInput = {
    Bucket: config.bucket,
    Key: key,
    ResponseContentType: responseContentType,
    ResponseContentDisposition: responseContentDisposition,
    VersionId: versionId,
  };

  const command = new GetObjectCommand(input);
  const response = await client.send(command);

  if (!response.Body) {
    throw new Error('No response body received from S3');
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  return {
    body,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
    etag: response.ETag,
    lastModified: response.LastModified,
    metadata: response.Metadata,
  };
}

/**
 * Generate a presigned URL for downloading a file
 */
export async function getPresignedDownloadUrl(
  options: PresignedUrlOptions
): Promise<PresignedUrlResult> {
  const {
    key,
    expiresIn = 3600,
    responseContentType,
    responseContentDisposition,
    versionId,
  } = options;

  const config = getS3ConfigFromEnv();
  const client = getS3Client();

  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ResponseContentType: responseContentType,
    ResponseContentDisposition: responseContentDisposition,
    VersionId: versionId,
  });

  const url = await getSignedUrl(client, command, { expiresIn });

  return {
    url,
    expiresIn,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

/**
 * Generate a presigned URL for uploading a file
 */
export async function getPresignedUploadUrl(
  options: PresignedUploadUrlOptions
): Promise<PresignedUrlResult> {
  const { key, expiresIn = 3600, contentType, contentLength, metadata, cacheControl } = options;

  const config = getS3ConfigFromEnv();
  const client = getS3Client();

  // For upload, we need to use PutObjectCommand
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const putCommand = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
    Metadata: metadata,
    CacheControl: cacheControl,
  });

  const url = await getSignedUrl(client, putCommand, { expiresIn });

  return {
    url,
    expiresIn,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

/**
 * Get direct S3 URL (without presigning)
 */
export function getObjectUrl(key: string): string {
  const config = getS3ConfigFromEnv();
  return `${config.endpoint}/${config.bucket}/${key}`;
}

/**
 * Check if a presigned URL has expired
 */
export function isPresignedUrlExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}
