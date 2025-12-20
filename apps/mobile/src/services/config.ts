/**
 * API Configuration
 * Centralized configuration for API services
 */

// ============================================================================
// Environment Variables
// ============================================================================

// You can use environment variables with expo-constants
// import Constants from 'expo-constants';
// const API_URL = Constants.expoConfig?.extra?.apiUrl;

// ============================================================================
// API Configuration
// ============================================================================

export const API_CONFIG = {
  // Base API URL
  baseURL: 'https://giga-pdf.com/api/v1',

  // Alternative URLs for different environments
  urls: {
    production: 'https://giga-pdf.com/api/v1',
    staging: 'https://staging.giga-pdf.com/api/v1',
    development: 'https://dev.giga-pdf.com/api/v1',
    local: 'http://localhost:8000/api/v1',
  },

  // Timeouts (in milliseconds)
  timeouts: {
    default: 30000, // 30 seconds
    upload: 300000, // 5 minutes
    download: 300000, // 5 minutes
    longRunning: 600000, // 10 minutes
  },

  // Retry configuration
  retry: {
    enabled: true,
    maxRetries: 3,
    retryDelay: 1000, // 1 second
    retryableStatuses: [408, 429, 500, 502, 503, 504],
  },

  // Token configuration
  tokens: {
    storageKeys: {
      accessToken: 'auth_token',
      refreshToken: 'refresh_token',
    },
    refreshBuffer: 60, // Refresh token 60 seconds before expiry
  },

  // Request configuration
  headers: {
    common: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    upload: {
      'Content-Type': 'multipart/form-data',
    },
  },

  // Feature flags
  features: {
    enableLogging: __DEV__, // Enable in development only
    enableMetrics: true,
    enableCaching: true,
    enableOfflineMode: false,
  },

  // Cache configuration
  cache: {
    ttl: {
      default: 5 * 60 * 1000, // 5 minutes
      user: 10 * 60 * 1000, // 10 minutes
      documents: 2 * 60 * 1000, // 2 minutes
      pages: 5 * 60 * 1000, // 5 minutes
      previews: 30 * 60 * 1000, // 30 minutes
    },
  },

  // Pagination defaults
  pagination: {
    defaultPage: 1,
    defaultPerPage: 20,
    maxPerPage: 100,
  },

  // Upload configuration
  upload: {
    maxFileSize: 100 * 1024 * 1024, // 100 MB
    allowedMimeTypes: [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
    ],
    chunkSize: 1024 * 1024, // 1 MB chunks for large files
  },

  // Download configuration
  download: {
    defaultFormat: 'pdf',
    imageQuality: 90,
    imageDPI: 150,
  },
};

// ============================================================================
// Environment Detection
// ============================================================================

export function getEnvironment(): 'production' | 'staging' | 'development' | 'local' {
  if (__DEV__) {
    return 'development';
  }

  const { baseURL } = API_CONFIG;

  if (baseURL.includes('localhost') || baseURL.includes('127.0.0.1')) {
    return 'local';
  }

  if (baseURL.includes('staging')) {
    return 'staging';
  }

  if (baseURL.includes('dev')) {
    return 'development';
  }

  return 'production';
}

/**
 * Get API URL for current environment
 */
export function getApiUrl(): string {
  const env = getEnvironment();
  return API_CONFIG.urls[env] || API_CONFIG.baseURL;
}

// ============================================================================
// API Endpoints
// ============================================================================

