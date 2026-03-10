/**
 * API Configuration Constants
 * Configure l'URL de base et les endpoints de l'API GigaPDF
 */

export const API_CONFIG = {
  BASE_URL: 'https://giga-pdf.com',
  API_VERSION: 'v1',
  TIMEOUT: 30000, // 30 secondes
} as const;

export const API_ENDPOINTS = {
  // Authentication endpoints
  AUTH: {
    LOGIN: '/api/auth/login',
    REGISTER: '/api/auth/register',
    LOGOUT: '/api/auth/logout',
    REFRESH: '/api/auth/refresh',
    FORGOT_PASSWORD: '/api/auth/forgot-password',
    RESET_PASSWORD: '/api/auth/reset-password',
    VERIFY_EMAIL: '/api/auth/verify-email',
    ME: '/api/auth/me',
  },

  // User endpoints
  USER: {
    PROFILE: '/api/user/profile',
    UPDATE_PROFILE: '/api/user/profile',
    CHANGE_PASSWORD: '/api/user/change-password',
    DELETE_ACCOUNT: '/api/user/delete-account',
    PREFERENCES: '/api/user/preferences',
  },

  // Documents endpoints
  DOCUMENTS: {
    LIST: '/api/documents',
    GET: (id: string) => `/api/documents/${id}`,
    CREATE: '/api/documents',
    UPDATE: (id: string) => `/api/documents/${id}`,
    DELETE: (id: string) => `/api/documents/${id}`,
    DOWNLOAD: (id: string) => `/api/documents/${id}/download`,
    UPLOAD: '/api/documents/upload',
    SHARE: (id: string) => `/api/documents/${id}/share`,
    FAVORITE: (id: string) => `/api/documents/${id}/favorite`,
    RECENT: '/api/documents/recent',
    FAVORITES: '/api/documents/favorites',
    TRASH: '/api/documents/trash',
    RESTORE: (id: string) => `/api/documents/${id}/restore`,
  },

  // PDF Operations endpoints
  PDF: {
    MERGE: '/api/pdf/merge',
    SPLIT: '/api/pdf/split',
    COMPRESS: '/api/pdf/compress',
    CONVERT_TO_PDF: '/api/pdf/convert',
    CONVERT_FROM_PDF: '/api/pdf/export',
    ROTATE: '/api/pdf/rotate',
    EXTRACT_PAGES: '/api/pdf/extract-pages',
    ADD_WATERMARK: '/api/pdf/watermark',
    PROTECT: '/api/pdf/protect',
    UNLOCK: '/api/pdf/unlock',
    OCR: '/api/pdf/ocr',
    SIGN: '/api/pdf/sign',
    FORM_FILL: '/api/pdf/form-fill',
  },

  // Folders endpoints
  FOLDERS: {
    LIST: '/api/folders',
    GET: (id: string) => `/api/folders/${id}`,
    CREATE: '/api/folders',
    UPDATE: (id: string) => `/api/folders/${id}`,
    DELETE: (id: string) => `/api/folders/${id}`,
    MOVE: '/api/folders/move',
  },

  // Sharing endpoints
  SHARING: {
    CREATE: '/api/sharing',
    LIST: '/api/sharing',
    GET: (id: string) => `/api/sharing/${id}`,
    UPDATE: (id: string) => `/api/sharing/${id}`,
    DELETE: (id: string) => `/api/sharing/${id}`,
    ACCEPT: (token: string) => `/api/sharing/accept/${token}`,
  },

  // Subscription endpoints
  SUBSCRIPTION: {
    PLANS: '/api/subscription/plans',
    CURRENT: '/api/subscription/current',
    SUBSCRIBE: '/api/subscription/subscribe',
    CANCEL: '/api/subscription/cancel',
    RESUME: '/api/subscription/resume',
    USAGE: '/api/subscription/usage',
  },
} as const;
