/**
 * Utility Functions and Helpers
 * Common utilities for working with the API services
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiException } from './types';
import { API_CONFIG } from './config';

// ============================================================================
// Error Handling Utilities
// ============================================================================

/**
 * Extract user-friendly error message from any error type
 */
export function getErrorMessage(error: any): string {
  if (error instanceof ApiException) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

/**
 * Get validation errors from API exception
 */
export function getValidationErrors(error: any): Record<string, string[]> | null {
  if (error instanceof ApiException && error.errors) {
    return error.errors;
  }
  return null;
}

/**
 * Get first validation error for a field
 */
export function getFirstFieldError(
  errors: Record<string, string[]> | null,
  field: string
): string | null {
  if (!errors || !errors[field] || errors[field].length === 0) {
    return null;
  }
  return errors[field][0];
}

/**
 * Check if error is a specific HTTP status
 */
export function isErrorStatus(error: any, status: number): boolean {
  return error instanceof ApiException && error.status === status;
}

/**
 * Check if error is unauthorized (401)
 */
export function isUnauthorizedError(error: any): boolean {
  return isErrorStatus(error, 401);
}

/**
 * Check if error is forbidden (403)
 */
export function isForbiddenError(error: any): boolean {
  return isErrorStatus(error, 403);
}

/**
 * Check if error is not found (404)
 */
export function isNotFoundError(error: any): boolean {
  return isErrorStatus(error, 404);
}

/**
 * Check if error is validation error (422)
 */
export function isValidationError(error: any): boolean {
  return isErrorStatus(error, 422);
}

/**
 * Check if error is network error
 */
export function isNetworkError(error: any): boolean {
  return (
    error instanceof ApiException &&
    (error.status === 0 || error.code === 'NETWORK_ERROR')
  );
}

// ============================================================================
// File Validation Utilities
// ============================================================================

/**
 * Validate file before upload
 */
export function validateFile(file: any): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No file selected' };
  }

  // Check file size
  const fileSize = file.size || file.fileSize || 0;
  if (fileSize > API_CONFIG.upload.maxFileSize) {
    return {
      valid: false,
      error: `File is too large. Maximum size is ${formatBytes(API_CONFIG.upload.maxFileSize)}`,
    };
  }

  // Check file type
  const mimeType = file.type || file.mimeType || '';
  if (!API_CONFIG.upload.allowedMimeTypes.includes(mimeType)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: ${API_CONFIG.upload.allowedMimeTypes.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2);
}

/**
 * Get filename without extension
 */
export function getFileNameWithoutExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '');
}

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format date to locale string
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString();
}

/**
 * Format date with time
 */
export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;

  return formatDate(d);
}

/**
 * Format percentage
 */
export function formatPercentage(value: number, decimals = 0): string {
  return `${value.toFixed(decimals)}%`;
}

// ============================================================================
// Custom Hooks
// ============================================================================

/**
 * Hook for upload progress tracking
 */
export function useUploadProgress() {
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const startUpload = useCallback(() => {
    setProgress(0);
    setIsUploading(true);
  }, []);

  const updateProgress = useCallback((value: number) => {
    setProgress(value);
  }, []);

  const finishUpload = useCallback(() => {
    setProgress(100);
    setIsUploading(false);
  }, []);

  const resetUpload = useCallback(() => {
    setProgress(0);
    setIsUploading(false);
  }, []);

  return {
    progress,
    isUploading,
    startUpload,
    updateProgress,
    finishUpload,
    resetUpload,
  };
}

/**
 * Hook for download progress tracking
 */
export function useDownloadProgress() {
  const [progress, setProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);

  const startDownload = useCallback(() => {
    setProgress(0);
    setIsDownloading(true);
  }, []);

  const updateProgress = useCallback((value: number) => {
    setProgress(value);
  }, []);

  const finishDownload = useCallback(() => {
    setProgress(100);
    setIsDownloading(false);
  }, []);

  const resetDownload = useCallback(() => {
    setProgress(0);
    setIsDownloading(false);
  }, []);

  return {
    progress,
    isDownloading,
    startDownload,
    updateProgress,
    finishDownload,
    resetDownload,
  };
}

/**
 * Hook for debounced value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook for throttled callback
 */
export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const lastRun = useRef(Date.now());

  return useCallback(
    ((...args) => {
      const now = Date.now();

      if (now - lastRun.current >= delay) {
        callback(...args);
        lastRun.current = now;
      }
    }) as T,
    [callback, delay]
  );
}

