import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  CacheValue,
  MemoryCacheRepository,
  buildCacheKey,
  estimateBytes
} from './index';

/**
 * ヘルパー: テスト用のキャッシュアイテムを作成
 */
const createItem = (
  key: string,
  translated: string,
  options?: { timestamp?: number; lastAccess?: number }
): CacheValue => ({
  key,
  text: 'hello',
  langPair: 'en:ja',
  translated,
  size: estimateBytes(translated),
  lastAccess: options?.lastAccess ?? Date.now(),
  meta: {
    model: 'lmstudio',
    temperature: 0.2,
    timestamp: options?.timestamp ?? Date.now(),
    hits: 0
  }
});

/**
 * テスト観点表: MemoryCacheRepository（キャッシュ）
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---------|---------------------|-------------|-----------------|
 * | MC-N-01 | set→get 同一キー | 正常系 | 保存した値を取得 |
 * | MC-N-02 | 存在しないキー | 正常系 | undefined を返す |
 * | MC-N-03 | 複数エントリの保存と取得 | 正常系 | すべて取得可能 |
 * | MC-A-01 | TTL 超過後の get | 境界値-TTL | undefined を返す |
 * | MC-A-02 | maxBytes 超過時の set | 境界値-容量 | LRU で古いエントリ削除 |
 * | MC-A-03 | maxBytes=0 | 境界値-最小 | 即座に evict |
 * | MC-A-04 | 同一キーで上書き | 更新 | 新しい値で更新 |
 * | MC-A-05 | 複数エントリの LRU 順序 | LRU | 最終アクセス順に削除 |
 * | MC-A-06 | TTL=0 | 境界値-最小TTL | 即座に期限切れ |
 * | MC-A-07 | stats の正確性 | 統計 | 正確な統計情報 |
 */
