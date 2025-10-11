import { describe, expect, it } from 'vitest';
import {
  CacheValue,
  MemoryCacheRepository,
  buildCacheKey,
  estimateBytes
} from './index';

const createItem = (key: string, translated: string): CacheValue => ({
  key,
  text: 'hello',
  langPair: 'en:ja',
  translated,
  size: estimateBytes(translated),
  lastAccess: Date.now(),
  meta: {
    model: 'lmstudio',
    temperature: 0.2,
    timestamp: Date.now(),
    hits: 0
  }
});

describe('MemoryCacheRepository', () => {
  it('stores and retrieves cache entries respecting ttl', async () => {
    const cache = new MemoryCacheRepository({ ttl: 1000, maxBytes: 1024 });
    const key = buildCacheKey({ src: 'en', dst: 'ja' }, 'Hello');
    await cache.set(createItem(key, 'こんにちは'));
    const result = await cache.get(key);
    expect(result?.translated).toBe('こんにちは');
  });

  it('evicts least recently used entries when exceeding size', async () => {
    const cache = new MemoryCacheRepository({ ttl: 10_000, maxBytes: 20 });
    await cache.set(createItem('a', 'a'.repeat(10)));
    await cache.set(createItem('b', 'b'.repeat(10)));
    await cache.set(createItem('c', 'c'.repeat(10)));
    const resultA = await cache.get('a');
    expect(resultA).toBeUndefined();
  });
});
