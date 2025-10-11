import type { CacheRepository, CacheStats, CacheValue, CacheKey } from './index';

type OpenDBResult = {
  db: IDBDatabase;
  version: number;
};

const DB_NAME = 'xt-cache';
const STORE = 'items';
const DB_VERSION = 1;

export class IndexedDbCacheRepository implements CacheRepository {
  private readonly maxBytes: number;
  private readonly ttl: number;
  private dbPromise: Promise<OpenDBResult> | null = null;

  constructor(options?: { maxBytes?: number; ttl?: number }) {
    this.maxBytes = options?.maxBytes ?? 10 * 1024 * 1024;
    this.ttl = options?.ttl ?? 1000 * 60 * 60 * 24;
  }

  private async open(): Promise<OpenDBResult> {
    if (this.dbPromise) return this.dbPromise;
    if (!('indexedDB' in globalThis)) {
      throw new Error('IndexedDB is not available in this environment');
    }

    this.dbPromise = new Promise<OpenDBResult>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('lastAccess', 'lastAccess');
          store.createIndex('timestamp', 'meta.timestamp');
        }
      };
      request.onsuccess = () => resolve({ db: request.result, version: request.result.version });
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  async get(key: CacheKey): Promise<CacheValue | undefined> {
    const { db } = await this.open();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const item = await promisifyRequest<CacheValue | undefined>(store.get(key));
    if (!item) return undefined;

    if (Date.now() - item.meta.timestamp > this.ttl) {
      void store.delete(key);
      return undefined;
    }

    item.lastAccess = Date.now();
    item.meta.hits += 1;
    await promisifyRequest(store.put(item));
    await tx.done?.catch?.(() => undefined);
    return item;
  }

  async set(item: CacheValue): Promise<void> {
    const { db } = await this.open();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const now = Date.now();
    const next: CacheValue = {
      ...item,
      lastAccess: now,
      meta: { ...item.meta, timestamp: item.meta.timestamp ?? now },
      size: item.size ?? new TextEncoder().encode(item.translated).byteLength
    };
    await promisifyRequest(store.put(next));
    await this.evictLRUUntilInternal(db, this.maxBytes);
    await tx.done?.catch?.(() => undefined);
  }

  async evictLRUUntil(bytesLimit: number): Promise<void> {
    const { db } = await this.open();
    await this.evictLRUUntilInternal(db, bytesLimit);
  }

  private async evictLRUUntilInternal(db: IDBDatabase, bytesLimit: number): Promise<void> {
    const total = await this.computeTotalBytes(db);
    if (total <= bytesLimit) return;

    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const index = store.index('lastAccess');

    let currentTotal = total;
    await iterateCursor(index.openCursor(), async (cursor) => {
      if (currentTotal <= bytesLimit) return 'break';
      const value = cursor.value as CacheValue;
      currentTotal -= value.size;
      await promisifyRequest(store.delete(value.key));
      return 'continue';
    });
    await tx.done?.catch?.(() => undefined);
  }

  async stats(): Promise<CacheStats> {
    const { db } = await this.open();
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const entries = await promisifyRequest<number>(store.count());
    const estimatedBytes = await this.computeTotalBytes(db);
    await tx.done?.catch?.(() => undefined);
    return { entries, estimatedBytes, hits: 0, misses: 0 };
  }

  private async computeTotalBytes(db: IDBDatabase): Promise<number> {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    let total = 0;
    await iterateCursor(store.openCursor(), async (cursor) => {
      total += (cursor.value as CacheValue).size;
      return 'continue';
    });
    await tx.done?.catch?.(() => undefined);
    return total;
  }
}

const promisifyRequest = <T = unknown>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

type CursorAction = 'continue' | 'break';

const iterateCursor = async (
  request: IDBRequest<IDBCursorWithValue | null>,
  fn: (cursor: IDBCursorWithValue) => Promise<CursorAction> | CursorAction
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    request.onsuccess = async () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      try {
        const action = await fn(cursor);
        if (action === 'break') return resolve();
        cursor.continue();
      } catch (e) {
        reject(e);
      }
    };
    request.onerror = () => reject(request.error);
  });

declare global {
  interface IDBTransaction {
    done?: Promise<void>;
  }
}

