import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GigaPdfEditor, GigaPdf, isPublishableKey } from '../index';
import type { GigaPdfInboundMessage } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_SESSION_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.fake.token';
const SESSION_TOKEN_EXPIRES_IN = 1800;

/**
 * Mock global `fetch` so that:
 *   POST /api/v1/embed/session-token → returns a fake JWT
 *   Everything else → 200 OK empty JSON
 */
function mockFetchSessionToken(overrides?: Partial<{ token: string; expiresIn: number; status: number }>) {
  const token = overrides?.token ?? FAKE_SESSION_TOKEN;
  const expiresIn = overrides?.expiresIn ?? SESSION_TOKEN_EXPIRES_IN;
  const httpStatus = overrides?.status ?? 200;

  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/v1/embed/session-token')) {
      return new Response(
        JSON.stringify({ data: { session_token: token, expires_in: expiresIn } }),
        { status: httpStatus, headers: { 'Content-Type': 'application/json' } },
      );
    }
    // Default for file-upload and session-delete calls
    return new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

/**
 * Wait for the editor to mount the iframe (async token fetch + appendChild).
 * Uses a short polling loop so tests remain fast.
 */
async function waitForIframe(container: HTMLElement, timeoutMs = 500): Promise<HTMLIFrameElement> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const iframe = container.querySelector<HTMLIFrameElement>('iframe');
    if (iframe) return iframe;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('[test] iframe not mounted within timeout — did you mock fetch?');
}

/**
 * Simulate an inbound postMessage from the iframe as if the GigaPDF origin
 * sent a `gigapdf:event` message to the host window.
 */
function dispatchInboundMessage(
  message: GigaPdfInboundMessage,
  origin = 'https://giga-pdf.com',
) {
  const event = new MessageEvent('message', { data: message, origin });
  window.dispatchEvent(event);
}

/** Create and attach a fresh container div to the body. */
function makeContainer(): HTMLDivElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let editorContainer: HTMLDivElement;

