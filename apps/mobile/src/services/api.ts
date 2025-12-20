/**
 * API Client Configuration
 * Axios instance with interceptors, error handling, and token management
 */

import axios, {
  AxiosInstance,
  AxiosError,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import * as SecureStore from 'expo-secure-store';
import { ApiException, ApiResponse } from './types';

// ============================================================================
// Constants
// ============================================================================

const BASE_URL = 'https://giga-pdf.com';
const API_BASE_URL = `${BASE_URL}/api/v1`;
const AUTH_BASE_URL = `${BASE_URL}/api/auth`;
const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const SESSION_KEY = 'session_data';
// JWT token from Better Auth jwt plugin
const JWT_TOKEN_KEY = 'gigapdf_jwt_token';
// Better Auth expoClient storage key (storagePrefix + '_session_token')
const EXPO_CLIENT_TOKEN_KEY = 'gigapdf_session_token';
const EXPO_CLIENT_SESSION_KEY = 'gigapdf_session';
const REQUEST_TIMEOUT = 30000; // 30 seconds
const UPLOAD_TIMEOUT = 300000; // 5 minutes for uploads

export { BASE_URL, AUTH_BASE_URL };

// ============================================================================
// Token Management
// ============================================================================

export const tokenManager = {
  async getAccessToken(): Promise<string | null> {
    try {
      // Priority 1: JWT token from Better Auth jwt plugin
      let token = await SecureStore.getItemAsync(JWT_TOKEN_KEY);
      if (token) {
        console.log('[TokenManager] Using JWT token');
        return token;
      }

      // Priority 2: Our auth_token storage
      token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (token) {
        return token;
      }

      // Fallback: try expoClient storage formats
      token = await SecureStore.getItemAsync(EXPO_CLIENT_TOKEN_KEY);
      if (token) {
        console.log('[TokenManager] Found token in expoClient storage');
        return token;
      }

      // Try session object from expoClient
      const sessionStr = await SecureStore.getItemAsync(EXPO_CLIENT_SESSION_KEY);
      if (sessionStr) {
        try {
          const session = JSON.parse(sessionStr);
          if (session?.token) {
            console.log('[TokenManager] Found token in expoClient session');
            return session.token;
          }
        } catch {
          // Session might be the token directly
          console.log('[TokenManager] Using expoClient session as token');
          return sessionStr;
        }
      }

      return null;
    } catch (error) {
      console.error('Error getting access token:', error);
      return null;
    }
  },

  async setAccessToken(token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
    } catch (error) {
      console.error('Error setting access token:', error);
    }
  },

  async getRefreshToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    } catch (error) {
      console.error('Error getting refresh token:', error);
      return null;
    }
  },

  async setRefreshToken(token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
    } catch (error) {
      console.error('Error setting refresh token:', error);
    }
  },

  async setTokens(accessToken: string, refreshToken?: string): Promise<void> {
    await this.setAccessToken(accessToken);
    if (refreshToken) {
      await this.setRefreshToken(refreshToken);
    }
  },

  async getSession(): Promise<any | null> {
    try {
      const session = await SecureStore.getItemAsync(SESSION_KEY);
      return session ? JSON.parse(session) : null;
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  },

  async setSession(session: any): Promise<void> {
    try {
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
    } catch (error) {
      console.error('Error setting session:', error);
    }
  },

  async clearTokens(): Promise<void> {
    try {
      await Promise.all([
        SecureStore.deleteItemAsync(TOKEN_KEY),
        SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
        SecureStore.deleteItemAsync(SESSION_KEY),
        SecureStore.deleteItemAsync(JWT_TOKEN_KEY),
        // Also clear expoClient storage
        SecureStore.deleteItemAsync(EXPO_CLIENT_TOKEN_KEY),
        SecureStore.deleteItemAsync(EXPO_CLIENT_SESSION_KEY),
      ]);
    } catch (error) {
      console.error('Error clearing tokens:', error);
    }
  },

  // Debug function to check all stored keys
  async debugStoredKeys(): Promise<void> {
    const keys = [
      TOKEN_KEY,
      JWT_TOKEN_KEY,
      REFRESH_TOKEN_KEY,
      SESSION_KEY,
      EXPO_CLIENT_TOKEN_KEY,
      EXPO_CLIENT_SESSION_KEY,
      'gigapdf.session_token',
      'gigapdf.session',
      'gigapdf-session_token',
      'gigapdf-session',
    ];

    console.log('[TokenManager] Checking stored keys:');
    for (const key of keys) {
      try {
        const value = await SecureStore.getItemAsync(key);
        if (value) {
          const preview = value.length > 50 ? value.substring(0, 50) + '...' : value;
          console.log(`  [${key}]: ${preview}`);
        }
      } catch (e) {
        // Key doesn't exist or error
      }
    }
  },
};

// ============================================================================
// Axios Instance Configuration
// ============================================================================

class ApiClient {
  private instance: AxiosInstance;
  private isRefreshing = false;
  private refreshSubscribers: Array<(token: string) => void> = [];

  constructor() {
    this.instance = axios.create({
      baseURL: API_BASE_URL,
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        // Origin header required for CORS/CSRF protection
        'Origin': 'https://giga-pdf.com',
        // Custom header to identify mobile client
        'X-Client-Type': 'mobile',
      },
    });

