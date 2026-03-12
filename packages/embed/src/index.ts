import type {
  GigaPdfOptions,
  GigaPdfEvents,
  GigaPdfEventName,
  GigaPdfInboundMessage,
  GigaPdfOutboundMessage,
} from './types';

export type { GigaPdfOptions, GigaPdfEvents, GigaPdfEventName };

const DEFAULT_BASE_URL = 'https://giga-pdf.com';
const DEFAULT_HEIGHT = '600px';
const DEFAULT_WIDTH = '100%';

function normalizeSize(value: string | number | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return `${value}px`;
  return value;
}

function resolveContainer(container: HTMLElement | string): HTMLElement {
  if (typeof container === 'string') {
    const el = document.querySelector<HTMLElement>(container);
    if (!el) {
      throw new Error(`[GigaPdf] Container not found: "${container}"`);
    }
    return el;
  }
  return container;
}

function buildEmbedUrl(options: GigaPdfOptions): string {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const params = new URLSearchParams();

  params.set('apiKey', options.apiKey);

  if (options.locale) params.set('locale', options.locale);
  if (options.theme) params.set('theme', options.theme);
  if (options.hideToolbar) params.set('hideToolbar', 'true');
  if (options.tools && options.tools.length > 0) {
    params.set('tools', options.tools.join(','));
  }

  const path = options.documentId
    ? `/embed/${options.documentId}`
    : '/embed';

  return `${base}${path}?${params.toString()}`;
}

type EventMap = {
  [E in GigaPdfEventName]: GigaPdfEvents[E][];
};

export class GigaPdfEditor {
  private readonly iframe: HTMLIFrameElement;
  private readonly containerEl: HTMLElement;
  private readonly allowedOrigin: string;
  private readonly listeners: EventMap;
  private readonly messageHandler: (event: MessageEvent) => void;
  private destroyed = false;

  constructor(options: GigaPdfOptions) {
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.allowedOrigin = new URL(baseUrl).origin;
    this.containerEl = resolveContainer(options.container);

    this.listeners = {
      ready: [],
      save: [],
      export: [],
      error: [],
      pageChange: [],
    };

    this.iframe = document.createElement('iframe');
    this.iframe.src = buildEmbedUrl(options);
    this.iframe.style.width = normalizeSize(options.width, DEFAULT_WIDTH);
    this.iframe.style.height = normalizeSize(options.height, DEFAULT_HEIGHT);
    this.iframe.style.border = 'none';
    this.iframe.style.display = 'block';
    this.iframe.allow = 'clipboard-read; clipboard-write';
    this.iframe.setAttribute('data-gigapdf', 'true');

    this.messageHandler = (event: MessageEvent) => {
      this.handleMessage(event);
    };

    window.addEventListener('message', this.messageHandler);
    this.containerEl.appendChild(this.iframe);
  }

  private handleMessage(event: MessageEvent): void {
    if (this.destroyed) return;
    if (event.origin !== this.allowedOrigin) return;

    const message = event.data as GigaPdfInboundMessage;
    if (!message || message.type !== 'gigapdf:event') return;

    const { event: eventName, data } = message;

    switch (eventName) {
      case 'ready': {
        const callbacks = this.listeners.ready;
        for (const cb of callbacks) cb();
        break;
      }
      case 'save': {
        const callbacks = this.listeners.save;
        const payload = data as Parameters<GigaPdfEvents['save']>[0];
        for (const cb of callbacks) cb(payload);
        break;
      }
      case 'export': {
        const callbacks = this.listeners.export;
        const payload = data as Parameters<GigaPdfEvents['export']>[0];
        for (const cb of callbacks) cb(payload);
        break;
      }
      case 'error': {
        const callbacks = this.listeners.error;
        const payload = data as Parameters<GigaPdfEvents['error']>[0];
        for (const cb of callbacks) cb(payload);
        break;
      }
      case 'pageChange': {
        const callbacks = this.listeners.pageChange;
        const payload = data as Parameters<GigaPdfEvents['pageChange']>[0];
        for (const cb of callbacks) cb(payload);
        break;
      }
    }
  }

  private postCommand(action: GigaPdfOutboundMessage['action'], payload?: unknown): void {
    if (this.destroyed) return;
    if (!this.iframe.contentWindow) return;

    const message: GigaPdfOutboundMessage = { type: 'gigapdf:command', action, payload };
    this.iframe.contentWindow.postMessage(message, this.allowedOrigin);
  }

  on<E extends GigaPdfEventName>(event: E, callback: GigaPdfEvents[E]): this {
    if (this.destroyed) return this;
    (this.listeners[event] as GigaPdfEvents[E][]).push(callback);
    return this;
  }

  off<E extends GigaPdfEventName>(event: E, callback: GigaPdfEvents[E]): this {
    const list = this.listeners[event] as GigaPdfEvents[E][];
    const index = list.indexOf(callback);
    if (index !== -1) list.splice(index, 1);
    return this;
  }

  exportPdf(format = 'pdf'): void {
    this.postCommand('export', { format });
  }

  savePdf(): void {
    this.postCommand('save');
  }

  loadDocument(documentId: string): void {
    this.postCommand('load', { documentId });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener('message', this.messageHandler);
    if (this.iframe.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }
    (this.listeners as Partial<EventMap>).ready = [];
    (this.listeners as Partial<EventMap>).save = [];
    (this.listeners as Partial<EventMap>).export = [];
    (this.listeners as Partial<EventMap>).error = [];
    (this.listeners as Partial<EventMap>).pageChange = [];
  }
}

export const GigaPdf = {
  init(options: GigaPdfOptions): GigaPdfEditor {
    return new GigaPdfEditor(options);
  },
} as const;

// UMD/CDN global exposure
if (typeof window !== 'undefined') {
  (window as Window & { GigaPdf?: typeof GigaPdf }).GigaPdf = GigaPdf;
}