describe('MemoryCacheRepository', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('正常系', () => {
    it('MC-N-01: set→get で同一キーの値を取得できる', async () => {
      // Given: キャッシュリポジトリと保存するアイテム
      const cache = new MemoryCacheRepository({ ttl: 10_000, maxBytes: 1024 });
      const key = buildCacheKey({ src: 'en', dst: 'ja' }, 'Hello');
      const item = createItem(key, 'こんにちは');

      // When: アイテムを保存して取得
      await cache.set(item);
      const result = await cache.get(key);

      // Then: 保存した値が取得できる
      expect(result?.translated).toBe('こんにちは');
      expect(result?.key).toBe(key);
    });

    it('MC-N-02: 存在しないキーはundefinedを返す', async () => {
      // Given: 空のキャッシュリポジトリ
      const cache = new MemoryCacheRepository({ ttl: 10_000, maxBytes: 1024 });
      const key = buildCacheKey({ src: 'en', dst: 'ja' }, 'NonExistent');

      // When: 存在しないキーを取得
      const result = await cache.get(key);

      // Then: undefinedが返される
      expect(result).toBeUndefined();
    });

    it('MC-N-03: 複数エントリを保存して取得できる', async () => {
      // Given: キャッシュリポジトリ
      const cache = new MemoryCacheRepository({ ttl: 10_000, maxBytes: 10240 });
      const items = [
        createItem('key1', 'value1'),
        createItem('key2', 'value2'),
        createItem('key3', 'value3')
      ];

      // When: 複数アイテムを保存
      for (const item of items) {
        await cache.set(item);
      }

      // Then: すべて取得できる
      const result1 = await cache.get('key1');
      const result2 = await cache.get('key2');
      const result3 = await cache.get('key3');
      expect(result1?.translated).toBe('value1');
      expect(result2?.translated).toBe('value2');
      expect(result3?.translated).toBe('value3');
    });
  });

  describe('境界値・異常系', () => {
    it('MC-A-01: TTL超過後はundefinedを返す', async () => {
      // Given: TTL=1000msのキャッシュ
      const cache = new MemoryCacheRepository({ ttl: 1000, maxBytes: 1024 });
      const key = buildCacheKey({ src: 'en', dst: 'ja' }, 'Hello');
      const item = createItem(key, 'こんにちは');

      // When: アイテムを保存し、TTLを超過
      await cache.set(item);
      vi.advanceTimersByTime(1001);
      const result = await cache.get(key);

      // Then: undefinedが返される
      expect(result).toBeUndefined();
    });

    it('MC-A-02: maxBytes超過時はLRUで古いエントリを削除する', async () => {
      // Given: 小さいmaxBytesのキャッシュ
      const cache = new MemoryCacheRepository({ ttl: 10_000, maxBytes: 20 });

      // When: maxBytesを超えるアイテムを追加
      await cache.set(createItem('a', 'a'.repeat(10)));
      vi.advanceTimersByTime(10);
      await cache.set(createItem('b', 'b'.repeat(10)));
      vi.advanceTimersByTime(10);
      await cache.set(createItem('c', 'c'.repeat(10)));

      // Then: 最も古いエントリ'a'が削除される
      const resultA = await cache.get('a');
      const resultB = await cache.get('b');
      const resultC = await cache.get('c');
      expect(resultA).toBeUndefined();
      // bまたはcは残っている可能性がある
      expect(resultB !== undefined || resultC !== undefined).toBe(true);
    });

    it('MC-A-03: maxBytes=0の場合は即座にevictされる', async () => {
      // Given: maxBytes=0のキャッシュ
      const cache = new MemoryCacheRepository({ ttl: 10_000, maxBytes: 0 });
      const item = createItem('key', 'value');

      // When: アイテムを保存
      await cache.set(item);

      // Then: 即座にevictされる（サイズ0以下になるまで削除）
      const stats = await cache.stats();
      expect(stats.entries).toBe(0);
    });

    it('MC-A-04: 同一キーで上書きすると新しい値に更新される', async () => {
      // Given: キャッシュリポジトリ
      const cache = new MemoryCacheRepository({ ttl: 10_000, maxBytes: 1024 });
      const key = 'same-key';

      // When: 同一キーで2回保存
      await cache.set(createItem(key, 'old-value'));
      await cache.set(createItem(key, 'new-value'));
      const result = await cache.get(key);

      // Then: 新しい値が返される
      expect(result?.translated).toBe('new-value');
    });

    it('MC-A-05: LRU順序で削除される（最終アクセス順）', async () => {
      // Given: 小さいmaxBytesのキャッシュ
      const cache = new MemoryCacheRepository({ ttl: 10_000, maxBytes: 30 });

      // When: 3つのアイテムを追加し、'a'にアクセスしてから'd'を追加
      await cache.set(createItem('a', 'a'.repeat(10)));
      vi.advanceTimersByTime(10);
      await cache.set(createItem('b', 'b'.repeat(10)));
      vi.advanceTimersByTime(10);
      await cache.set(createItem('c', 'c'.repeat(10)));
      vi.advanceTimersByTime(10);

      // 'a'にアクセスしてlastAccessを更新
      await cache.get('a');
      vi.advanceTimersByTime(10);

      // 新しいアイテムを追加（evictが発生）
      await cache.set(createItem('d', 'd'.repeat(10)));

      // Then: 'b'が削除される（'a'はアクセスされたので残る）
      const resultA = await cache.get('a');
      const resultB = await cache.get('b');
      expect(resultA?.translated).toBe('a'.repeat(10));
      expect(resultB).toBeUndefined();
    });

    it('MC-A-06: TTL=0の場合は即座に期限切れになる', async () => {
      // Given: TTL=0のキャッシュ
      const cache = new MemoryCacheRepository({ ttl: 0, maxBytes: 1024 });
      const item = createItem('key', 'value');

      // When: アイテムを保存してすぐに取得
      await cache.set(item);
      vi.advanceTimersByTime(1);
      const result = await cache.get('key');

      // Then: 期限切れでundefinedが返される
      expect(result).toBeUndefined();
    });

    it('MC-A-07: statsは正確な統計情報を返す', async () => {
      // Given: キャッシュリポジトリ
      const cache = new MemoryCacheRepository({ ttl: 10_000, maxBytes: 10240 });

      // When: アイテムを保存してhit/missを発生させる
      await cache.set(createItem('key1', 'value1'));
      await cache.set(createItem('key2', 'value2'));
      await cache.get('key1'); // hit
      await cache.get('key1'); // hit
      await cache.get('nonexistent'); // miss

      // Then: 正確な統計が返される
      const stats = await cache.stats();
      expect(stats.entries).toBe(2);
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.estimatedBytes).toBeGreaterThan(0);
    });
  });
});