/**
 * Hook for retry logic
 */
export function useRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
) {
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  const retry = useCallback(async () => {
    setIsRetrying(true);

    for (let i = 0; i < maxRetries; i++) {
      try {
        const result = await fn();
        setRetryCount(0);
        setIsRetrying(false);
        return result;
      } catch (error) {
        setRetryCount(i + 1);

        if (i === maxRetries - 1) {
          setIsRetrying(false);
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }, [fn, maxRetries, delay]);

  return { retry, retryCount, isRetrying };
}

// ============================================================================
// Data Transformation Utilities
// ============================================================================

/**
 * Convert query params to URL search params
 */
export function toSearchParams(params: Record<string, any>): URLSearchParams {
  const searchParams = new URLSearchParams();

  Object.keys(params).forEach((key) => {
    const value = params[key];

    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        value.forEach((item) => searchParams.append(key, String(item)));
      } else {
        searchParams.append(key, String(value));
      }
    }
  });

  return searchParams;
}

/**
 * Deep clone object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Remove undefined/null values from object
 */
export function cleanObject<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.keys(obj).reduce((acc, key) => {
    if (obj[key] !== undefined && obj[key] !== null) {
      acc[key as keyof T] = obj[key];
    }
    return acc;
  }, {} as Partial<T>);
}

/**
 * Merge objects deeply
 */
export function deepMerge<T extends Record<string, any>>(
  target: T,
  ...sources: Partial<T>[]
): T {
  if (!sources.length) return target;

  const source = sources.shift();

  if (source) {
    Object.keys(source).forEach((key) => {
      const targetValue = target[key as keyof T];
      const sourceValue = source[key as keyof T];

      if (
        typeof targetValue === 'object' &&
        targetValue !== null &&
        typeof sourceValue === 'object' &&
        sourceValue !== null
      ) {
        target[key as keyof T] = deepMerge(
          { ...targetValue },
          sourceValue as any
        ) as T[keyof T];
      } else if (sourceValue !== undefined) {
        target[key as keyof T] = sourceValue as T[keyof T];
      }
    });
  }

  return deepMerge(target, ...sources);
}

// ============================================================================
// Pagination Utilities
// ============================================================================

/**
 * Calculate total pages
 */
export function getTotalPages(total: number, perPage: number): number {
  return Math.ceil(total / perPage);
}

/**
 * Check if has next page
 */
export function hasNextPage(currentPage: number, totalPages: number): boolean {
  return currentPage < totalPages;
}

/**
 * Check if has previous page
 */
export function hasPreviousPage(currentPage: number): boolean {
  return currentPage > 1;
}

/**
 * Get page range for pagination
 */
export function getPageRange(
  currentPage: number,
  totalPages: number,
  maxVisible = 5
): number[] {
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(1, currentPage - half);
  let end = Math.min(totalPages, start + maxVisible - 1);

  if (end - start + 1 < maxVisible) {
    start = Math.max(1, end - maxVisible + 1);
  }

  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

// ============================================================================
// Color Utilities
// ============================================================================

/**
 * Convert hex to RGBA
 */
export function hexToRgba(hex: string, alpha = 1): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Get contrast color (black or white) for background
 */
export function getContrastColor(hexColor: string): string {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  return brightness > 128 ? '#000000' : '#FFFFFF';
}

// ============================================================================
// Storage Utilities
// ============================================================================

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/**
 * Safe JSON stringify
 */
export function safeJsonStringify(value: any, fallback = '{}'): string {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

// ============================================================================
// Export all utilities
// ============================================================================

export default {
  // Error handling
  getErrorMessage,
  getValidationErrors,
  getFirstFieldError,
  isErrorStatus,
  isUnauthorizedError,
  isForbiddenError,
  isNotFoundError,
  isValidationError,
  isNetworkError,

  // File validation
  validateFile,
  getFileExtension,
  getFileNameWithoutExtension,

  // Formatting
  formatBytes,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatPercentage,

  // Hooks
  useUploadProgress,
  useDownloadProgress,
  useDebounce,
  useThrottle,
  useRetry,

  // Data transformation
  toSearchParams,
  deepClone,
  cleanObject,
  deepMerge,

  // Pagination
  getTotalPages,
  hasNextPage,
  hasPreviousPage,
  getPageRange,

  // Colors
  hexToRgba,
  getContrastColor,

  // Storage
  safeJsonParse,
  safeJsonStringify,
};
