import type {
  GigaPdfOptions,
  GigaPdfEvents,
  GigaPdfEventName,
  GigaPdfInboundMessage,
  GigaPdfOutboundMessage,
} from './types';

export type { GigaPdfOptions, GigaPdfEvents, GigaPdfEventName };

/**
 * Returns true if `key` is a valid publishable key (giga_pub_* prefix).
 * Publishable keys are safe to use in client-side code.
 */
export function isPublishableKey(key: string): key is `giga_pub_${string}` {
  return key.startsWith('giga_pub_');
}

/**
 * Validates the publishable key from options.
 * - Throws if a secret key (giga_pk_*) is detected.
 * - Warns if the key format is unrecognised.
 */
function validatePublicKey(options: GigaPdfOptions): string {
  const key = options.publicKey;

  if (key.startsWith('giga_pk_')) {
    throw new Error(
      '[GigaPdf] Do not use secret keys (giga_pk_*) in client-side code. ' +
      'Use publishable keys (giga_pub_*) instead. ' +
      'Secret keys can be generated in your GigaPDF dashboard under API Keys.',
    );
  }

  if (!isPublishableKey(key)) {
    console.warn(
      '[GigaPdf] Invalid key format. Expected a publishable key starting with "giga_pub_". ' +
      'Make sure you are using a publishable key from your GigaPDF dashboard.',
    );
  }

  return key;
}

const DEFAULT_BASE_URL = 'https://giga-pdf.com';
const DEFAULT_HEIGHT = '600px';
const DEFAULT_WIDTH = '100%';

/**
 * Margin in seconds before token expiry to trigger a proactive refresh.
 * When fewer than this many seconds remain, the SDK will fetch a new token
 * and update the iframe src before the current one expires.
 */
const TOKEN_REFRESH_MARGIN_SECONDS = 120; // refresh when < 2 min remaining

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

/**
 * Exchange a publishable key for a short-lived JWT session token.
 *
 * The key is sent as an `X-API-Key` header — it NEVER appears in the URL,
 * browser history, or server access logs.
 *
 * Returns the token string and its TTL in seconds.
 */
async function fetchSessionToken(
  baseUrl: string,
  publicKey: string,
): Promise<{ token: string; expiresIn: number }> {
  const res = await fetch(`${baseUrl}/api/v1/embed/session-token`, {
    method: 'POST',
    headers: {
      'X-API-Key': publicKey,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { detail?: string }).detail
        ?? `[GigaPdf] Failed to obtain session token (HTTP ${res.status})`,
    );
  }

  const json = await res.json();
  const data = (json.data ?? json) as { session_token: string; expires_in: number };
  return { token: data.session_token, expiresIn: data.expires_in };
}

/**
 * Build the iframe embed URL using the ephemeral JWT token.
 *
 * The raw publishable key is never placed in the URL — only the signed token.
 */
function buildEmbedUrl(
  options: GigaPdfOptions,
  sessionToken: string,
  extra?: { sessionId?: string; documentId?: string },
): string {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const params = new URLSearchParams();

  // Use the ephemeral JWT — never expose the raw publishable key in the URL.
  params.set('token', sessionToken);

  if (options.locale) params.set('locale', options.locale);
  if (options.theme) params.set('theme', options.theme);
  if (options.hideToolbar) params.set('hideToolbar', 'true');
  if (options.tools && options.tools.length > 0) {
    params.set('tools', options.tools.join(','));
  }

  const showDone = options.showDoneButton ?? !!options.file;
  if (showDone) params.set('showDoneButton', 'true');

  if (extra?.sessionId) params.set('sessionId', extra.sessionId);

  const docId = extra?.documentId ?? options.documentId;
  const path = docId ? `/embed/${docId}` : '/embed';

  return `${base}${path}?${params.toString()}`;
}

async function uploadFileSession(
  options: GigaPdfOptions,
  key: string,
): Promise<{ sessionId: string; documentId: string }> {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const form = new FormData();
  form.append('file', options.file!, 'document.pdf');

  const res = await fetch(`${base}/api/v1/embed/sessions`, {
    method: 'POST',
    headers: { 'X-API-Key': key },
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `Upload failed (${res.status})`);
  }

  const json = await res.json();
  return json.data ?? json;
}

type EventMap = {
  [E in GigaPdfEventName]: GigaPdfEvents[E][];
};

export class GigaPdfEditor {
  private readonly iframe: HTMLIFrameElement;
  private readonly containerEl: HTMLElement;
  private readonly allowedOrigin: string;
  private readonly baseUrl: string;
  private readonly publicKey: string;
  private readonly listeners: EventMap;
  private readonly messageHandler: (event: MessageEvent) => void;
  private readonly onComplete?: (file: Blob) => void;
  private sessionId: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private resolveReady: () => void = () => {};

