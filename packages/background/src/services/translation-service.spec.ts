import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TranslationService } from './translation-service';
import { LMStudioClientError } from '@ja-to-en/infra-lmstudio';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const global: Record<string, unknown>;

/**
 * テスト観点表: TranslationService（翻訳サービス）
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---------|---------------------|-------------|-----------------|
 * | TS-N-01 | 有効なテキスト「Hello」 | 正常系 | 翻訳結果を返す |
 * | TS-N-02 | 複数文「Hello. World.」 | 正常系 | セグメント分割して翻訳 |
 * | TS-N-03 | キャッシュヒット時 | 正常系 | キャッシュから返却 |
 * | TS-N-04 | 設定更新 | 正常系 | 新しい設定が反映される |
 * | TS-A-01 | 空文字列「」 | 境界値-空 | 空の items 配列を返す |
 * | TS-A-02 | 空白のみ「   」 | 境界値-空白 | 空の items 配列を返す |
 * | TS-A-03 | 1文字「あ」 | 境界値-最小 | 1セグメントとして翻訳 |
 * | TS-A-04 | LM Studio接続エラー | 異常系 | エラーをthrow |
 * | TS-A-05 | エラーシリアライズ | 異常系 | 適切な文字列に変換 |
 */
describe('TranslationService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // デフォルトの成功レスポンス
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'Translated' } }]
      })
    })) as unknown as typeof fetch;
  });

  describe('初期化と設定', () => {
    it('TS-INIT-01: 初期設定で正しく初期化される', () => {
      // Given: 初期設定
      const config = {
        model: 'test-model',
        maxTokens: 512,
        temperature: 0.2
      };

      // When: サービスを初期化
      const service = new TranslationService(config);

      // Then: 設定が正しく反映される
      const resultConfig = service.getConfig();
      expect(resultConfig.model).toBe('test-model');
      expect(resultConfig.maxTokens).toBe(512);
      expect(resultConfig.temperature).toBe(0.2);
    });

    it('TS-N-04: 設定更新が正しく反映される', () => {
      // Given: 初期化されたサービス
      const service = new TranslationService({
        model: 'initial-model',
        maxTokens: 512,
        temperature: 0.2
      });

      // When: 設定を更新
      service.updateConfig({
        model: 'new-model',
        maxTokens: 1024,
        temperature: 0.5,
        endpoint: 'responses',
        baseUrl: 'http://localhost:5678/v1',
        apiKey: 'test-key'
      });

      // Then: 新しい設定が反映される
      const config = service.getConfig();
      expect(config.model).toBe('new-model');
      expect(config.maxTokens).toBe(1024);
      expect(config.temperature).toBe(0.5);
      expect(config.endpoint).toBe('responses');
      expect(service.getBaseUrl()).toBe('http://localhost:5678/v1');
    });

    it('TS-CONFIG-01: 空のbaseUrlは無視される', () => {
      // Given: 初期化されたサービス
      const service = new TranslationService({
        model: 'test',
        maxTokens: 512,
        temperature: 0.2
      });

      // When: 空のbaseUrlで更新
      service.updateConfig({ baseUrl: '   ' });

      // Then: baseUrlはundefinedのまま
      expect(service.getBaseUrl()).toBeUndefined();
    });
  });

  describe('テキスト分割', () => {
    it('TS-SPLIT-01: テキストを正しくセグメント分割する', () => {
      // Given: サービスとテキスト
      const service = new TranslationService({
        model: 'test',
        maxTokens: 512,
        temperature: 0.2
      });
      const text = 'Hello world. Goodbye world.';

      // When: 分割を実行
      const segments = service.splitText(text);

      // Then: 正しく分割される
      expect(segments.length).toBeGreaterThan(0);
      expect(segments[0]?.text).toBeDefined();
    });
  });

  describe('選択テキスト翻訳', () => {
    it('TS-N-01: 有効なテキストを翻訳して結果を返す', async () => {
      // Given: サービスと有効なテキスト
      const service = new TranslationService({
        model: 'test',
        maxTokens: 512,
        temperature: 0.2
      });

      // When: 翻訳を実行
      const result = await service.translateSelection('req-1', 'Hello', {
        src: 'en',
        dst: 'ja'
      });

      // Then: 翻訳結果が返される
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.translated).toBeDefined();
    });

    it('TS-A-01: 空文字列は空のitems配列を返す', async () => {
      // Given: サービスと空文字列
      const service = new TranslationService({
        model: 'test',
        maxTokens: 512,
        temperature: 0.2
      });

      // When: 空文字列で翻訳を実行
      const result = await service.translateSelection('req-1', '', { src: 'en', dst: 'ja' });

      // Then: 空のitems配列が返される
      expect(result.items).toHaveLength(0);
    });

    it('TS-A-02: 空白のみは空のitems配列を返す', async () => {
      // Given: サービスと空白のみの文字列
      const service = new TranslationService({
        model: 'test',
        maxTokens: 512,
        temperature: 0.2
      });

      // When: 空白のみで翻訳を実行
      const result = await service.translateSelection('req-1', '   ', { src: 'en', dst: 'ja' });

      // Then: 空のitems配列が返される
      expect(result.items).toHaveLength(0);
    });

    it('TS-A-03: 1文字テキストを正しく翻訳する', async () => {
      // Given: サービスと1文字テキスト
      global.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'A' } }]
        })
      })) as unknown as typeof fetch;

      const service = new TranslationService({
        model: 'test',
        maxTokens: 512,
        temperature: 0.2
      });

      // When: 1文字で翻訳を実行
      const result = await service.translateSelection('req-1', 'あ', { src: 'ja', dst: 'en' });

      // Then: 1セグメントの結果が返される
      expect(result.items).toHaveLength(1);
    });

    it('TS-A-04: LM Studio接続エラー時はエラーをthrowする', async () => {
      // Given: ネットワークエラーが発生するモック
      global.fetch = vi.fn(async () => {
        throw new Error('Network failure');
      }) as unknown as typeof fetch;

      const service = new TranslationService({
        model: 'test',
        maxTokens: 512,
        temperature: 0.2
      });

      // When/Then: エラーがthrowされる
      await expect(
        service.translateSelection('req-1', 'Hello', { src: 'en', dst: 'ja' })
      ).rejects.toThrow();
    });
  });

  describe('統計取得', () => {
    it('TS-STATS-01: 統計情報を取得できる', async () => {
      // Given: サービス
      const service = new TranslationService({
        model: 'test',
        maxTokens: 512,
        temperature: 0.2
      });

      // When: 統計を取得
      const stats = await service.getStats();

      // Then: 統計情報が返される
      expect(stats).toBeDefined();
      expect(typeof stats.entries).toBe('number');
      expect(typeof stats.hits).toBe('number');
      expect(typeof stats.misses).toBe('number');
    });
  });

  describe('エラーシリアライズ', () => {
    it('TS-A-05-1: LMStudioClientErrorを正しくシリアライズする', () => {
      // Given: サービスとLMStudioClientError
      const service = new TranslationService({
        model: 'test',
        maxTokens: 512,
        temperature: 0.2
      });
      const error = new LMStudioClientError('network', 'Connection failed');

      // When: シリアライズを実行
      const result = service.serializeError(error);

      // Then: 正しい形式でシリアライズされる
      expect(result).toBe('network:Connection failed');
    });

    it('TS-A-05-2: 通常のErrorを正しくシリアライズする', () => {
      // Given: サービスと通常のError
      const service = new TranslationService({
        model: 'test',
        maxTokens: 512,
        temperature: 0.2
      });
      const error = new Error('Generic error');

      // When: シリアライズを実行
      const result = service.serializeError(error);

      // Then: メッセージが返される
      expect(result).toBe('Generic error');
    });

    it('TS-A-05-3: 文字列エラーは「Unknown error」を返す', () => {
      // Given: サービスと文字列エラー
      const service = new TranslationService({
        model: 'test',
        maxTokens: 512,
        temperature: 0.2
      });

      // When: シリアライズを実行
      const result = service.serializeError('string error');

      // Then: 「Unknown error」が返される
      expect(result).toBe('Unknown error');
    });

    it('TS-A-05-4: nullは「Unknown error」を返す', () => {
      // Given: サービスとnull
      const service = new TranslationService({
        model: 'test',
        maxTokens: 512,
        temperature: 0.2
      });

      // When: シリアライズを実行
      const result = service.serializeError(null);

      // Then: 「Unknown error」が返される
      expect(result).toBe('Unknown error');
    });
  });

  describe('ページ翻訳バッチ', () => {
    it('TS-BATCH-01: 進捗コールバックが呼ばれる', async () => {
      // Given: サービスとリクエスト
      global.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'A␞B␞C' } }]
        })
      })) as unknown as typeof fetch;

      const service = new TranslationService({
        model: 'test',
        maxTokens: 512,
        temperature: 0.2
      });

      const progressCalls: Array<{ done: number; total: number }> = [];
      const request = {
        id: 'req-1',
        segments: [
          { id: 's1', text: 'A' },
          { id: 's2', text: 'B' },
          { id: 's3', text: 'C' }
        ],
        langPair: { src: 'ja' as const, dst: 'en' as const },
        params: { model: 'test', maxTokens: 512, temperature: 0.2 }
      };

      // When: バッチ翻訳を実行
      await service.translatePageBatch(request, (done, total) => {
        progressCalls.push({ done, total });
      });

      // Then: 進捗コールバックが呼ばれる
      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[progressCalls.length - 1]?.done).toBe(3);
      expect(progressCalls[progressCalls.length - 1]?.total).toBe(3);
    });
  });
});