beforeEach(() => {
  editorContainer = makeContainer();
  editorContainer.id = 'editor';

  // jsdom does not implement DOMTokenList on iframe.sandbox — patch it.
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const el = origCreate(tag, options);
    if (tag === 'iframe') {
      const iframeEl = el as HTMLIFrameElement;
      if (!iframeEl.sandbox) {
        const tokenSet = new Set<string>();
        Object.defineProperty(iframeEl, 'sandbox', {
          value: {
            add: (...tokens: string[]) => { tokens.forEach((t) => tokenSet.add(t)); },
            remove: (...tokens: string[]) => { tokens.forEach((t) => tokenSet.delete(t)); },
            contains: (token: string) => tokenSet.has(token),
            toString: () => [...tokenSet].join(' '),
          },
          configurable: true,
        });
      }
    }
    return el;
  });

  // Provide a default fetch mock for every test (can be overridden per test)
  mockFetchSessionToken();
});

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Session token exchange (WID-05 — core security requirement)
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — session token exchange', () => {
  it('calls /api/v1/embed/session-token with X-API-Key header on init', async () => {
    const fetchSpy = vi.mocked(globalThis.fetch);
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_my_key', container });

    await waitForIframe(container);

    const sessionTokenCall = fetchSpy.mock.calls.find(([url]) =>
      (typeof url === 'string' ? url : (url as Request).url).includes('/api/v1/embed/session-token'),
    );
    expect(sessionTokenCall).toBeDefined();
    const [, init] = sessionTokenCall!;
    expect((init as RequestInit).headers).toMatchObject({ 'X-API-Key': 'giga_pub_my_key' });

    editor.destroy();
  });

  it('uses ?token= in the iframe URL — never exposes the raw key', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_my_key', container });

    const iframe = await waitForIframe(container);
    const url = new URL(iframe.src);

    expect(url.searchParams.get('token')).toBe(FAKE_SESSION_TOKEN);
    expect(url.searchParams.has('apiKey')).toBe(false);

    editor.destroy();
  });

  it('fires SESSION_TOKEN_FAILED error event when the token fetch fails', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('network failure'));

    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_my_key', container });
    const errorCb = vi.fn();
    editor.on('error', errorCb);

    // Wait for async rejection to propagate
    await new Promise((r) => setTimeout(r, 50));

    expect(errorCb).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SESSION_TOKEN_FAILED' }),
    );

    editor.destroy();
  });

  it('fires SESSION_TOKEN_FAILED when backend returns HTTP 401', async () => {
    mockFetchSessionToken({ status: 401 });

    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_invalid', container });
    const errorCb = vi.fn();
    editor.on('error', errorCb);

    await new Promise((r) => setTimeout(r, 50));

    expect(errorCb).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SESSION_TOKEN_FAILED' }),
    );

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — URL construction', () => {
  it('builds correct embed URL with ?token= and publicKey', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_my_key', container });
    const iframe = await waitForIframe(container);
    const url = new URL(iframe.src);

    expect(url.searchParams.get('token')).toBe(FAKE_SESSION_TOKEN);

    editor.destroy();
  });

  it('builds URL with documentId — path is /embed/{documentId}', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container, documentId: 'doc-123' });
    const iframe = await waitForIframe(container);
    const url = new URL(iframe.src);

    expect(url.pathname).toBe('/embed/doc-123');

    editor.destroy();
  });

  it('builds URL without documentId — path is /embed', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const iframe = await waitForIframe(container);
    const url = new URL(iframe.src);

    expect(url.pathname).toBe('/embed');

    editor.destroy();
  });

  it('uses a custom baseUrl', async () => {
    // The beforeEach fetch mock already handles any URL — no override needed.
    const container = makeContainer();
    const editor = new GigaPdfEditor({
      publicKey: 'giga_pub_test',
      container,
      baseUrl: 'https://custom.example.com',
    });
    const iframe = await waitForIframe(container);

    expect(iframe.src).toMatch(/^https:\/\/custom\.example\.com/);

    editor.destroy();
  });

  it('strips a trailing slash from baseUrl', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({
      publicKey: 'giga_pub_test',
      container,
      baseUrl: 'https://custom.example.com/',
    });
    const iframe = await waitForIframe(container);
    const url = new URL(iframe.src);

    expect(url.origin).toBe('https://custom.example.com');

    editor.destroy();
  });

  it('includes locale param when provided', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container, locale: 'en' });
    const iframe = await waitForIframe(container);
    const url = new URL(iframe.src);

    expect(url.searchParams.get('locale')).toBe('en');

    editor.destroy();
  });

  it('includes theme param when provided', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container, theme: 'dark' });
    const iframe = await waitForIframe(container);
    const url = new URL(iframe.src);

    expect(url.searchParams.get('theme')).toBe('dark');

    editor.destroy();
  });

  it('includes hideToolbar param when true', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container, hideToolbar: true });
    const iframe = await waitForIframe(container);
    const url = new URL(iframe.src);

    expect(url.searchParams.get('hideToolbar')).toBe('true');

    editor.destroy();
  });

  it('does not include hideToolbar param when false', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container, hideToolbar: false });
    const iframe = await waitForIframe(container);
    const url = new URL(iframe.src);

    expect(url.searchParams.has('hideToolbar')).toBe(false);

    editor.destroy();
  });

  it('includes tools param as comma-joined list', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({
      publicKey: 'giga_pub_test',
      container,
      tools: ['text', 'image'],
    });
    const iframe = await waitForIframe(container);
    const url = new URL(iframe.src);

    expect(url.searchParams.get('tools')).toBe('text,image');

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// Iframe style / dimensions
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — iframe dimensions', () => {
  it('applies width and height to iframe when given as strings', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({
      publicKey: 'giga_pub_test',
      container,
      width: '800px',
      height: '400px',
    });
    const iframe = await waitForIframe(container);

    expect(iframe.style.width).toBe('800px');
    expect(iframe.style.height).toBe('400px');

    editor.destroy();
  });

  it('converts numeric width and height to pixel strings', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({
      publicKey: 'giga_pub_test',
      container,
      width: 1024,
      height: 768,
    });
    const iframe = await waitForIframe(container);

    expect(iframe.style.width).toBe('1024px');
    expect(iframe.style.height).toBe('768px');

    editor.destroy();
  });

  it('applies default width (100%) and height (600px) when not specified', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const iframe = await waitForIframe(container);

    expect(iframe.style.width).toBe('100%');
    expect(iframe.style.height).toBe('600px');

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// DOM integration
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — DOM integration', () => {
  it('creates an iframe element inside the container after token fetch', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });

    const iframe = await waitForIframe(container);
    expect(iframe).not.toBeNull();

    editor.destroy();
  });

  it('sets data-gigapdf attribute on the iframe', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const iframe = await waitForIframe(container);

    expect(iframe.getAttribute('data-gigapdf')).toBe('true');

    editor.destroy();
  });

  it('resolves container from a CSS selector string', async () => {
    // #editor is already in the DOM via beforeEach
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container: '#editor' });
    const target = document.querySelector<HTMLElement>('#editor')!;

    await waitForIframe(target);
    expect(target.querySelector('iframe')).not.toBeNull();

    editor.destroy();
  });

  it('throws synchronously when container CSS selector is not found in DOM', () => {
    // Container resolution is synchronous — no token fetch occurs
    expect(() => {
      new GigaPdfEditor({ publicKey: 'giga_pub_test', container: '#nonexistent' });
    }).toThrow('[GigaPdf] Container not found: "#nonexistent"');
  });
});

