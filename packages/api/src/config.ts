/**
 * API Configuration
 */
export interface ApiConfig {
  baseURL: string;
  timeout: number;
  websocketURL: string;
}

const DEFAULT_CONFIG: ApiConfig = {
  baseURL: import.meta.env?.VITE_API_URL || 'http://localhost:8000/api/v1',
  timeout: 30000,
  websocketURL: import.meta.env?.VITE_WS_URL || 'http://localhost:8000',
};

let currentConfig: ApiConfig = { ...DEFAULT_CONFIG };

export const getApiConfig = (): ApiConfig => currentConfig;

export const setApiConfig = (config: Partial<ApiConfig>): void => {
  currentConfig = { ...currentConfig, ...config };
};

export const resetApiConfig = (): void => {
  currentConfig = { ...DEFAULT_CONFIG };
};
