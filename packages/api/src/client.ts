import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { getApiConfig } from './config';

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Token storage interface
 */
export interface TokenStorage {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  setTokens: (accessToken: string, refreshToken: string) => void;
  clearTokens: () => void;
}

/**
 * Default token storage using localStorage
 */
export const defaultTokenStorage: TokenStorage = {
  getAccessToken: () => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('access_token');
  },
  getRefreshToken: () => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('refresh_token');
  },
  setTokens: (accessToken: string, refreshToken: string) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('access_token', accessToken);
    localStorage.setItem('refresh_token', refreshToken);
  },
  clearTokens: () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  },
};

let tokenStorage: TokenStorage = defaultTokenStorage;
let onUnauthorized: (() => void) | null = null;
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

/**
 * Create axios instance
 */
const createApiClient = (): AxiosInstance => {
  const config = getApiConfig();
  const client = axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor to add auth token
  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const token = tokenStorage.getAccessToken();
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor for error handling and token refresh
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & {
        _retry?: boolean;
      };

      // Handle 401 Unauthorized errors
      if (error.response?.status === 401 && !originalRequest._retry) {
        if (isRefreshing) {
          // Queue the request while refresh is in progress
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          })
            .then(() => {
              return client(originalRequest);
            })
            .catch((err) => {
              return Promise.reject(err);
            });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        const refreshToken = tokenStorage.getRefreshToken();

        if (!refreshToken) {
          // No refresh token, logout
          tokenStorage.clearTokens();
          if (onUnauthorized) onUnauthorized();
          return Promise.reject(
            new ApiError('No refresh token available', 401, 'NO_REFRESH_TOKEN')
          );
        }

        try {
          // Attempt to refresh the token
          const response = await axios.post(
            `${getApiConfig().baseURL}/auth/refresh`,
            {
              refresh_token: refreshToken,
            }
          );

          const { access_token, refresh_token: newRefreshToken } = response.data;
          tokenStorage.setTokens(access_token, newRefreshToken);

          // Update the authorization header
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${access_token}`;
          }

          processQueue(null, access_token);
          isRefreshing = false;

          // Retry the original request
          return client(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError as Error, null);
          isRefreshing = false;

          // Refresh failed, logout
          tokenStorage.clearTokens();
          if (onUnauthorized) onUnauthorized();

          return Promise.reject(
            new ApiError('Token refresh failed', 401, 'REFRESH_FAILED')
          );
        }
      }

      // Transform axios errors to ApiError
      if (error.response) {
        const data = error.response.data as {
          message?: string;
          detail?: string;
          code?: string;
        };
        throw new ApiError(
          data.message || data.detail || 'An error occurred',
          error.response.status,
          data.code,
          data
        );
      } else if (error.request) {
        throw new ApiError(
          'No response received from server',
          undefined,
          'NO_RESPONSE'
        );
      } else {
        throw new ApiError(error.message || 'Request failed', undefined, 'REQUEST_FAILED');
      }
    }
  );

  return client;
};

export const apiClient = createApiClient();

/**
 * Set custom token storage
 */
export const setTokenStorage = (storage: TokenStorage): void => {
  tokenStorage = storage;
};

/**
 * Set callback for unauthorized (401) errors
 */
export const setOnUnauthorized = (callback: () => void): void => {
  onUnauthorized = callback;
};

/**
 * Get current token storage
 */
export const getTokenStorage = (): TokenStorage => tokenStorage;
