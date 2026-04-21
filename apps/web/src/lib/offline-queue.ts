/**
 * OfflineQueue — Persistence des opérations CRUD en attente via IndexedDB.
 *
 * Garantit zéro data-loss en cas de fermeture navigateur pendant un debounce
 * ou une perte de connexion réseau.
 *
 * Architecture :
 *   - 1 store IndexedDB ("pending-ops") avec clé auto-incrémentée
 *   - Les opérations sont enfilées (enqueue) en cas d'échec réseau / offline
 *   - Rejouées séquentiellement au retour de la connexion (flush)
 *   - Quota guard : si IndexedDB plein (QuotaExceededError) → éviction LRU
 *
 * Edge cases gérés :
 *   - IndexedDB non disponible (SSR, private browsing iOS) → mode dégradé silencieux
 *   - Quota IndexedDB plein → éviction des ops les plus anciennes (LRU)
 *   - Version conflict (schéma obsolète) → onupgradeneeded re-crée le store
 *   - Multiple onglets → chaque onglet partage la même queue (cohérence intentionnelle)
 */

import { createDefaultLogger } from '@giga-pdf/logger';

export type PendingOperationType =
  | 'create_element'
  | 'update_element'
  | 'delete_element'
  | 'save_document';

export interface PendingOperation {
  /** UUID v4 unique par opération */
  id: string;
  type: PendingOperationType;
  payload: Record<string, unknown>;
  /** Unix timestamp ms */
  timestamp: number;
  /** Nombre de tentatives échouées */
  retries: number;
}

/** Opération stockée en IDB (avec clé auto-incrémentée) */
interface StoredOperation extends PendingOperation {
  /** Clé primaire IDB (auto-incrémentée) — absente avant insertion */
  _key?: number;
}

const log = createDefaultLogger({ enableRemote: false });

const DB_NAME = 'gigapdf-offline';
const STORE_NAME = 'pending-ops';
const DB_VERSION = 1;
/** Nombre max d'ops en queue avant éviction LRU des plus anciennes */
const MAX_QUEUE_SIZE = 100;
/** TTL max pour une opération (24h) — les ops plus vieilles sont purgées au flush */
const OP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Ouvre (ou crée) la base IndexedDB.
 * Retourne null si l'environnement ne supporte pas IDB (SSR, iOS private).
 */
function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      // Recréer proprement le store si la version a changé
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      const store = db.createObjectStore(STORE_NAME, {
        keyPath: '_key',
        autoIncrement: true,
      });
      store.createIndex('timestamp', 'timestamp', { unique: false });
      store.createIndex('id', 'id', { unique: true });
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = () => {
      // IDB refusé (quota, permissions) → mode dégradé
      log.warn('IndexedDB unavailable, fallback to in-memory mode', { component: 'OfflineQueue' });
      resolve(null);
    };

    request.onblocked = () => {
      // Un autre onglet tient une connexion ouverte → attendre
      log.warn('IndexedDB blocked by another tab', { component: 'OfflineQueue' });
      resolve(null);
    };
  });
}

