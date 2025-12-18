/**
 * @giga-pdf/s3
 *
 * S3-compatible storage operations for Scaleway Object Storage.
 *
 * This package provides comprehensive S3 operations including:
 * - File upload (single and multipart)
 * - File download
 * - Presigned URL generation
 * - File deletion (single and batch)
 * - File listing and search
 * - React hooks with progress tracking
 *
 * @example
 * ```typescript
 * import { upload, useUpload } from '@giga-pdf/s3';
 *
 * // Upload a file
 * const result = await upload({
 *   file: myFile,
 *   key: 'documents/myfile.pdf',
 *   contentType: 'application/pdf',
 * });
 *
 * // Use upload hook
 * const { uploadFile, progress, isUploading } = useUpload({
 *   onSuccess: (result) => console.log('Uploaded:', result),
 * });
 * ```
 */

// Client configuration
export * from './client';

// Operations
export * from './operations';

// Hooks
export * from './hooks';

// Utils
export * from './utils';
