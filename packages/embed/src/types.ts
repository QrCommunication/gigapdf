export interface GigaPdfOptions {
  /** API key for authentication */
  apiKey: string;
  /** Document ID to load (optional - opens empty editor if not provided) */
  documentId?: string;
  /** Base URL of GigaPDF (default: https://giga-pdf.com) */
  baseUrl?: string;
  /** Container element or CSS selector */
  container: HTMLElement | string;
  /** Width (default: 100%) */
  width?: string | number;
  /** Height (default: 600px) */
  height?: string | number;
  /** Locale (default: fr) */
  locale?: 'fr' | 'en';
  /** Theme (default: light) */
  theme?: 'light' | 'dark' | 'system';
  /** Hide toolbar */
  hideToolbar?: boolean;
  /** Allowed tools */
  tools?: ('text' | 'image' | 'shape' | 'annotation' | 'form' | 'signature')[];
}

export interface GigaPdfEvents {
  ready: () => void;
  save: (data: { documentId: string; pageCount: number }) => void;
  export: (data: { blob: Blob; format: string }) => void;
  error: (error: { code: string; message: string }) => void;
  pageChange: (data: { page: number; total: number }) => void;
}

export type GigaPdfEventName = keyof GigaPdfEvents;

/** Message sent from SDK to iframe */
export interface GigaPdfOutboundMessage {
  type: 'gigapdf:command';
  action: 'save' | 'export' | 'load';
  payload?: unknown;
}

/** Message received from iframe by SDK */
export interface GigaPdfInboundMessage {
  type: 'gigapdf:event';
  event: GigaPdfEventName;
  data?: unknown;
}
