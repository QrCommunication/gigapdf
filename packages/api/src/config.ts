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
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const viteEnv = import.meta.env as Record<string, string | undefined>;
    if (viteEnv[viteKey]) {
      return viteEnv[viteKey]!;
    }
  }
  // Try Next.js (for Next.js apps) - check if process.env exists in browser
  if (typeof process !== 'undefined' && process.env) {
    const nextEnv = process.env as Record<string, string | undefined>;
    if (nextEnv[nextKey]) {
      return nextEnv[nextKey]!;
    }
  }
  return defaultValue;
};

// Browser-safe defaults: when no API URL env var is set, never hardcode the
// internal dev URL (http://localhost:8000) — in the browser it would be baked
// into the bundle and blocked by CSP. Fall back to the CURRENT ORIGIN instead
// (prod: https://giga-pdf.com). SSR/Node keeps the local Python default.
const browserHttpDefault = (): string =>
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000';

const browserWsDefault = (): string =>
  typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
    : 'ws://localhost:8000';

const DEFAULT_CONFIG: ApiConfig = {
  baseURL: getEnvVar('VITE_API_URL', 'NEXT_PUBLIC_API_URL', browserHttpDefault()) + '/api/v1',
  timeout: 30000,
  websocketURL: getEnvVar('VITE_WS_URL', 'NEXT_PUBLIC_WS_URL', browserWsDefault()),
};

let currentConfig: ApiConfig = { ...DEFAULT_CONFIG };

export const getApiConfig = (): ApiConfig => currentConfig;

export const setApiConfig = (config: Partial<ApiConfig>): void => {
  currentConfig = { ...currentConfig, ...config };
};

export const resetApiConfig = (): void => {
  currentConfig = { ...DEFAULT_CONFIG };
};