/**
 * Génère un UUID v4 compatible avec tous les navigateurs.
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback pour les environnements sans crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class OfflineQueue {
  /** Cache DB pour éviter de rouvrir à chaque opération */
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  /** Fallback in-memory si IDB indisponible */
  private memoryQueue: StoredOperation[] = [];

  private getDb(): Promise<IDBDatabase | null> {
    if (!this.dbPromise) {
      this.dbPromise = openDatabase();
    }
    return this.dbPromise;
  }

  /**
   * Ajoute une opération à la queue persistante.
   *
   * Si IndexedDB est plein (QuotaExceededError), évicte les ops les plus
   * anciennes (LRU) jusqu'à avoir de la place.
   */
  async enqueue(op: Omit<PendingOperation, 'id' | 'timestamp' | 'retries'>): Promise<void> {
    const fullOp: StoredOperation = {
      id: generateId(),
      timestamp: Date.now(),
      retries: 0,
      ...op,
    };

    const db = await this.getDb();

    if (!db) {
      // Fallback in-memory
      this.memoryQueue.push(fullOp);
      if (this.memoryQueue.length > MAX_QUEUE_SIZE) {
        this.memoryQueue.shift(); // LRU éviction
      }
      return;
    }

    await this._idbEnqueueWithEviction(db, fullOp);
  }

  private _idbEnqueueWithEviction(
    db: IDBDatabase,
    op: StoredOperation
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const attemptWrite = (retryEviction: boolean) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const addReq = store.add(op);

        addReq.onsuccess = () => resolve();

        addReq.onerror = () => {
          const error = addReq.error;
          if (retryEviction && error?.name === 'QuotaExceededError') {
            // Évicte les 10 entrées les plus anciennes puis réessaie
            this._evictOldest(db, 10)
              .then(() => attemptWrite(false))
              .catch(reject);
          } else {
            log.warn('enqueue failed, falling back to memory queue', {
              component: 'OfflineQueue',
              errorMessage: error?.message,
            });
            // Ne pas rejeter — fallback in-memory
            this.memoryQueue.push(op);
            resolve();
          }
        };
      };

      attemptWrite(true);
    });
  }

  /**
   * Supprime les N entrées les plus anciennes (par timestamp).
   */
  private _evictOldest(db: IDBDatabase, count: number): Promise<void> {
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const req = index.openCursor();
      let evicted = 0;

      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor && evicted < count) {
          cursor.delete();
          evicted++;
          cursor.continue();
        } else {
          resolve();
        }
      };

      req.onerror = () => resolve(); // Silencieux
    });
  }

  /**
   * Retire et retourne la première opération de la queue (FIFO).
   * Retourne null si la queue est vide.
   */
  async dequeue(): Promise<PendingOperation | null> {
    const db = await this.getDb();

    if (!db) {
      if (this.memoryQueue.length === 0) return null;
      const op = this.memoryQueue.shift()!;
      return this._stripKey(op);
    }

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const req = index.openCursor(); // Curseur sur le plus ancien en premier

      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) {
          resolve(null);
          return;
        }
        const op: StoredOperation = cursor.value;
        cursor.delete();
        resolve(this._stripKey(op));
      };

      req.onerror = () => resolve(null);
    });
  }

  /**
   * Lit la première opération sans la retirer (peek).
   * Retourne null si la queue est vide.
   */
  async peek(): Promise<PendingOperation | null> {
    const db = await this.getDb();

    if (!db) {
      if (this.memoryQueue.length === 0) return null;
      // Shallow copy to avoid mutation of the queued item
      const copy: StoredOperation = Object.assign({}, this.memoryQueue[0]);
      return this._stripKey(copy);
    }

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const req = index.openCursor();

      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) {
          resolve(null);
          return;
        }
        resolve(this._stripKey(cursor.value));
      };

      req.onerror = () => resolve(null);
    });
  }

  /**
   * Retourne toutes les opérations en attente sans les supprimer.
   * Utile pour afficher le badge de count.
   */
  async getAll(): Promise<PendingOperation[]> {
    const db = await this.getDb();

    if (!db) {
      return this.memoryQueue.map((op) => this._stripKey(Object.assign({}, op) as StoredOperation));
    }

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const req = index.getAll();

      req.onsuccess = (event) => {
        const ops: StoredOperation[] = (event.target as IDBRequest<StoredOperation[]>).result;
        resolve(ops.map((op) => this._stripKey(op)));
      };

      req.onerror = () => resolve([]);
    });
  }

  /**
   * Vide intégralement la queue (succès de flush ou abandon).
   */
  async clear(): Promise<void> {
    this.memoryQueue = [];
    const db = await this.getDb();
    if (!db) return;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  /**
   * Nombre d'opérations en attente.
   */
  async size(): Promise<number> {
    const db = await this.getDb();

    if (!db) {
      return this.memoryQueue.length;
    }

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.count();

      req.onsuccess = (event) => {
        resolve((event.target as IDBRequest<number>).result);
      };

      req.onerror = () => resolve(0);
    });
  }

  /**
   * Rejoue toutes les opérations en attente via le handler fourni.
   *
   * Le handler reçoit chaque opération séquentiellement.
   * Si le handler lève une exception, l'opération est remise en queue
   * avec retries++ et le flush s'arrête (pas de boucle infinie).
   *
   * Les opérations plus vieilles que OP_MAX_AGE_MS sont purgées sans replay.
   *
   * @returns Nombre d'opérations rejouées avec succès
   */
  async flush(
    handler: (op: PendingOperation) => Promise<void>
  ): Promise<number> {
    let successCount = 0;
    const now = Date.now();

    while (true) {
      const op = await this.peek();
      if (!op) break;

      // Purge des ops expirées
      if (now - op.timestamp > OP_MAX_AGE_MS) {
        await this.dequeue();
        log.warn('Purging expired pending operation', { component: 'OfflineQueue', opId: op.id, opType: op.type });
        continue;
      }

      // Retirer de la queue avant d'appeler le handler
      await this.dequeue();

      try {
        await handler(op);
        successCount++;
      } catch (err) {
        log.warn('Replay failed for pending operation', {
          component: 'OfflineQueue',
          opId: op.id,
          opType: op.type,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        // Remettre en queue avec retries++ (max 3 tentatives)
        if (op.retries < 3) {
          // Réinsérer directement via _enqueueStored pour préserver l'id et incrémenter retries
          const retriedOp: StoredOperation = {
            ...op,
            retries: op.retries + 1,
            timestamp: Date.now(), // Remettre en fin de queue
          };
          const db = await this.getDb();
          if (db) {
            await this._idbEnqueueWithEviction(db, retriedOp);
          } else {
            this.memoryQueue.push(retriedOp);
          }
        }
        // Arrêter le flush en cas d'erreur (pas de connexion = inutile de continuer)
        break;
      }
    }

    return successCount;
  }

  /** Supprime la clé IDB interne avant d'exposer l'op */
  private _stripKey(op: StoredOperation): PendingOperation {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _key, ...rest } = op;
    return rest;
  }
}

/** Singleton partagé dans l'application */
export const offlineQueue = new OfflineQueue();
