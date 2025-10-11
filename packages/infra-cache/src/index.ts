export type CacheKey = string;

export type CacheMeta = {
  model: string;
  temperature: number;
  timestamp: number;
  hits: number;
};

export type CacheValue = {
  key: CacheKey;
  text: string;
  langPair: string;
  translated: string;
  meta: CacheMeta;
  lastAccess: number;
  size: number;
};

export type CacheStats = {
  entries: number;
  estimatedBytes: number;
  hits: number;
  misses: number;
};

export interface CacheRepository {
  get(key: CacheKey): Promise<CacheValue | undefined>;
  set(item: CacheValue): Promise<void>;
  evictLRUUntil(bytesLimit: number): Promise<void>;
  stats(): Promise<CacheStats>;
}

type MemoryCacheOptions = {
  maxBytes?: number;
  ttl?: number;
};

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TTL = 1000 * 60 * 60 * 24;

export class MemoryCacheRepository implements CacheRepository {
  private readonly items = new Map<CacheKey, CacheValue>();
  private readonly options: Required<MemoryCacheOptions>;
  private hits = 0;
  private misses = 0;

  constructor(options?: MemoryCacheOptions) {
    this.options = {
      maxBytes: options?.maxBytes ?? DEFAULT_MAX_BYTES,
      ttl: options?.ttl ?? DEFAULT_TTL
    };
  }

  async get(key: CacheKey): Promise<CacheValue | undefined> {
    const item = this.items.get(key);
    if (!item) {
      this.misses += 1;
      return undefined;
    }

    if (Date.now() - item.meta.timestamp > this.options.ttl) {
      this.items.delete(key);
      this.misses += 1;
      return undefined;
    }

    const updated: CacheValue = {
      ...item,
      meta: {
        ...item.meta,
        hits: item.meta.hits + 1,
        timestamp: item.meta.timestamp
      },
      lastAccess: Date.now()
    };
    this.items.set(key, updated);
    this.hits += 1;
    return updated;
  }

  async set(item: CacheValue): Promise<void> {
    const now = Date.now();
    this.items.set(item.key, {
      ...item,
      lastAccess: now,
      meta: {
        ...item.meta,
        timestamp: item.meta.timestamp ?? now
      },
      size: item.size ?? estimateBytes(item.translated)
    });
    await this.evictLRUUntil(this.options.maxBytes);
  }

  async evictLRUUntil(bytesLimit: number): Promise<void> {
    let total = this.computeTotalBytes();
    if (total <= bytesLimit) {
      return;
    }

    const sorted = Array.from(this.items.values()).sort(
      (a, b) => a.lastAccess - b.lastAccess
    );

    for (const item of sorted) {
      if (total <= bytesLimit) {
        break;
      }
      this.items.delete(item.key);
      total -= item.size;
    }
  }

  async stats(): Promise<CacheStats> {
    return {
      entries: this.items.size,
      estimatedBytes: this.computeTotalBytes(),
      hits: this.hits,
      misses: this.misses
    };
  }

  private computeTotalBytes(): number {
    let total = 0;
    this.items.forEach((item) => {
      total += item.size;
    });
    return total;
  }
}

export const estimateBytes = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

export const buildCacheKey = (langPair: { src: string; dst: string }, text: string): CacheKey => {
  const normalized = normalize(text);
  return `${langPair.src}:${langPair.dst}:${hash(normalized)}`;
};

const normalize = (value: string): string =>
  value
    .replace(/\r\n/g, '\n')
    .trim();

const hash = (value: string): string => {
  const buffer = new TextEncoder().encode(value);
  let hashValue = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    hashValue = (hashValue << 5) - hashValue + buffer[index]!;
    hashValue |= 0;
  }
  return Math.abs(hashValue).toString(16);
};

import { IndexedDbCacheRepository } from './indexeddb-repo';

export const createCacheRepository = (
  options?: { maxBytes?: number; ttl?: number }
): CacheRepository => {
  // eslint-disable-next-line no-restricted-globals
  if (typeof indexedDB !== 'undefined') {
    return new IndexedDbCacheRepository(options);
  }
  return new MemoryCacheRepository(options);
};
