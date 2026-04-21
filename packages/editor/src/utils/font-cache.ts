/**
 * IndexedDB-backed cache for extracted PDF fonts.
 *
 * Design goals:
 * - Avoid re-downloading the same font across browser sessions.
 * - TTL: 7 days by default (configurable per entry).
 * - Size cap: evict oldest entries (LRU-by-access-time) when total exceeds MAX_TOTAL_BYTES.
 * - No dependency on the `idb` library — uses the native IndexedDB API wrapped with Promises.
 * - Safe to instantiate in SSR contexts: all operations that touch the DB are no-ops when
 *   `window` / `indexedDB` is unavailable.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const DB_NAME = 'gigapdf-fonts';
const DB_VERSION = 1;
const STORE_NAME = 'fonts';

/** Default TTL: 7 days in milliseconds */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Evict oldest entries when total cache size exceeds 50 MB */
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

// ─── Internal Types ───────────────────────────────────────────────────────────

interface CacheEntry {
  /** Composite key: `${documentId}:${fontId}` */
  key: string;
  data: ArrayBuffer;
  /** Unix timestamp (ms) when this entry expires */
  expiresAt: number;
  /** Unix timestamp (ms) of last access — used for LRU eviction */
  lastAccessedAt: number;
  /** Byte size of `data` (pre-computed for fast eviction decisions) */
  sizeBytes: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isIdbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function buildKey(documentId: string, fontId: string): string {
  return `${documentId}:${fontId}`;
}

// ─── FontCache ────────────────────────────────────────────────────────────────

/**
 * Singleton-friendly cache backed by IndexedDB.
 * Create one instance per app (or per editor session) and reuse it.
 *
 * @example
 * ```ts
 * const fontCache = new FontCache();
 * const buffer = await fontCache.get('doc123', 'font456');
 * if (!buffer) {
 *   const downloaded = await downloadFontBuffer();
 *   await fontCache.set('doc123', 'font456', downloaded);
 * }
 * ```
 */
export class FontCache {
  private readonly dbName: string;
  private readonly storeName: string;
  /** Lazily opened DB connection */
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: { dbName?: string; storeName?: string } = {}) {
    this.dbName = options.dbName ?? DB_NAME;
    this.storeName = options.storeName ?? STORE_NAME;
  }

  // ── Private DB lifecycle ────────────────────────────────────────────────────