// ---------------------------------------------------------------------------
// Event system — on / off
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — on / off', () => {
  it('registers a handler and invokes it when the matching event arrives', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' });

    expect(readyCb).toHaveBeenCalledOnce();

    editor.destroy();
  });

  it('unregisters a handler so it is no longer called after off()', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);
    editor.off('ready', readyCb);

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' });

    expect(readyCb).not.toHaveBeenCalled();

    editor.destroy();
  });

  it('supports multiple handlers for the same event', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    editor.on('ready', cb1);
    editor.on('ready', cb2);

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' });

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();

    editor.destroy();
  });

  it('off() removes only the specified handler, not others', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    editor.on('ready', cb1);
    editor.on('ready', cb2);
    editor.off('ready', cb1);

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' });

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();

    editor.destroy();
  });

  it('on() is chainable — returns the editor instance', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });

    const returned = editor.on('ready', vi.fn());

    expect(returned).toBe(editor);

    editor.destroy();
  });

  it('off() is chainable — returns the editor instance', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const cb = vi.fn();
    editor.on('ready', cb);

    const returned = editor.off('ready', cb);

    expect(returned).toBe(editor);

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — event payloads', () => {
  it('forwards save event payload to registered handler', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const saveCb = vi.fn();
    editor.on('save', saveCb);

    const payload = { documentId: 'doc-1', pageCount: 5 };
    dispatchInboundMessage({ type: 'gigapdf:event', event: 'save', data: payload });

    expect(saveCb).toHaveBeenCalledWith(payload);

    editor.destroy();
  });

  it('forwards export event payload to registered handler', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const exportCb = vi.fn();
    editor.on('export', exportCb);

    const payload = { blob: new Blob(['%PDF']), format: 'pdf' };
    dispatchInboundMessage({ type: 'gigapdf:event', event: 'export', data: payload });

    expect(exportCb).toHaveBeenCalledWith(payload);

    editor.destroy();
  });

  it('forwards error event payload to registered handler', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const errorCb = vi.fn();
    editor.on('error', errorCb);

    const payload = { code: 'LOAD_FAILED', message: 'Could not load document' };
    dispatchInboundMessage({ type: 'gigapdf:event', event: 'error', data: payload });

    expect(errorCb).toHaveBeenCalledWith(payload);

    editor.destroy();
  });

  it('forwards pageChange event payload to registered handler', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const pageChangeCb = vi.fn();
    editor.on('pageChange', pageChangeCb);

    const payload = { page: 3, total: 10 };
    dispatchInboundMessage({ type: 'gigapdf:event', event: 'pageChange', data: payload });

    expect(pageChangeCb).toHaveBeenCalledWith(payload);

    editor.destroy();
  });

  it('handles ready event from iframe — callback receives no arguments', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' });

    expect(readyCb).toHaveBeenCalledOnce();
    expect(readyCb).toHaveBeenCalledWith();

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// Security: origin filtering
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — origin security', () => {
  it('ignores messages from a wrong origin', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' }, 'https://evil.com');

    expect(readyCb).not.toHaveBeenCalled();

    editor.destroy();
  });

  it('accepts messages from the correct default origin (https://giga-pdf.com)', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' }, 'https://giga-pdf.com');

    expect(readyCb).toHaveBeenCalledOnce();

    editor.destroy();
  });

  it('accepts messages from the allowed custom baseUrl origin', async () => {
    // The beforeEach fetch mock already handles any URL — no override needed.
    const container = makeContainer();
    const editor = new GigaPdfEditor({
      publicKey: 'giga_pub_test',
      container,
      baseUrl: 'https://custom.example.com',
    });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);

    await waitForIframe(container);
    dispatchInboundMessage(
      { type: 'gigapdf:event', event: 'ready' },
      'https://custom.example.com',
    );

    expect(readyCb).toHaveBeenCalledOnce();

    editor.destroy();
  });

  it('ignores messages with unknown type (not gigapdf:event)', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);

    const event = new MessageEvent('message', {
      data: { type: 'other:event', event: 'ready' },
      origin: 'https://giga-pdf.com',
    });
    window.dispatchEvent(event);

    expect(readyCb).not.toHaveBeenCalled();

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — destroy()', () => {
  it('removes the iframe from the DOM', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    await waitForIframe(container);

    expect(container.querySelector('iframe')).not.toBeNull();

    editor.destroy();

    expect(container.querySelector('iframe')).toBeNull();
  });

  it('removes the window message listener so events are no longer dispatched', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);

    await waitForIframe(container);
    editor.destroy();
    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' });

    expect(readyCb).not.toHaveBeenCalled();
  });

  it('on() after destroy is a no-op — returns this without registering', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const readyCb = vi.fn();
    editor.destroy();

    expect(() => editor.on('ready', readyCb)).not.toThrow();

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' });
    expect(readyCb).not.toHaveBeenCalled();
  });

  it('calling destroy() twice does not throw', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    editor.destroy();

    expect(() => editor.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Methods no-op after destroy
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — methods after destroy()', () => {
  it('on() returns the instance but does not register after destroy', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    editor.destroy();

    const cb = vi.fn();
    const returned = editor.on('ready', cb);

    expect(returned).toBe(editor);

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('exportPdf() is a no-op after destroy — does not throw', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    editor.destroy();

    expect(() => editor.exportPdf()).not.toThrow();
  });

  it('savePdf() is a no-op after destroy — does not throw', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    editor.destroy();

    expect(() => editor.savePdf()).not.toThrow();
  });

  it('loadDocument() is a no-op after destroy — does not throw', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    editor.destroy();

    expect(() => editor.loadDocument('doc-99')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// postCommand / postMessage
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — postCommand sends message to iframe', () => {
  it('exportPdf() calls contentWindow.postMessage with action "export"', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const iframe = await waitForIframe(container);
    const postMessageMock = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: postMessageMock },
      writable: true,
    });

    editor.exportPdf('pdf');

    expect(postMessageMock).toHaveBeenCalledOnce();
    const [msg, targetOrigin] = postMessageMock.mock.calls[0] as [unknown, string];
    expect(msg).toMatchObject({ type: 'gigapdf:command', action: 'export' });
    expect(targetOrigin).toBe('https://giga-pdf.com');

    editor.destroy();
  });

  it('savePdf() calls contentWindow.postMessage with action "save"', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const iframe = await waitForIframe(container);
    const postMessageMock = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: postMessageMock },
      writable: true,
    });

    editor.savePdf();

    expect(postMessageMock).toHaveBeenCalledOnce();
    const [msg] = postMessageMock.mock.calls[0] as [unknown];
    expect(msg).toMatchObject({ type: 'gigapdf:command', action: 'save' });

    editor.destroy();
  });

  it('loadDocument() calls contentWindow.postMessage with action "load" and documentId payload', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const iframe = await waitForIframe(container);
    const postMessageMock = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: postMessageMock },
      writable: true,
    });

    editor.loadDocument('my-doc');

    expect(postMessageMock).toHaveBeenCalledOnce();
    const [msg] = postMessageMock.mock.calls[0] as [unknown];
    expect(msg).toMatchObject({
      type: 'gigapdf:command',
      action: 'load',
      payload: { documentId: 'my-doc' },
    });

    editor.destroy();
  });

  it('does not call postMessage when contentWindow is null', async () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_test', container });
    const iframe = await waitForIframe(container);
    Object.defineProperty(iframe, 'contentWindow', { value: null, writable: true });

    expect(() => editor.exportPdf()).not.toThrow();

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// GigaPdf namespace
// ---------------------------------------------------------------------------

describe('GigaPdf.init', () => {
  it('creates and returns a GigaPdfEditor instance', () => {
    const container = makeContainer();
    const editor = GigaPdf.init({ publicKey: 'giga_pub_test', container });

    expect(editor).toBeInstanceOf(GigaPdfEditor);

    editor.destroy();
  });

  it('the returned editor eventually mounts an iframe in the container', async () => {
    const container = makeContainer();
    const editor = GigaPdf.init({ publicKey: 'giga_pub_test', container });

    const iframe = await waitForIframe(container);
    expect(iframe).not.toBeNull();

    editor.destroy();
  });

  it('two consecutive init() calls produce independent editors', async () => {
    const c1 = makeContainer();
    const c2 = makeContainer();

    const e1 = GigaPdf.init({ publicKey: 'giga_pub_key1', container: c1 });
    const e2 = GigaPdf.init({ publicKey: 'giga_pub_key2', container: c2 });

    expect(e1).not.toBe(e2);
    await Promise.all([waitForIframe(c1), waitForIframe(c2)]);
    expect(c1.querySelector('iframe')).not.toBeNull();
    expect(c2.querySelector('iframe')).not.toBeNull();

    e1.destroy();
    e2.destroy();
  });
});

// ---------------------------------------------------------------------------
// Key validation — isPublishableKey + validatePublicKey behaviour
// ---------------------------------------------------------------------------

describe('isPublishableKey', () => {
  it('returns true for giga_pub_* keys', () => {
    expect(isPublishableKey('giga_pub_abc123')).toBe(true);
  });

  it('returns false for giga_pk_* (secret) keys', () => {
    expect(isPublishableKey('giga_pk_abc123')).toBe(false);
  });

  it('returns false for arbitrary strings', () => {
    expect(isPublishableKey('somekey')).toBe(false);
    expect(isPublishableKey('')).toBe(false);
  });
});

describe('GigaPdfEditor — key validation', () => {
  it('accepts a valid publishable key without warning', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'giga_pub_valid', container });

    expect(warnSpy).not.toHaveBeenCalled();

    editor.destroy();
  });

  it('throws synchronously when a secret key (giga_pk_*) is used', () => {
    const container = makeContainer();

    expect(() => {
      new GigaPdfEditor({ publicKey: 'giga_pk_secret123', container });
    }).toThrow('[GigaPdf] Do not use secret keys (giga_pk_*) in client-side code.');
  });

  it('warns when key format is unrecognised (not giga_pub_*)', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    const container = makeContainer();
    const editor = new GigaPdfEditor({ publicKey: 'unknown_key_format', container });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid key format'),
    );

    editor.destroy();
  });
});
