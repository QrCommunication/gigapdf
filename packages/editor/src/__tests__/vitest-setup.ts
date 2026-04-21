/**
 * Global test setup for @giga-pdf/editor
 *
 * Polyfills and global mocks that must be in place before every test file runs.
 */

import { vi } from 'vitest';

// ─── URL.createObjectURL / revokeObjectURL mock ───────────────────────────────
// jsdom does not implement these APIs — stub them directly on the URL object.
let blobUrlCounter = 0;
if (!URL.createObjectURL) {
  URL.createObjectURL = (_blob: Blob | MediaSource) => `blob:test-${++blobUrlCounter}`;
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = (_url: string) => { /* no-op */ };
}

// ─── FontFace API mock ────────────────────────────────────────────────────────
// jsdom does not implement FontFace. We provide a minimal mock that always
// succeeds on .load() so the hook's font loading path completes successfully.

class MockFontFace {
  family: string;
  source: string | ArrayBuffer;
  status: string = 'unloaded';

  constructor(family: string, source: string | ArrayBuffer) {
    this.family = family;
    this.source = source;
  }

  load(): Promise<MockFontFace> {
    this.status = 'loaded';
    return Promise.resolve(this);
  }
}

// Install globally so `new FontFace(...)` works in tests
global.FontFace = MockFontFace as unknown as typeof FontFace;

// Mock document.fonts with a Set-like interface.
// Exported so individual tests can inspect registered fonts.
interface MockFontFaceSet {
  _fonts: Set<FontFace>;
  add(font: FontFace): MockFontFaceSet;
  delete(font: FontFace): boolean;
  has(font: FontFace): boolean;
  clear(): void;
  readonly size: number;
}

const fontFaceSet: MockFontFaceSet = {
  _fonts: new Set<FontFace>(),
  add(font: FontFace): MockFontFaceSet { this._fonts.add(font); return this; },
  delete(font: FontFace): boolean { return this._fonts.delete(font); },
  has(font: FontFace): boolean { return this._fonts.has(font); },
  clear(): void { this._fonts.clear(); },
  get size(): number { return this._fonts.size; },
};

// jsdom may or may not define document.fonts — override regardless
try {
  Object.defineProperty(document, 'fonts', {
    value: fontFaceSet,
    writable: true,
    configurable: true,
  });
} catch {
  // Property already defined non-configurable — assign directly
  (document as { fonts: unknown }).fonts = fontFaceSet;
}

// ─── IndexedDB mock ───────────────────────────────────────────────────────────
// Minimal in-memory IDB mock for FontCache tests.

interface IdbStore {
  [key: string]: unknown;
}

const idbStore: IdbStore = {};
const idbIndexes: Record<string, { keyPath: string }> = {};

function makeRequest<T>(result: T, error?: Error): IDBRequest<T> {
  const listeners: Record<string, ((e: Event) => void)[]> = {};
  const req = {
    result,
    error: error ?? null,
    onsuccess: null as ((e: Event) => void) | null,
    onerror: null as ((e: Event) => void) | null,
    addEventListener(type: string, fn: (e: Event) => void) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
  };
  // Trigger callbacks asynchronously (microtask)
  Promise.resolve().then(() => {
    if (error) {
      if (req.onerror) req.onerror({} as Event);
    } else {
      if (req.onsuccess) req.onsuccess({} as Event);
    }
  });
  return req as unknown as IDBRequest<T>;
}

function makeCursor(entries: unknown[]): IDBRequest<IDBCursorWithValue | null> {
  let index = 0;
  const req = {
    result: null as IDBCursorWithValue | null,
    error: null,
    onsuccess: null as ((e: Event) => void) | null,
    onerror: null as ((e: Event) => void) | null,
  };

  function advance() {
    if (index < entries.length) {
      req.result = {
        value: entries[index],
        continue() {
          index++;
          Promise.resolve().then(advance);
        },
      } as unknown as IDBCursorWithValue;
    } else {
      req.result = null;
    }
    if (req.onsuccess) req.onsuccess({} as Event);
  }

  Promise.resolve().then(advance);
  return req as unknown as IDBRequest<IDBCursorWithValue | null>;
}

const mockObjectStore = {
  get: (key: string) => makeRequest(idbStore[key] as unknown),
  put: (value: unknown) => {
    const v = value as { key: string };
    idbStore[v.key] = value;
    return makeRequest(v.key as unknown);
  },
  delete: (key: string) => {
    delete idbStore[key];
    return makeRequest(undefined as unknown);
  },
  clear: () => {
    for (const k of Object.keys(idbStore)) delete idbStore[k];
    return makeRequest(undefined as unknown);
  },
  createIndex: (name: string, keyPath: string) => {
    idbIndexes[name] = { keyPath };
    return mockIndex;
  },
  index: (_name: string) => mockIndex,
};

const mockIndex = {
  openCursor: (_range?: IDBKeyRange) => {
    // Simplified — tests that need range filtering mock this explicitly
    const entries = Object.values(idbStore);
    return makeCursor(entries);
  },
};

const mockTransaction = {
  objectStore: (_name: string) => mockObjectStore,
  oncomplete: null as (() => void) | null,
  onerror: null as (() => void) | null,
};

// Trigger oncomplete after a microtask
Promise.resolve().then(() => {
  if (mockTransaction.oncomplete) mockTransaction.oncomplete();
});

const mockDb = {
  transaction: (_stores: string, _mode: string) => {
    // Reset oncomplete so the new transaction can be tracked
    const tx = { ...mockTransaction, oncomplete: null as (() => void) | null };
    Promise.resolve().then(() => {
      if (tx.oncomplete) tx.oncomplete();
    });
    return tx as unknown as IDBTransaction;
  },
  objectStoreNames: {
    contains: (_name: string) => false,
  },
  createObjectStore: (_name: string) => mockObjectStore,
};

const mockOpenRequest = {
  result: mockDb,
  error: null,
  onsuccess: null as ((e: Event) => void) | null,
  onerror: null as ((e: Event) => void) | null,
  onupgradeneeded: null as ((e: IDBVersionChangeEvent) => void) | null,
};

vi.stubGlobal('indexedDB', {
  open: (_name: string, _version: number) => {
    // Trigger onupgradeneeded then onsuccess
    Promise.resolve().then(() => {
      if (mockOpenRequest.onupgradeneeded) {
        mockOpenRequest.onupgradeneeded({
          target: mockOpenRequest,
        } as unknown as IDBVersionChangeEvent);
      }
      if (mockOpenRequest.onsuccess) {
        mockOpenRequest.onsuccess({} as Event);
      }
    });
    return mockOpenRequest as unknown as IDBOpenDBRequest;
  },
});

// Export internal mock for tests that need direct access
export { idbStore, mockObjectStore, fontFaceSet };
