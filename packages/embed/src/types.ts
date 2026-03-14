export interface GigaPdfOptions {
  /** API key for authentication (secret key giga_pk_* or publishable key giga_pub_*) */
  apiKey: string;
  /** Alias for apiKey — publishable key for widget usage (giga_pub_*) */
  publicKey?: string;
  /** Document ID to load (optional - opens empty editor if not provided) */
  documentId?: string;
  /** PDF file to edit — triggers the file-in/file-out widget flow */
  file?: File | Blob;
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
  /** Show a "Done" button in the editor (default: true when file is provided) */
  showDoneButton?: boolean;
  /** Callback when the user clicks "Done" — receives the modified PDF as a Blob */
  onComplete?: (file: Blob) => void;
}

export interface GigaPdfEvents {
  ready: () => void;
  save: (data: { documentId: string; pageCount: number }) => void;
  export: (data: { blob: Blob; format: string }) => void;
  error: (error: { code: string; message: string }) => void;
  pageChange: (data: { page: number; total: number }) => void;
  complete: (data: { blob: Blob }) => void;
}

export type GigaPdfEventName = keyof GigaPdfEvents;

/** Message sent from SDK to iframe */
export interface GigaPdfOutboundMessage {
  type: 'gigapdf:command';
  action: 'save' | 'export' | 'load' | 'getFile';
  payload?: unknown;
}

/** Message received from iframe by SDK */
export interface GigaPdfInboundMessage {
  type: 'gigapdf:event';
  event: GigaPdfEventName;
  data?: unknown;
}
