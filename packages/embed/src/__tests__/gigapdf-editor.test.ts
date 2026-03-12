import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GigaPdfEditor, GigaPdf } from '../index';
import type { GigaPdfInboundMessage } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
});

afterEach(() => {
  // Remove all children added during the test
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — URL construction', () => {
  it('builds correct embed URL with apiKey', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'my-key', container });
    const iframe = container.querySelector('iframe')!;
    const url = new URL(iframe.src);

    expect(url.searchParams.get('apiKey')).toBe('my-key');

    editor.destroy();
  });

  it('builds URL with documentId — path is /embed/{documentId}', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container, documentId: 'doc-123' });
    const iframe = container.querySelector('iframe')!;
    const url = new URL(iframe.src);

    expect(url.pathname).toBe('/embed/doc-123');

    editor.destroy();
  });

  it('builds URL without documentId — path is /embed', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const iframe = container.querySelector('iframe')!;
    const url = new URL(iframe.src);

    expect(url.pathname).toBe('/embed');

    editor.destroy();
  });

  it('uses a custom baseUrl', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({
      apiKey: 'k',
      container,
      baseUrl: 'https://custom.example.com',
    });
    const iframe = container.querySelector('iframe')!;

    expect(iframe.src).toMatch(/^https:\/\/custom\.example\.com/);

    editor.destroy();
  });

  it('strips a trailing slash from baseUrl', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({
      apiKey: 'k',
      container,
      baseUrl: 'https://custom.example.com/',
    });
    const iframe = container.querySelector('iframe')!;
    const url = new URL(iframe.src);

    expect(url.origin).toBe('https://custom.example.com');

    editor.destroy();
  });

  it('includes locale param when provided', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container, locale: 'en' });
    const iframe = container.querySelector('iframe')!;
    const url = new URL(iframe.src);

    expect(url.searchParams.get('locale')).toBe('en');

    editor.destroy();
  });

  it('includes theme param when provided', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container, theme: 'dark' });
    const iframe = container.querySelector('iframe')!;
    const url = new URL(iframe.src);

    expect(url.searchParams.get('theme')).toBe('dark');

    editor.destroy();
  });

  it('includes hideToolbar param when true', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container, hideToolbar: true });
    const iframe = container.querySelector('iframe')!;
    const url = new URL(iframe.src);

    expect(url.searchParams.get('hideToolbar')).toBe('true');

    editor.destroy();
  });

  it('does not include hideToolbar param when false', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container, hideToolbar: false });
    const iframe = container.querySelector('iframe')!;
    const url = new URL(iframe.src);

    expect(url.searchParams.has('hideToolbar')).toBe(false);

    editor.destroy();
  });

  it('includes tools param as comma-joined list', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({
      apiKey: 'k',
      container,
      tools: ['text', 'image'],
    });
    const iframe = container.querySelector('iframe')!;
    const url = new URL(iframe.src);

    expect(url.searchParams.get('tools')).toBe('text,image');

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// Iframe style / dimensions
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — iframe dimensions', () => {
  it('applies width and height to iframe when given as strings', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({
      apiKey: 'k',
      container,
      width: '800px',
      height: '400px',
    });
    const iframe = container.querySelector('iframe')!;

    expect(iframe.style.width).toBe('800px');
    expect(iframe.style.height).toBe('400px');

    editor.destroy();
  });

  it('converts numeric width and height to pixel strings', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({
      apiKey: 'k',
      container,
      width: 1024,
      height: 768,
    });
    const iframe = container.querySelector('iframe')!;

    expect(iframe.style.width).toBe('1024px');
    expect(iframe.style.height).toBe('768px');

    editor.destroy();
  });

  it('applies default width (100%) and height (600px) when not specified', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const iframe = container.querySelector('iframe')!;

    expect(iframe.style.width).toBe('100%');
    expect(iframe.style.height).toBe('600px');

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// DOM integration
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — DOM integration', () => {
  it('creates an iframe element inside the container', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });

    expect(container.querySelector('iframe')).not.toBeNull();

    editor.destroy();
  });

  it('sets data-gigapdf attribute on the iframe', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const iframe = container.querySelector('iframe')!;

    expect(iframe.getAttribute('data-gigapdf')).toBe('true');

    editor.destroy();
  });

  it('resolves container from a CSS selector string', () => {
    // #editor is already in the DOM via beforeEach
    const editor = new GigaPdfEditor({ apiKey: 'k', container: '#editor' });
    const target = document.querySelector('#editor')!;

    expect(target.querySelector('iframe')).not.toBeNull();

    editor.destroy();
  });

  it('throws when container CSS selector is not found in DOM', () => {
    expect(() => {
      new GigaPdfEditor({ apiKey: 'k', container: '#nonexistent' });
    }).toThrow('[GigaPdf] Container not found: "#nonexistent"');
  });
});