/**
 * テスト観点表: buildCacheKey（キャッシュキー生成）
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---------|---------------------|-------------|-----------------|
 * | CK-N-01 | 有効な言語ペアとテキスト | 正常系 | 一意のキーを生成 |
 * | CK-N-02 | 同一入力 | 正常系 | 同一キーを生成 |
 * | CK-N-03 | 異なる言語ペア | 正常系 | 異なるキーを生成 |
 * | CK-A-01 | 前後空白の正規化 | 正規化 | 同一キーを生成 |
 */
describe('buildCacheKey', () => {
  it('CK-N-01: 有効な言語ペアとテキストから一意のキーを生成する', () => {
    // Given: 言語ペアとテキスト
    const langPair = { src: 'en', dst: 'ja' };
    const text = 'Hello World';

    // When: キー生成を実行
    const key = buildCacheKey(langPair, text);

    // Then: キーが生成される
    expect(key).toMatch(/^en:ja:[a-f0-9]+$/);
  });

  it('CK-N-02: 同一入力からは同一キーが生成される', () => {
    // Given: 同一の言語ペアとテキスト
    const langPair = { src: 'en', dst: 'ja' };
    const text = 'Hello World';

    // When: 2回キー生成を実行
    const key1 = buildCacheKey(langPair, text);
    const key2 = buildCacheKey(langPair, text);

    // Then: 同一キーが生成される
    expect(key1).toBe(key2);
  });

  it('CK-N-03: 異なる言語ペアからは異なるキーが生成される', () => {
    // Given: 異なる言語ペア
    const text = 'Hello World';

    // When: 異なる言語ペアでキー生成
    const key1 = buildCacheKey({ src: 'en', dst: 'ja' }, text);
    const key2 = buildCacheKey({ src: 'ja', dst: 'en' }, text);

    // Then: 異なるキーが生成される
    expect(key1).not.toBe(key2);
  });

  it('CK-A-01: 前後空白は正規化されて同一キーが生成される', () => {
    // Given: 前後に空白を含むテキスト
    const langPair = { src: 'en', dst: 'ja' };

    // When: 前後空白ありなしでキー生成
    const key1 = buildCacheKey(langPair, 'Hello World');
    const key2 = buildCacheKey(langPair, '  Hello World  ');

    // Then: 同一キーが生成される
    expect(key1).toBe(key2);
  });
});

/**
 * テスト観点表: estimateBytes（バイト数推定）
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---------|---------------------|-------------|-----------------|
 * | EB-N-01 | ASCII文字列 | 正常系 | 文字数と同じバイト数 |
 * | EB-N-02 | 日本語文字列 | 正常系 | UTF-8エンコード後のバイト数 |
 * | EB-A-01 | 空文字列 | 境界値-空 | 0バイト |
 */
describe('estimateBytes', () => {
  it('EB-N-01: ASCII文字列は文字数と同じバイト数を返す', () => {
    // Given: ASCII文字列
    const text = 'Hello';

    // When: バイト数推定を実行
    const bytes = estimateBytes(text);

    // Then: 文字数と同じバイト数
    expect(bytes).toBe(5);
  });

  it('EB-N-02: 日本語文字列はUTF-8エンコード後のバイト数を返す', () => {
    // Given: 日本語文字列（1文字3バイト）
    const text = 'こんにちは';

    // When: バイト数推定を実行
    const bytes = estimateBytes(text);

    // Then: UTF-8エンコード後のバイト数（5文字 × 3バイト = 15バイト）
    expect(bytes).toBe(15);
  });

  it('EB-A-01: 空文字列は0バイトを返す', () => {
    // Given: 空文字列
    const text = '';

    // When: バイト数推定を実行
    const bytes = estimateBytes(text);

    // Then: 0バイト
    expect(bytes).toBe(0);
  });
});
