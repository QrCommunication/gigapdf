/**
 * API Configuration
 */
export interface ApiConfig {
  baseURL: string;
  timeout: number;
  websocketURL: string;
}

// Support both Vite (VITE_*) and Next.js (NEXT_PUBLIC_*) environment variables
const getEnvVar = (viteKey: string, nextKey: string, defaultValue: string): string => {
  // Try Vite first (for Vite-based apps)
  if (typeof import.meta !== 'undefined' && import.meta.env?.[viteKey]) {
    return import.meta.env[viteKey];
  }
  // Try Next.js (for Next.js apps) - check if process.env exists in browser
  if (typeof process !== 'undefined' && process.env?.[nextKey]) {
    return process.env[nextKey];
  }
  return defaultValue;
};

const DEFAULT_CONFIG: ApiConfig = {
  baseURL: getEnvVar('VITE_API_URL', 'NEXT_PUBLIC_API_URL', 'http://localhost:8000') + '/api/v1',
  timeout: 30000,
  websocketURL: getEnvVar('VITE_WS_URL', 'NEXT_PUBLIC_WS_URL', 'http://localhost:8000'),
};

let currentConfig: ApiConfig = { ...DEFAULT_CONFIG };

export const getApiConfig = (): ApiConfig => currentConfig;

export const setApiConfig = (config: Partial<ApiConfig>): void => {
  currentConfig = { ...currentConfig, ...config };
};

export const resetApiConfig = (): void => {
  currentConfig = { ...DEFAULT_CONFIG };
};
