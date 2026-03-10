/**
 * React hook for generating presigned URLs.
 *
 * Provides presigned URL generation for secure downloads and uploads.
 */

import { useState, useCallback, useEffect } from 'react';
import type {
  PresignedUrlOptions,
  PresignedUrlResult,
  PresignedUploadUrlOptions,
} from '../operations/download';
import {
  getPresignedDownloadUrl,
  getPresignedUploadUrl,
  isPresignedUrlExpired,
} from '../operations/download';

/**
 * Presigned URL state
 */
export type PresignedUrlState = 'idle' | 'loading' | 'success' | 'error';

/**
 * Presigned URL hook options
 */
export interface UsePresignedUrlOptions {
  /** Auto-generate URL on mount */
  autoGenerate?: boolean;
  /** Auto-refresh URL before expiration */
  autoRefresh?: boolean;
  /** Refresh buffer time in seconds (default: 300 = 5 minutes) */
  refreshBuffer?: number;
  /** Success callback */
  onSuccess?: (result: PresignedUrlResult) => void;
  /** Error callback */
  onError?: (error: Error) => void;
}

/**
 * Presigned URL hook result
 */
export interface UsePresignedUrlResult {
  /** Current state */
  state: PresignedUrlState;
  /** Presigned URL */
  url: string | null;
  /** Expiration date */
  expiresAt: Date | null;
  /** Expiration time in seconds */
  expiresIn: number | null;
  /** Whether URL is expired */
  isExpired: boolean;
  /** Error if generation failed */
  error: Error | null;
  /** Whether URL is being generated */
  isLoading: boolean;
  /** Whether URL was generated successfully */
  isSuccess: boolean;
  /** Whether generation failed */
  isError: boolean;
  /** Generate presigned download URL */
  generateDownloadUrl: (options: PresignedUrlOptions) => Promise<void>;
  /** Generate presigned upload URL */
  generateUploadUrl: (options: PresignedUploadUrlOptions) => Promise<void>;
  /** Refresh current URL */
  refresh: () => Promise<void>;
  /** Reset state */
  reset: () => void;
}

/**
 * Hook for generating presigned URLs
 */
export function usePresignedUrl(
  options: UsePresignedUrlOptions = {}
): UsePresignedUrlResult {
  const {
    autoRefresh = false,
    refreshBuffer = 300,
    onSuccess,
    onError,
  } = options;

  const [state, setState] = useState<PresignedUrlState>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [lastOptions, setLastOptions] = useState<
    PresignedUrlOptions | PresignedUploadUrlOptions | null
  >(null);
  const [urlType, setUrlType] = useState<'download' | 'upload' | null>(null);

  /**
   * Check if URL is expired
   */
  const isExpired = expiresAt ? isPresignedUrlExpired(expiresAt) : false;

  /**
   * Generate presigned download URL
   */
  const generateDownloadUrl = useCallback(
    async (urlOptions: PresignedUrlOptions) => {
      try {
        setState('loading');
        setError(null);

        const result = await getPresignedDownloadUrl(urlOptions);

        setState('success');
        setUrl(result.url);
        setExpiresAt(result.expiresAt);
        setExpiresIn(result.expiresIn);
        setLastOptions(urlOptions);
        setUrlType('download');

        if (onSuccess) {
          onSuccess(result);
        }
      } catch (err) {
        const urlError = err instanceof Error ? err : new Error('Failed to generate URL');

        setState('error');
        setError(urlError);

        if (onError) {
          onError(urlError);
        }
      }
    },
    [onSuccess, onError]
  );

  /**
   * Generate presigned upload URL
   */
  const generateUploadUrl = useCallback(
    async (urlOptions: PresignedUploadUrlOptions) => {
      try {
        setState('loading');
        setError(null);

        const result = await getPresignedUploadUrl(urlOptions);

        setState('success');
        setUrl(result.url);
        setExpiresAt(result.expiresAt);
        setExpiresIn(result.expiresIn);
        setLastOptions(urlOptions);
        setUrlType('upload');

        if (onSuccess) {
          onSuccess(result);
        }
      } catch (err) {
        const urlError = err instanceof Error ? err : new Error('Failed to generate URL');

        setState('error');
        setError(urlError);

        if (onError) {
          onError(urlError);
        }
      }
    },
    [onSuccess, onError]
  );

  /**
   * Refresh current URL
   */
  const refresh = useCallback(async () => {
    if (!lastOptions || !urlType) {
      throw new Error('No URL to refresh');
    }

    if (urlType === 'download') {
      await generateDownloadUrl(lastOptions as PresignedUrlOptions);
    } else {
      await generateUploadUrl(lastOptions as PresignedUploadUrlOptions);
    }
  }, [lastOptions, urlType, generateDownloadUrl, generateUploadUrl]);

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setState('idle');
    setUrl(null);
    setExpiresAt(null);
    setExpiresIn(null);
    setError(null);
    setLastOptions(null);
    setUrlType(null);
  }, []);

  /**
   * Auto-refresh URL before expiration
   */
  useEffect(() => {
    if (!autoRefresh || !expiresAt || !url) {
      return;
    }

    const now = Date.now();
    const expirationTime = expiresAt.getTime();
    const refreshTime = expirationTime - refreshBuffer * 1000;

    if (now >= refreshTime) {
      // URL is about to expire or already expired
      void refresh();
      return;
    }

    // Schedule refresh
    const timeUntilRefresh = refreshTime - now;
    const timeout = setTimeout(() => {
      void refresh();
    }, timeUntilRefresh);

    return () => clearTimeout(timeout);
  }, [autoRefresh, expiresAt, url, refreshBuffer, refresh]);

  return {
    state,
    url,
    expiresAt,
    expiresIn,
    isExpired,
    error,
    isLoading: state === 'loading',
    isSuccess: state === 'success',
    isError: state === 'error',
    generateDownloadUrl,
    generateUploadUrl,
    refresh,
    reset,
  };
}

/**
 * Hook for generating a download URL
 */
export function useDownloadUrl(
  key?: string,
  options: UsePresignedUrlOptions & Omit<PresignedUrlOptions, 'key'> = {}
): UsePresignedUrlResult {
  const { autoGenerate = true, ...hookOptions } = options;
  const hook = usePresignedUrl(hookOptions);

  useEffect(() => {
    if (autoGenerate && key) {
      void hook.generateDownloadUrl({ key, ...options });
    }
  }, [key, autoGenerate]);

  return hook;
}

/**
 * Hook for generating an upload URL
 */
export function useUploadUrl(
  key?: string,
  options: UsePresignedUrlOptions & Omit<PresignedUploadUrlOptions, 'key'> = {}
): UsePresignedUrlResult {
  const { autoGenerate = false, ...hookOptions } = options;
  const hook = usePresignedUrl(hookOptions);

  useEffect(() => {
    if (autoGenerate && key) {
      void hook.generateUploadUrl({ key, ...options });
    }
  }, [key, autoGenerate]);

  return hook;
}
