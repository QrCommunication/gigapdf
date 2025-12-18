/**
 * S3 upload operations.
 *
 * Handles single and multipart file uploads to S3-compatible storage.
 */

import {
  PutObjectCommand,
  PutObjectCommandInput,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getS3Client, getS3ConfigFromEnv } from '../client';
import {
  getMimeTypeFromExtension,
  validateFileType,
  validateFileSize,
  requiresMultipartUpload,
  calculateOptimalPartSize,
  calculatePartCount,
} from '../utils';

/**
 * Upload options
 */
export interface UploadOptions {
  /** File to upload */
  file: File | Buffer;
  /** S3 object key (path in bucket) */
  key: string;
  /** Content type override */
  contentType?: string;
  /** Allowed file types (MIME types) */
  allowedTypes?: string[];
  /** Maximum file size in bytes */
  maxSize?: number;
  /** File metadata */
  metadata?: Record<string, string>;
  /** Progress callback for single upload */
  onProgress?: (progress: UploadProgress) => void;
  /** Cache control header */
  cacheControl?: string;
  /** Content disposition header */
  contentDisposition?: string;
}

/**
 * Upload progress
 */
export interface UploadProgress {
  /** Bytes uploaded */
  loaded: number;
  /** Total bytes */
  total: number;
  /** Progress percentage (0-100) */
  percentage: number;
}

/**
 * Upload result
 */
export interface UploadResult {
  /** S3 object key */
  key: string;
  /** Object URL */
  url: string;
  /** ETag */
  etag?: string;
  /** File size in bytes */
  size: number;
  /** Content type */
  contentType: string;
}

/**
 * Multipart upload options
 */
export interface MultipartUploadOptions extends Omit<UploadOptions, 'onProgress'> {
  /** Part size in bytes (defaults to optimal size) */
  partSize?: number;
  /** Progress callback for multipart upload */
  onProgress?: (progress: MultipartUploadProgress) => void;
}

/**
 * Multipart upload progress
 */
export interface MultipartUploadProgress {
  /** Current part number */
  currentPart: number;
  /** Total parts */
  totalParts: number;
  /** Bytes uploaded */
  loaded: number;
  /** Total bytes */
  total: number;
  /** Progress percentage (0-100) */
  percentage: number;
}

/**
 * Get file buffer from File or Buffer
 */
async function getFileBuffer(file: File | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(file)) {
    return file;
  }
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Get file size from File or Buffer
 */
function getFileSize(file: File | Buffer): number {
  if (Buffer.isBuffer(file)) {
    return file.length;
  }
  return file.size;
}

/**
 * Upload a file to S3 (single upload)
 */
export async function uploadFile(options: UploadOptions): Promise<UploadResult> {
  const { file, key, contentType, allowedTypes, maxSize, metadata, cacheControl, contentDisposition } = options;

  // Validate file type
  const filename = Buffer.isBuffer(file) ? key : file.name;
  if (allowedTypes) {
    validateFileType(filename, allowedTypes);
  }

  // Validate file size
  const fileSize = getFileSize(file);
  validateFileSize(fileSize, maxSize);

  // Get content type
  const finalContentType = contentType || getMimeTypeFromExtension(filename);

  // Get file buffer
  const buffer = await getFileBuffer(file);

  // Prepare upload command
  const config = getS3ConfigFromEnv();
  const client = getS3Client();

  const input: PutObjectCommandInput = {
    Bucket: config.bucket,
    Key: key,
    Body: buffer,
    ContentType: finalContentType,
    Metadata: metadata,
    CacheControl: cacheControl,
    ContentDisposition: contentDisposition,
  };

  // Upload to S3
  const command = new PutObjectCommand(input);
  const response = await client.send(command);

  // Build result
  const url = `${config.endpoint}/${config.bucket}/${key}`;

  return {
    key,
    url,
    etag: response.ETag,
    size: fileSize,
    contentType: finalContentType,
  };
}

/**
 * Upload a large file using multipart upload
 */
export async function uploadFileMultipart(
  options: MultipartUploadOptions
): Promise<UploadResult> {
  const {
    file,
    key,
    contentType,
    allowedTypes,
    maxSize,
    metadata,
    partSize: customPartSize,
    onProgress,
    cacheControl,
    contentDisposition,
  } = options;

  // Validate file type
  const filename = Buffer.isBuffer(file) ? key : file.name;
  if (allowedTypes) {
    validateFileType(filename, allowedTypes);
  }

  // Validate file size
  const fileSize = getFileSize(file);
  validateFileSize(fileSize, maxSize);

  // Get content type
  const finalContentType = contentType || getMimeTypeFromExtension(filename);

  // Get file buffer
  const buffer = await getFileBuffer(file);

  // Calculate part size
  const partSize = customPartSize || calculateOptimalPartSize(fileSize);
  const totalParts = calculatePartCount(fileSize, partSize);

  // Get S3 client and config
  const config = getS3ConfigFromEnv();
  const client = getS3Client();

  let uploadId: string | undefined;

  try {
    // Initialize multipart upload
    const createCommand = new CreateMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: finalContentType,
      Metadata: metadata,
      CacheControl: cacheControl,
      ContentDisposition: contentDisposition,
    });

    const createResponse = await client.send(createCommand);
    uploadId = createResponse.UploadId;

    if (!uploadId) {
      throw new Error('Failed to initialize multipart upload');
    }

    // Upload parts
    const uploadedParts: CompletedPart[] = [];
    let uploadedBytes = 0;

    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const start = (partNumber - 1) * partSize;
      const end = Math.min(start + partSize, fileSize);
      const partBuffer = buffer.slice(start, end);

      const uploadPartCommand = new UploadPartCommand({
        Bucket: config.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: partBuffer,
      });

      const partResponse = await client.send(uploadPartCommand);

      uploadedParts.push({
        PartNumber: partNumber,
        ETag: partResponse.ETag,
      });

      uploadedBytes += partBuffer.length;

      // Report progress
      if (onProgress) {
        onProgress({
          currentPart: partNumber,
          totalParts,
          loaded: uploadedBytes,
          total: fileSize,
          percentage: Math.round((uploadedBytes / fileSize) * 100),
        });
      }
    }

    // Complete multipart upload
    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: uploadedParts,
      },
    });

    const completeResponse = await client.send(completeCommand);

    // Build result
    const url = `${config.endpoint}/${config.bucket}/${key}`;

    return {
      key,
      url,
      etag: completeResponse.ETag,
      size: fileSize,
      contentType: finalContentType,
    };
  } catch (error) {
    // Abort multipart upload on error
    if (uploadId) {
      try {
        const abortCommand = new AbortMultipartUploadCommand({
          Bucket: config.bucket,
          Key: key,
          UploadId: uploadId,
        });
        await client.send(abortCommand);
      } catch (abortError) {
        console.error('Failed to abort multipart upload:', abortError);
      }
    }
    throw error;
  }
}

/**
 * Upload a file (automatically chooses single or multipart)
 */
export async function upload(options: UploadOptions): Promise<UploadResult> {
  const fileSize = getFileSize(options.file);

  if (requiresMultipartUpload(fileSize)) {
    // Convert single progress to multipart progress
    const multipartOptions: MultipartUploadOptions = {
      ...options,
      onProgress: options.onProgress
        ? (progress) => {
            if (options.onProgress) {
              options.onProgress({
                loaded: progress.loaded,
                total: progress.total,
                percentage: progress.percentage,
              });
            }
          }
        : undefined,
    };
    return uploadFileMultipart(multipartOptions);
  }

  return uploadFile(options);
}