// ---------------------------------------------------------------------------
// Event system — on / off
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — on / off', () => {
  it('registers a handler and invokes it when the matching event arrives', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' });

    expect(readyCb).toHaveBeenCalledOnce();

    editor.destroy();
  });

  it('unregisters a handler so it is no longer called after off()', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);
    editor.off('ready', readyCb);

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' });

    expect(readyCb).not.toHaveBeenCalled();

    editor.destroy();
  });

  it('supports multiple handlers for the same event', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
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
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
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
    const editor = new GigaPdfEditor({ apiKey: 'k', container });

    const returned = editor.on('ready', vi.fn());

    expect(returned).toBe(editor);

    editor.destroy();
  });

  it('off() is chainable — returns the editor instance', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
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
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const saveCb = vi.fn();
    editor.on('save', saveCb);

    const payload = { documentId: 'doc-1', pageCount: 5 };
    dispatchInboundMessage({ type: 'gigapdf:event', event: 'save', data: payload });

    expect(saveCb).toHaveBeenCalledWith(payload);

    editor.destroy();
  });

  it('forwards export event payload to registered handler', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const exportCb = vi.fn();
    editor.on('export', exportCb);

    const payload = { blob: new Blob(['%PDF']), format: 'pdf' };
    dispatchInboundMessage({ type: 'gigapdf:event', event: 'export', data: payload });

    expect(exportCb).toHaveBeenCalledWith(payload);

    editor.destroy();
  });

  it('forwards error event payload to registered handler', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const errorCb = vi.fn();
    editor.on('error', errorCb);

    const payload = { code: 'LOAD_FAILED', message: 'Could not load document' };
    dispatchInboundMessage({ type: 'gigapdf:event', event: 'error', data: payload });

    expect(errorCb).toHaveBeenCalledWith(payload);

    editor.destroy();
  });

  it('forwards pageChange event payload to registered handler', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const pageChangeCb = vi.fn();
    editor.on('pageChange', pageChangeCb);

    const payload = { page: 3, total: 10 };
    dispatchInboundMessage({ type: 'gigapdf:event', event: 'pageChange', data: payload });

    expect(pageChangeCb).toHaveBeenCalledWith(payload);

    editor.destroy();
  });

  it('handles ready event from iframe — callback receives no arguments', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
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
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' }, 'https://evil.com');

    expect(readyCb).not.toHaveBeenCalled();

    editor.destroy();
  });

  it('accepts messages from the correct default origin (https://giga-pdf.com)', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' }, 'https://giga-pdf.com');

    expect(readyCb).toHaveBeenCalledOnce();

    editor.destroy();
  });

  it('accepts messages from the allowed custom baseUrl origin', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({
      apiKey: 'k',
      container,
      baseUrl: 'https://custom.example.com',
    });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);

    dispatchInboundMessage(
      { type: 'gigapdf:event', event: 'ready' },
      'https://custom.example.com',
    );

    expect(readyCb).toHaveBeenCalledOnce();

    editor.destroy();
  });

  it('ignores messages with unknown type (not gigapdf:event)', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
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
  it('removes the iframe from the DOM', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });

    expect(container.querySelector('iframe')).not.toBeNull();

    editor.destroy();

    expect(container.querySelector('iframe')).toBeNull();
  });

  it('removes the window message listener so events are no longer dispatched', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const readyCb = vi.fn();
    editor.on('ready', readyCb);

    editor.destroy();
    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' });

    expect(readyCb).not.toHaveBeenCalled();
  });

  it('on() after destroy is a no-op — returns this without registering', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const readyCb = vi.fn();
    editor.destroy();

    expect(() => editor.on('ready', readyCb)).not.toThrow();

    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' });
    expect(readyCb).not.toHaveBeenCalled();
  });

  it('calling destroy() twice does not throw', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
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
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    editor.destroy();

    const cb = vi.fn();
    const returned = editor.on('ready', cb);

    expect(returned).toBe(editor);

    // Handler must not fire
    dispatchInboundMessage({ type: 'gigapdf:event', event: 'ready' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('exportPdf() is a no-op after destroy — does not throw', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    editor.destroy();

    expect(() => editor.exportPdf()).not.toThrow();
  });

  it('savePdf() is a no-op after destroy — does not throw', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    editor.destroy();

    expect(() => editor.savePdf()).not.toThrow();
  });

  it('loadDocument() is a no-op after destroy — does not throw', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    editor.destroy();

    expect(() => editor.loadDocument('doc-99')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// postCommand / postMessage
// ---------------------------------------------------------------------------

describe('GigaPdfEditor — postCommand sends message to iframe', () => {
  it('exportPdf() calls contentWindow.postMessage with action "export"', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const iframe = container.querySelector('iframe')!;
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

  it('savePdf() calls contentWindow.postMessage with action "save"', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const iframe = container.querySelector('iframe')!;
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

  it('loadDocument() calls contentWindow.postMessage with action "load" and documentId payload', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const iframe = container.querySelector('iframe')!;
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

  it('does not call postMessage when contentWindow is null', () => {
    const container = makeContainer();
    const editor = new GigaPdfEditor({ apiKey: 'k', container });
    const iframe = container.querySelector('iframe')!;
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
    const editor = GigaPdf.init({ apiKey: 'k', container });

    expect(editor).toBeInstanceOf(GigaPdfEditor);

    editor.destroy();
  });

  it('the returned editor has an iframe in the container', () => {
    const container = makeContainer();
    const editor = GigaPdf.init({ apiKey: 'k', container });

    expect(container.querySelector('iframe')).not.toBeNull();

    editor.destroy();
  });

  it('two consecutive init() calls produce independent editors', () => {
    const c1 = makeContainer();
    const c2 = makeContainer();

    const e1 = GigaPdf.init({ apiKey: 'key1', container: c1 });
    const e2 = GigaPdf.init({ apiKey: 'key2', container: c2 });

    expect(e1).not.toBe(e2);
    expect(c1.querySelector('iframe')).not.toBeNull();
    expect(c2.querySelector('iframe')).not.toBeNull();

    e1.destroy();
    e2.destroy();
  });
});
