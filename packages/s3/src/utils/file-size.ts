/**
 * File size utilities for formatting and validation.
 */

/**
 * File size units
 */
export const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * File size limits
 */
export const FILE_SIZE_LIMITS = {
  /** 100 MB - threshold for multipart upload */
  MULTIPART_THRESHOLD: 100 * 1024 * 1024,
  /** 5 MB - minimum part size for multipart upload */
  MULTIPART_MIN_PART_SIZE: 5 * 1024 * 1024,
  /** 5 GB - maximum single file size */
  MAX_FILE_SIZE: 5 * 1024 * 1024 * 1024,
  /** 10 KB - minimum file size */
  MIN_FILE_SIZE: 10 * 1024,
} as const;

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return 'Invalid size';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  if (i >= FILE_SIZE_UNITS.length) {
    return 'Too large';
  }

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${FILE_SIZE_UNITS[i]}`;
}

/**
 * Parse file size from human-readable format to bytes
 */
export function parseFileSize(size: string): number {
  const match = size.match(/^(\d+(?:\.\d+)?)\s*([KMGT]?B)$/i);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid file size format: ${size}`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const unitIndex = FILE_SIZE_UNITS.indexOf(unit as any);
  if (unitIndex === -1) {
    throw new Error(`Invalid file size unit: ${unit}`);
  }

  return value * Math.pow(1024, unitIndex);
}

/**
 * Check if file size is valid
 */
export function isValidFileSize(bytes: number, maxSize?: number): boolean {
  const max = maxSize || FILE_SIZE_LIMITS.MAX_FILE_SIZE;
  return bytes >= FILE_SIZE_LIMITS.MIN_FILE_SIZE && bytes <= max;
}

/**
 * Check if file requires multipart upload
 */
export function requiresMultipartUpload(bytes: number): boolean {
  return bytes > FILE_SIZE_LIMITS.MULTIPART_THRESHOLD;
}

/**
 * Calculate number of parts for multipart upload
 */
export function calculatePartCount(
  fileSize: number,
  partSize: number = FILE_SIZE_LIMITS.MULTIPART_MIN_PART_SIZE
): number {
  return Math.ceil(fileSize / partSize);
}

/**
 * Calculate optimal part size for multipart upload
 */
export function calculateOptimalPartSize(fileSize: number): number {
  const maxParts = 10000; // AWS S3 limit
  const minPartSize = FILE_SIZE_LIMITS.MULTIPART_MIN_PART_SIZE;

  // Calculate part size that keeps parts under max limit
  let partSize = Math.ceil(fileSize / maxParts);

  // Ensure part size is at least minimum
  if (partSize < minPartSize) {
    partSize = minPartSize;
  }

  // Round up to nearest MB for cleaner numbers
  const mb = 1024 * 1024;
  partSize = Math.ceil(partSize / mb) * mb;

  return partSize;
}

/**
 * Validate file size and throw error if invalid
 */
export function validateFileSize(bytes: number, maxSize?: number): void {
  if (!isValidFileSize(bytes, maxSize)) {
    const max = maxSize || FILE_SIZE_LIMITS.MAX_FILE_SIZE;
    throw new Error(
      `Invalid file size: ${formatFileSize(bytes)}. Must be between ${formatFileSize(
        FILE_SIZE_LIMITS.MIN_FILE_SIZE
      )} and ${formatFileSize(max)}`
    );
  }
}

/**
 * Get upload progress percentage
 */
export function getUploadProgress(loaded: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(Math.round((loaded / total) * 100), 100);
}
