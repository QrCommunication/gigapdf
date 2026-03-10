// API Configuration
export const API_BASE_URL = 'https://giga-pdf.com/api/v1';
export const API_TIMEOUT = 30000;

// App Configuration
export const APP_NAME = 'GigaPDF';
export const APP_VERSION = '1.0.0';

// Storage Keys
export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'gigapdf_access_token',
  REFRESH_TOKEN: 'gigapdf_refresh_token',
  USER_DATA: 'gigapdf_user_data',
  THEME: 'gigapdf_theme',
  LANGUAGE: 'gigapdf_language',
  ONBOARDING_COMPLETED: 'gigapdf_onboarding_completed',
} as const;

// Pagination
export const DEFAULT_PAGE_SIZE = 20;

// File Configuration
export const SUPPORTED_FILE_TYPES = {
  PDF: ['application/pdf'],
  IMAGES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  ALL: ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'],
} as const;

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