  constructor(options: GigaPdfOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.allowedOrigin = new URL(this.baseUrl).origin;
    this.containerEl = resolveContainer(options.container);
    this.publicKey = validatePublicKey(options);
    this.onComplete = options.onComplete;

    this.listeners = {
      ready: [],
      save: [],
      export: [],
      error: [],
      pageChange: [],
      complete: [],
    };

    this.iframe = document.createElement('iframe');
    this.iframe.style.width = normalizeSize(options.width, DEFAULT_WIDTH);
    this.iframe.style.height = normalizeSize(options.height, DEFAULT_HEIGHT);
    this.iframe.style.border = 'none';
    this.iframe.style.display = 'block';
    this.iframe.allow = 'clipboard-read; clipboard-write';
    this.iframe.setAttribute('data-gigapdf', 'true');

    // WID-07: restrict iframe capabilities via sandbox attribute
    this.iframe.sandbox.add(
      'allow-scripts',
      'allow-same-origin',
      'allow-forms',
      'allow-downloads',
      'allow-popups',
      'allow-popups-to-escape-sandbox',
      'allow-clipboard-read',
      'allow-clipboard-write',
    );

    this.messageHandler = (event: MessageEvent) => {
      this.handleMessage(event);
    };
    window.addEventListener('message', this.messageHandler);

    // Fetch an ephemeral session token, then build the iframe.
    this.initWithSessionToken(options);
  }

  /**
   * Fetch an ephemeral JWT, then mount the iframe.
   * Also schedules automatic token refresh before expiry.
   */
  private initWithSessionToken(options: GigaPdfOptions): void {
    fetchSessionToken(this.baseUrl, this.publicKey)
      .then(({ token, expiresIn }) => {
        if (this.destroyed) return;
        this.scheduleTokenRefresh(expiresIn);

        if (options.file) {
          // File flow: upload first (uses X-API-Key header), then create iframe
          return uploadFileSession(options, this.publicKey)
            .then(({ sessionId, documentId }) => {
              if (this.destroyed) return;
              this.sessionId = sessionId;
              this.iframe.src = buildEmbedUrl(options, token, { sessionId, documentId });
              this.containerEl.appendChild(this.iframe);
            });
        } else {
          this.iframe.src = buildEmbedUrl(options, token);
          this.containerEl.appendChild(this.iframe);
          return Promise.resolve();
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        const errorCbs = this.listeners.error;
        for (const cb of errorCbs) {
          cb({ code: 'SESSION_TOKEN_FAILED', message });
        }
      });
  }

  /**
   * Schedule a proactive token refresh so the iframe never receives an
   * expired token.  The refresh fires `TOKEN_REFRESH_MARGIN_SECONDS` before
   * expiry and updates the iframe src in-place (no full reload).
   */
  private scheduleTokenRefresh(expiresIn: number): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    const delayMs = Math.max(0, (expiresIn - TOKEN_REFRESH_MARGIN_SECONDS) * 1000);

    this.refreshTimer = setTimeout(() => {
      if (this.destroyed) return;
      this.refreshToken();
    }, delayMs);
  }

  /**
   * Refresh the session token and update the iframe src.
   * Called automatically by the refresh timer.
   */
  private refreshToken(): void {
    fetchSessionToken(this.baseUrl, this.publicKey)
      .then(({ token, expiresIn }) => {
        if (this.destroyed) return;
        this.scheduleTokenRefresh(expiresIn);

        // Update iframe src so the page can acquire a fresh token if it needs
        // to re-validate (e.g. after a postMessage-triggered reload).
        const url = new URL(this.iframe.src);
        url.searchParams.set('token', token);
        this.iframe.src = url.toString();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[GigaPdf] Token refresh failed:', message);
        // Retry in 30 seconds
        if (!this.destroyed) {
          this.refreshTimer = setTimeout(() => this.refreshToken(), 30_000);
        }
      });
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
      case 'complete': {
        const payload = data as Parameters<GigaPdfEvents['complete']>[0];
        const callbacks = this.listeners.complete;
        for (const cb of callbacks) cb(payload);
        if (this.onComplete && payload?.blob) {
          this.onComplete(payload.blob);
        }
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
    if (event === 'ready') {
      // Also resolve the internal ready promise
      const origResolve = this.resolveReady;
      const wrappedCb = () => { origResolve(); };
      (this.listeners.ready as GigaPdfEvents['ready'][]).push(wrappedCb);
    }
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

  /** Request the modified file from the editor */
  getFile(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (this.destroyed) {
        reject(new Error('[GigaPdf] Editor is destroyed'));
        return;
      }

      const onComplete = (data: { blob: Blob }) => {
        this.off('complete', onComplete);
        this.off('error', onError);
        resolve(data.blob);
      };
      const onError = (err: { code: string; message: string }) => {
        this.off('complete', onComplete);
        this.off('error', onError);
        reject(new Error(err.message));
      };

      this.on('complete', onComplete);
      this.on('error', onError);
      this.postCommand('getFile');
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    // Cancel the token refresh timer
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    window.removeEventListener('message', this.messageHandler);
    if (this.iframe.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }

    // Cleanup embed session on the server (fire-and-forget, uses X-API-Key header)
    if (this.sessionId) {
      fetch(`${this.baseUrl}/api/v1/embed/sessions/${this.sessionId}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': this.publicKey },
      }).catch(() => { /* best-effort */ });
    }

    (this.listeners as Partial<EventMap>).ready = [];
    (this.listeners as Partial<EventMap>).save = [];
    (this.listeners as Partial<EventMap>).export = [];
    (this.listeners as Partial<EventMap>).error = [];
    (this.listeners as Partial<EventMap>).pageChange = [];
    (this.listeners as Partial<EventMap>).complete = [];
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