  private openDb(): Promise<IDBDatabase> {
    if (!isIdbAvailable()) {
      return Promise.reject(new Error('IndexedDB is not available in this environment'));
    }
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(this.dbName, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
          store.createIndex('expiresAt', 'expiresAt', { unique: false });
          store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.dbPromise = null;
        reject(new Error(`Failed to open IndexedDB "${this.dbName}": ${request.error?.message}`));
      };
    });

    return this.dbPromise;
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.openDb();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode);
      const store = tx.objectStore(this.storeName);
      const request = fn(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`IDB operation failed: ${request.error?.message}`));
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Retrieve a cached font buffer.
   * Returns `null` when the entry is absent or expired.
   * Bumps `lastAccessedAt` on hit (LRU semantics).
   */
  async get(documentId: string, fontId: string): Promise<ArrayBuffer | null> {
    if (!isIdbAvailable()) return null;

    const key = buildKey(documentId, fontId);
    let entry: CacheEntry | undefined;

    try {
      entry = await this.withStore<CacheEntry | undefined>('readonly', (store) =>
        store.get(key) as IDBRequest<CacheEntry | undefined>,
      );
    } catch {
      // IDB read failure is non-fatal — treat as cache miss
      return null;
    }

    if (!entry) return null;

    // Check TTL
    if (Date.now() > entry.expiresAt) {
      // Evict this stale entry asynchronously (fire-and-forget)
      this.delete(documentId, fontId).catch(() => {});
      return null;
    }

    // Update LRU access time asynchronously
    const updated: CacheEntry = { ...entry, lastAccessedAt: Date.now() };
    this.withStore('readwrite', (store) => store.put(updated) as IDBRequest<IDBValidKey>).catch(
      () => {},
    );

    return entry.data;
  }

  /**
   * Store a font buffer in the cache.
   * Runs expired-entry eviction and LRU eviction (if over MAX_TOTAL_BYTES) after writing.
   */
  async set(
    documentId: string,
    fontId: string,
    data: ArrayBuffer,
    ttlMs: number = DEFAULT_TTL_MS,
  ): Promise<void> {
    if (!isIdbAvailable()) return;

    const key = buildKey(documentId, fontId);
    const now = Date.now();
    const entry: CacheEntry = {
      key,
      data,
      expiresAt: now + ttlMs,
      lastAccessedAt: now,
      sizeBytes: data.byteLength,
    };

    try {
      await this.withStore('readwrite', (store) => store.put(entry) as IDBRequest<IDBValidKey>);
    } catch {
      // Write failure is non-fatal
      return;
    }

    // Run evictions asynchronously so we don't block font loading
    this.evictExpired().catch(() => {});
    this.evictBySize().catch(() => {});
  }

  /**
   * Check whether a non-expired entry exists for the given document/font pair.
   */
  async has(documentId: string, fontId: string): Promise<boolean> {
    const buffer = await this.get(documentId, fontId);
    return buffer !== null;
  }

  /**
   * Delete a single cache entry.
   */
  async delete(documentId: string, fontId: string): Promise<void> {
    if (!isIdbAvailable()) return;
    const key = buildKey(documentId, fontId);
    try {
      await this.withStore('readwrite', (store) => store.delete(key) as IDBRequest<undefined>);
    } catch {
      // Ignore
    }
  }

  /**
   * Remove all entries whose TTL has expired.
   */
  async evictExpired(): Promise<void> {
    if (!isIdbAvailable()) return;

    const db = await this.openDb().catch(() => null);
    if (!db) return;

    const expiredKeys = await new Promise<string[]>((resolve) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const index = store.index('expiresAt');
      const range = IDBKeyRange.upperBound(Date.now());
      const keys: string[] = [];
      const req = index.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null;
        if (cursor) {
          keys.push((cursor.value as CacheEntry).key);
          cursor.continue();
        } else {
          resolve(keys);
        }
      };
      req.onerror = () => resolve([]);
    });

    if (expiredKeys.length === 0) return;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      for (const key of expiredKeys) {
        store.delete(key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  /**
   * Evict least-recently-used entries until total cache size is below MAX_TOTAL_BYTES.
   */
  private async evictBySize(): Promise<void> {
    if (!isIdbAvailable()) return;

    const db = await this.openDb().catch(() => null);
    if (!db) return;

    // Read all entries sorted by lastAccessedAt ascending (oldest first)
    const entries = await new Promise<CacheEntry[]>((resolve) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const index = store.index('lastAccessedAt');
      const all: CacheEntry[] = [];
      const req = index.openCursor();
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null;
        if (cursor) {
          all.push(cursor.value as CacheEntry);
          cursor.continue();
        } else {
          resolve(all);
        }
      };
      req.onerror = () => resolve([]);
    });

    const total = entries.reduce((acc, e) => acc + e.sizeBytes, 0);
    if (total <= MAX_TOTAL_BYTES) return;

    // Evict oldest entries until we are under the cap
    let freed = 0;
    const toEvict: string[] = [];
    for (const entry of entries) {
      toEvict.push(entry.key);
      freed += entry.sizeBytes;
      if (total - freed <= MAX_TOTAL_BYTES) break;
    }

    await new Promise<void>((resolve) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      for (const key of toEvict) {
        store.delete(key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  /**
   * Remove all entries from the cache (for testing or forced refresh).
   */
  async clear(): Promise<void> {
    if (!isIdbAvailable()) return;
    try {
      await this.withStore('readwrite', (store) => store.clear() as IDBRequest<undefined>);
    } catch {
      // Ignore
    }
  }
}

/** Shared default instance reused across the editor session. */
export const defaultFontCache = new FontCache();