    this.setupInterceptors();
  }

  /**
   * Setup request and response interceptors
   */
  private setupInterceptors(): void {
    // Request interceptor - Add auth token
    this.instance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        const token = await tokenManager.getAccessToken();

        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
          console.log('[API] Token added to request:', token.substring(0, 30) + '...');
        } else {
          console.warn('[API] No token found for request:', config.url);
        }

        // Log request in development
        if (__DEV__) {
          console.log(`[API Request] ${config.method?.toUpperCase()} ${config.url}`, {
            params: config.params,
            hasAuth: !!config.headers?.Authorization,
          });
        }

        return config;
      },
      (error: AxiosError) => {
        console.error('[API Request Error]', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor - Handle errors and token refresh
    this.instance.interceptors.response.use(
      (response: AxiosResponse) => {
        // Log response in development
        if (__DEV__) {
          console.log(`[API Response] ${response.config.method?.toUpperCase()} ${response.config.url}`, {
            status: response.status,
            data: response.data,
          });
        }

        return response;
      },
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & {
          _retry?: boolean;
        };

        // Log error in development
        if (__DEV__) {
          console.error('[API Response Error]', {
            url: originalRequest?.url,
            status: error.response?.status,
            data: error.response?.data,
          });
        }

        // Handle 401 Unauthorized - Token refresh
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            const newToken = await this.refreshAccessToken();

            if (newToken && originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              return this.instance(originalRequest);
            }
          } catch (refreshError) {
            // Refresh failed - Clear tokens and redirect to login
            await tokenManager.clearTokens();
            // Emit event for app to handle (e.g., navigate to login)
            this.emitUnauthorizedEvent();
            return Promise.reject(refreshError);
          }
        }

        // Transform error to ApiException
        throw this.handleError(error);
      }
    );
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(): Promise<string | null> {
    if (this.isRefreshing) {
      // Wait for the current refresh to complete
      return new Promise((resolve) => {
        this.refreshSubscribers.push((token: string) => {
          resolve(token);
        });
      });
    }

    this.isRefreshing = true;

    try {
      const refreshToken = await tokenManager.getRefreshToken();

      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await axios.post(
        `${API_BASE_URL}/auth/refresh`,
        { refresh_token: refreshToken },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        }
      );

      const { access_token, refresh_token: newRefreshToken } = response.data.data.tokens;

      await tokenManager.setTokens(access_token, newRefreshToken);

      // Notify all subscribers
      this.refreshSubscribers.forEach((callback) => callback(access_token));
      this.refreshSubscribers = [];

      return access_token;
    } catch (error) {
      console.error('Token refresh failed:', error);
      this.refreshSubscribers = [];
      throw error;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Handle API errors and transform to ApiException
   */
  private handleError(error: AxiosError): ApiException {
    if (error.response) {
      // Server responded with error status
      const data = error.response.data as ApiResponse;

      return new ApiException(
        data.message || data.error || 'An error occurred',
        error.response.status,
        data.error,
        data.errors,
        data
      );
    } else if (error.request) {
      // Request made but no response received
      return new ApiException(
        'Network error. Please check your connection.',
        0,
        'NETWORK_ERROR',
        undefined,
        error
      );
    } else {
      // Error in request configuration
      return new ApiException(
        error.message || 'An unexpected error occurred',
        0,
        'REQUEST_ERROR',
        undefined,
        error
      );
    }
  }

  /**
   * Emit unauthorized event for app to handle
   * Note: We just log here - the auth store handles redirect on 401
   */
  private emitUnauthorizedEvent(): void {
    console.warn('[API] Unauthorized - User needs to login again');
    // Token clearing and logout is handled by the auth store
  }

  /**
   * Get the axios instance
   */
  getInstance(): AxiosInstance {
    return this.instance;
  }

  /**
   * Generic GET request
   */
  async get<T = any>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.instance.get<ApiResponse<T>>(url, config);
    return response.data;
  }

  /**
   * Generic POST request
   */
  async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.instance.post<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  /**
   * Generic PUT request
   */
  async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.instance.put<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  /**
   * Generic PATCH request
   */
  async patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.instance.patch<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  /**
   * Generic DELETE request
   */
  async delete<T = any>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.instance.delete<ApiResponse<T>>(url, config);
    return response.data;
  }

  /**
   * Upload file with progress tracking
   */
  async uploadFile<T = any>(
    url: string,
    formData: FormData,
    onProgress?: (progress: number) => void
  ): Promise<ApiResponse<T>> {
    const response = await this.instance.post<ApiResponse<T>>(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: UPLOAD_TIMEOUT,
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      },
    });
    return response.data;
  }

  /**
   * Download file with progress tracking
   */
  async downloadFile(
    url: string,
    onProgress?: (progress: number) => void
  ): Promise<Blob> {
    const response = await this.instance.get(url, {
      responseType: 'blob',
      onDownloadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      },
    });
    return response.data;
  }
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const apiClient = new ApiClient();
export const axiosInstance = apiClient.getInstance();

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if error is an ApiException
 */
export function isApiException(error: any): error is ApiException {
  return error instanceof ApiException;
}

/**
 * Get error message from any error type
 */
export function getErrorMessage(error: any): string {
  if (isApiException(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected error occurred';
}

/**
 * Get validation errors from ApiException
 */
export function getValidationErrors(error: any): Record<string, string[]> | undefined {
  if (isApiException(error)) {
    return error.errors;
  }
  return undefined;
}

/**
 * Create FormData from object (helper for file uploads)
 */
export function createFormData(data: Record<string, any>): FormData {
  const formData = new FormData();

  Object.keys(data).forEach((key) => {
    const value = data[key];

    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          formData.append(`${key}[${index}]`, item);
        });
      } else if (typeof value === 'object' && !(value instanceof File || value instanceof Blob)) {
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, value);
      }
    }
  });

  return formData;
}

export default apiClient;
