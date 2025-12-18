/**
 * React hook for S3 file uploads with progress tracking.
 *
 * Provides upload functionality with progress tracking via XHR and multipart support.
 */

import { useState, useCallback, useRef } from 'react';
import type { UploadOptions, UploadResult, MultipartUploadProgress } from '../operations/upload';
import { upload, uploadFileMultipart } from '../operations/upload';
import { getPresignedUploadUrl } from '../operations/download';
import { requiresMultipartUpload, getUploadProgress } from '../utils';

/**
 * Upload state
 */
export type UploadState = 'idle' | 'uploading' | 'success' | 'error';

/**
 * Upload hook options
 */
export interface UseUploadOptions extends Omit<UploadOptions, 'file' | 'key' | 'onProgress'> {
  /** Auto-start upload on file selection */
  autoUpload?: boolean;
  /** Use presigned URL for upload (client-side upload) */
  usePresignedUrl?: boolean;
  /** Generate key from file (default: use filename) */
  generateKey?: (file: File) => string;
  /** Success callback */
  onSuccess?: (result: UploadResult) => void;
  /** Error callback */
  onError?: (error: Error) => void;
  /** Complete callback (success or error) */
  onComplete?: () => void;
}

/**
 * Upload hook result
 */
export interface UseUploadResult {
  /** Current upload state */
  state: UploadState;
  /** Upload progress (0-100) */
  progress: number;
  /** Uploaded bytes */
  uploadedBytes: number;
  /** Total bytes */
  totalBytes: number;
  /** Current file being uploaded */
  file: File | null;
  /** Upload result */
  result: UploadResult | null;
  /** Error if upload failed */
  error: Error | null;
  /** Whether upload is in progress */
  isUploading: boolean;
  /** Whether upload was successful */
  isSuccess: boolean;
  /** Whether upload failed */
  isError: boolean;
  /** Upload a file */
  uploadFile: (file: File, key?: string) => Promise<void>;
  /** Cancel current upload */
  cancel: () => void;
  /** Reset upload state */
  reset: () => void;
}

/**
 * Hook for uploading files to S3 with progress tracking
 */
export function useUpload(options: UseUploadOptions = {}): UseUploadResult {
  const {
    autoUpload = false,
    usePresignedUrl = false,
    generateKey,
    onSuccess,
    onError,
    onComplete,
    ...uploadOptions
  } = options;

  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Upload using presigned URL via XHR (for progress tracking)
   */
  const uploadViaPresignedUrl = useCallback(
    async (file: File, key: string): Promise<UploadResult> => {
      // Get presigned URL
      const presignedResult = await getPresignedUploadUrl({
        key,
        contentType: file.type,
        contentLength: file.size,
        expiresIn: 3600,
      });

      // Upload via XHR
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            setUploadedBytes(event.loaded);
            setTotalBytes(event.total);
            setProgress(getUploadProgress(event.loaded, event.total));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const uploadResult: UploadResult = {
              key,
              url: presignedResult.url.split('?')[0] || presignedResult.url, // Remove query params
              size: file.size,
              contentType: file.type,
            };
            resolve(uploadResult);
          } else {
            reject(new Error(`Upload failed with status: ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Upload failed'));
        });

        xhr.addEventListener('abort', () => {
          reject(new Error('Upload cancelled'));
        });

        xhr.open('PUT', presignedResult.url);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });
    },
    []
  );

  /**
   * Upload using SDK (server-side)
   */
  const uploadViaSdk = useCallback(
    async (file: File, key: string): Promise<UploadResult> => {
      const fileSize = file.size;

      // Handle progress callback
      const handleProgress = (loaded: number, total: number) => {
        setUploadedBytes(loaded);
        setTotalBytes(total);
        setProgress(getUploadProgress(loaded, total));
      };

      if (requiresMultipartUpload(fileSize)) {
        // Multipart upload
        return uploadFileMultipart({
          file,
          key,
          ...uploadOptions,
          onProgress: (multipartProgress: MultipartUploadProgress) => {
            handleProgress(multipartProgress.loaded, multipartProgress.total);
          },
        });
      } else {
        // Single upload
        return upload({
          file,
          key,
          ...uploadOptions,
          onProgress: (uploadProgress) => {
            handleProgress(uploadProgress.loaded, uploadProgress.total);
          },
        });
      }
    },
    [uploadOptions]
  );

  /**
   * Upload a file
   */
  const uploadFile = useCallback(
    async (file: File, key?: string) => {
      try {
        // Reset state
        setState('uploading');
        setProgress(0);
        setUploadedBytes(0);
        setTotalBytes(file.size);
        setFile(file);
        setResult(null);
        setError(null);

        // Generate key
        const finalKey = key || (generateKey ? generateKey(file) : file.name);

        // Create abort controller for SDK uploads
        if (!usePresignedUrl) {
          abortControllerRef.current = new AbortController();
        }

        // Upload
        const uploadResult = usePresignedUrl
          ? await uploadViaPresignedUrl(file, finalKey)
          : await uploadViaSdk(file, finalKey);

        // Success
        setState('success');
        setResult(uploadResult);
        setProgress(100);

        if (onSuccess) {
          onSuccess(uploadResult);
        }
      } catch (err) {
        const uploadError = err instanceof Error ? err : new Error('Upload failed');

        setState('error');
        setError(uploadError);

        if (onError) {
          onError(uploadError);
        }
      } finally {
        xhrRef.current = null;
        abortControllerRef.current = null;

        if (onComplete) {
          onComplete();
        }
      }
    },
    [generateKey, usePresignedUrl, uploadViaPresignedUrl, uploadViaSdk, onSuccess, onError, onComplete]
  );

  /**
   * Cancel current upload
   */
  const cancel = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setState('idle');
    setProgress(0);
    setUploadedBytes(0);
    setFile(null);
    setError(new Error('Upload cancelled'));
  }, []);

  /**
   * Reset upload state
   */
  const reset = useCallback(() => {
    setState('idle');
    setProgress(0);
    setUploadedBytes(0);
    setTotalBytes(0);
    setFile(null);
    setResult(null);
    setError(null);
    xhrRef.current = null;
    abortControllerRef.current = null;
  }, []);

  return {
    state,
    progress,
    uploadedBytes,
    totalBytes,
    file,
    result,
    error,
    isUploading: state === 'uploading',
    isSuccess: state === 'success',
    isError: state === 'error',
    uploadFile,
    cancel,
    reset,
  };
}