export const ENDPOINTS = {
  // Authentication
  auth: {
    login: '/auth/login',
    register: '/auth/register',
    logout: '/auth/logout',
    refresh: '/auth/refresh',
    me: '/auth/me',
    profile: '/auth/profile',
    changePassword: '/auth/password/change',
    resetPassword: '/auth/password/reset',
    verifyEmail: '/auth/email/verify',
  },

  // Documents
  documents: {
    list: '/documents',
    get: (id: string) => `/documents/${id}`,
    upload: '/documents/upload',
    update: (id: string) => `/documents/${id}`,
    delete: (id: string) => `/documents/${id}`,
    download: (id: string) => `/documents/${id}/download`,
    unlock: (id: string) => `/documents/${id}/unlock`,
    extractText: (id: string) => `/documents/${id}/text/extract`,
    merge: '/documents/merge',
    split: (id: string) => `/documents/${id}/split`,
  },

  // Pages
  pages: {
    list: (documentId: string) => `/documents/${documentId}/pages`,
    get: (documentId: string, pageNum: number) =>
      `/documents/${documentId}/pages/${pageNum}`,
    preview: (documentId: string, pageNum: number) =>
      `/documents/${documentId}/pages/${pageNum}/preview`,
    add: (documentId: string) => `/documents/${documentId}/pages`,
    delete: (documentId: string, pageNum: number) =>
      `/documents/${documentId}/pages/${pageNum}`,
    reorder: (documentId: string) => `/documents/${documentId}/pages/reorder`,
    rotate: (documentId: string, pageNum: number) =>
      `/documents/${documentId}/pages/${pageNum}/rotate`,
    extract: (documentId: string) => `/documents/${documentId}/pages/extract`,
  },

  // Elements
  elements: {
    list: (documentId: string, pageNum: number) =>
      `/documents/${documentId}/pages/${pageNum}/elements`,
    get: (documentId: string, elementId: string) =>
      `/documents/${documentId}/elements/${elementId}`,
    create: (documentId: string, pageNum: number) =>
      `/documents/${documentId}/pages/${pageNum}/elements`,
    update: (documentId: string, elementId: string) =>
      `/documents/${documentId}/elements/${elementId}`,
    delete: (documentId: string, elementId: string) =>
      `/documents/${documentId}/elements/${elementId}`,
  },

  // Annotations
  annotations: {
    list: (documentId: string, pageNum: number) =>
      `/documents/${documentId}/pages/${pageNum}/annotations`,
    listAll: (documentId: string) => `/documents/${documentId}/annotations`,
    get: (documentId: string, annotationId: string) =>
      `/documents/${documentId}/annotations/${annotationId}`,
    createMarkup: (documentId: string, pageNum: number) =>
      `/documents/${documentId}/pages/${pageNum}/annotations/markup`,
    createNote: (documentId: string, pageNum: number) =>
      `/documents/${documentId}/pages/${pageNum}/annotations/note`,
    createLink: (documentId: string, pageNum: number) =>
      `/documents/${documentId}/pages/${pageNum}/annotations/link`,
    update: (documentId: string, annotationId: string) =>
      `/documents/${documentId}/annotations/${annotationId}`,
    delete: (documentId: string, annotationId: string) =>
      `/documents/${documentId}/annotations/${annotationId}`,
  },
};

// ============================================================================
// Error Messages
// ============================================================================

export const ERROR_MESSAGES = {
  network: {
    offline: 'No internet connection. Please check your network.',
    timeout: 'Request timeout. Please try again.',
    serverError: 'Server error. Please try again later.',
  },

  auth: {
    invalidCredentials: 'Invalid email or password.',
    sessionExpired: 'Your session has expired. Please login again.',
    unauthorized: 'You are not authorized to perform this action.',
    emailNotVerified: 'Please verify your email address.',
  },

  validation: {
    required: 'This field is required.',
    invalidEmail: 'Please enter a valid email address.',
    passwordTooShort: 'Password must be at least 8 characters.',
    passwordMismatch: 'Passwords do not match.',
  },

  upload: {
    fileTooLarge: 'File is too large. Maximum size is 100 MB.',
    invalidFileType: 'Invalid file type. Only PDF files are allowed.',
    uploadFailed: 'Upload failed. Please try again.',
  },

  document: {
    notFound: 'Document not found.',
    locked: 'This document is password protected.',
    processingFailed: 'Failed to process document.',
  },

  generic: {
    unknown: 'An unexpected error occurred.',
    tryAgain: 'Please try again.',
  },
};

// ============================================================================
// Success Messages
// ============================================================================

export const SUCCESS_MESSAGES = {
  auth: {
    loginSuccess: 'Login successful!',
    registerSuccess: 'Account created successfully!',
    logoutSuccess: 'Logged out successfully.',
    profileUpdated: 'Profile updated successfully.',
    passwordChanged: 'Password changed successfully.',
  },

  document: {
    uploaded: 'Document uploaded successfully!',
    deleted: 'Document deleted successfully.',
    updated: 'Document updated successfully.',
    downloaded: 'Document downloaded successfully.',
  },

  page: {
    added: 'Page added successfully.',
    deleted: 'Page deleted successfully.',
    rotated: 'Page rotated successfully.',
    reordered: 'Pages reordered successfully.',
  },

  element: {
    created: 'Element created successfully.',
    updated: 'Element updated successfully.',
    deleted: 'Element deleted successfully.',
  },

  annotation: {
    created: 'Annotation created successfully.',
    updated: 'Annotation updated successfully.',
    deleted: 'Annotation deleted successfully.',
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if file size is within limit
 */
export function isFileSizeValid(fileSize: number): boolean {
  return fileSize <= API_CONFIG.upload.maxFileSize;
}

/**
 * Check if file type is allowed
 */
export function isFileTypeAllowed(mimeType: string): boolean {
  return API_CONFIG.upload.allowedMimeTypes.includes(mimeType);
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get max file size formatted
 */
export function getMaxFileSizeFormatted(): string {
  return formatFileSize(API_CONFIG.upload.maxFileSize);
}

export default API_CONFIG;
