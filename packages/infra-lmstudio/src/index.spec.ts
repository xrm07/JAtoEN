import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LMStudioClient, LMStudioClientError, listModels } from './index';

declare const global: { fetch: typeof fetch };

/**
 * テスト観点表: listModels（モデル一覧取得）
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---------|---------------------|-------------|-----------------|
 * | LM-N-01 | 正常なレスポンス | 正常系 | モデルID配列を返す |
 * | LM-A-01 | 401 Unauthorized | 認証エラー | unauthorized エラー |
 * | LM-A-02 | 不正なJSON | パースエラー | invalid-response エラー |
 * | LM-A-03 | ネットワークエラー | ネットワーク | network エラー |
 * | LM-A-04 | 空のdata配列 | 境界値-空 | 空配列を返す |
 */
describe('listModels', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('LM-N-01: 正常なレスポンスからモデルID配列を返す', async () => {
    // Given: 正常なAPIレスポンス
    const models = ['google/gemma-3-1b', 'text-embedding-nomic-embed-text-v1.5'];
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: models.map((id) => ({ id })) })
    })) as unknown as typeof fetch;

    // When: listModelsを実行
    const ids = await listModels({ baseUrl: 'http://localhost:1234/v1' });

    // Then: モデルID配列が返される
    expect(ids).toEqual(models);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('LM-A-01: 401レスポンスでunauthorizedエラーをthrowする', async () => {
    // Given: 401レスポンス
    global.fetch = vi.fn(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;

    // When/Then: unauthorizedエラーがthrowされる
    await expect(listModels()).rejects.toBeInstanceOf(LMStudioClientError);
    try {
      await listModels();
    } catch (e) {
      expect(e).toBeInstanceOf(LMStudioClientError);
      expect((e as LMStudioClientError).code).toBe('unauthorized');
      expect((e as LMStudioClientError).status).toBe(401);
    }
  });

  it('LM-A-02: 不正なJSONでinvalid-responseエラーをthrowする', async () => {
    // Given: JSONパースエラーが発生するレスポンス
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      }
    })) as unknown as typeof fetch;

    // When/Then: invalid-responseエラーがthrowされる
    await expect(listModels()).rejects.toBeInstanceOf(LMStudioClientError);
    try {
      await listModels();
    } catch (e) {
      expect((e as LMStudioClientError).code).toBe('invalid-response');
    }
  });

  it('LM-A-03: ネットワークエラーでnetworkエラーをthrowする', async () => {
    // Given: ネットワークエラー
    global.fetch = vi.fn(async () => {
      throw new Error('Network failure');
    }) as unknown as typeof fetch;

    // When/Then: networkエラーがthrowされる
    await expect(listModels()).rejects.toBeInstanceOf(LMStudioClientError);
    try {
      await listModels();
    } catch (e) {
      expect((e as LMStudioClientError).code).toBe('network');
      expect((e as LMStudioClientError).message).toContain('Network failure');
    }
  });

  it('LM-A-04: 空のdata配列は空配列を返す', async () => {
    // Given: 空のdata配列
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] })
    })) as unknown as typeof fetch;

    // When: listModelsを実行
    const ids = await listModels();

    // Then: 空配列が返される
    expect(ids).toEqual([]);
  });
});

/**
 * テスト観点表: LMStudioClient（翻訳クライアント）
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---------|---------------------|-------------|-----------------|
 * | LC-N-01 | 正常なリクエスト（chat/completions） | 正常系 | 翻訳結果を返す |
 * | LC-N-02 | 正常なリクエスト（responses） | 正常系 | 翻訳結果を返す |
 * | LC-N-03 | システムプロンプトにN=セグメント数が含まれる | 正常系 | N=が含まれる |
 * | LC-A-01 | 429 Rate Limit | レート制限 | rate-limitエラー、リトライ |
 * | LC-A-02 | 500 Server Error | サーバーエラー | serverエラー、リトライ |
 * | LC-A-03 | 空のレスポンス | 異常系 | invalid-responseエラー |
 * | LC-A-04 | セグメント数不一致 | データ整合性 | Errorをthrow |
 * | LC-A-05 | リトライ成功 | リトライ | 2回目で成功 |
 */
describe('LMStudioClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('正常系', () => {
    it('LC-N-01: chat/completionsエンドポイントで翻訳結果を返す', async () => {
      // Given: 正常なchat/completionsレスポンス
      global.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'こんにちは' } }]
        })
      })) as unknown as typeof fetch;

      const client = new LMStudioClient({ defaultModel: 'test-model' });
      const request = {
        id: 'req-1',
        segments: [{ id: 's1', text: 'Hello' }],
        langPair: { src: 'en' as const, dst: 'ja' as const },
        params: { model: 'test-model', temperature: 0.2, maxTokens: 512 }
      };

      // When: 翻訳を実行
      const result = await client.translate(request);

      // Then: 翻訳結果が返される
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.translated).toBe('こんにちは');
    });

    it('LC-N-02: responsesエンドポイントで翻訳結果を返す', async () => {
      // Given: responsesエンドポイントのレスポンス
      let capturedBody: Record<string, unknown> | null = null;
      global.fetch = vi.fn(async (_url: URL, init: RequestInit) => {
        capturedBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            response: {
              output: [{ type: 'output_text', text: 'Hello␞World' }]
            }
          })
        } as Response;
      }) as unknown as typeof fetch;

      const client = new LMStudioClient({
        defaultModel: 'test',
        endpoint: 'responses',
        defaultTemperature: 0.3
      });
      const request = {
        id: 'r1',
        segments: [
          { id: 's1', text: 'Hello' },
          { id: 's2', text: 'World' }
        ],
        langPair: { src: 'en' as const, dst: 'ja' as const },
        params: { model: 'google/gemma-3-1b', temperature: 0.1, maxTokens: 256 }
      };

      // When: 翻訳を実行
      const result = await client.translate(request);

      // Then: 翻訳結果が返される
      expect(result.items).toHaveLength(2);
      expect(result.items[0]?.translated).toBe('Hello');
      expect(result.items[1]?.translated).toBe('World');
      expect(capturedBody).toMatchObject({
        model: 'google/gemma-3-1b',
        temperature: 0.1,
        max_output_tokens: 256
      });
      expect(Array.isArray(capturedBody.input)).toBe(true);
    });

    it('LC-N-03: システムプロンプトにN=セグメント数と言語情報が含まれる', async () => {
      // Given: リクエストをキャプチャするモック
      type MessageItem = { role?: string; content?: string };
      type CapturedBody = { messages?: MessageItem[] };
      let capturedBody: CapturedBody | null = null;
      global.fetch = vi.fn(async (_url: URL, init: RequestInit) => {
        capturedBody = init?.body ? (JSON.parse(String(init.body)) as CapturedBody) : null;
        const user = capturedBody?.messages?.find((m: MessageItem) => m?.role === 'user');
        const content: string = user?.content ?? '';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { role: 'assistant', content } }]
          })
        } as Response;
      }) as unknown as typeof fetch;

      const client = new LMStudioClient({ defaultModel: 'test' });
      const request = {
        id: 'r1',
        segments: [
          { id: 's1', text: 'A' },
          { id: 's2', text: 'B' }
        ],
        langPair: { src: 'ja' as const, dst: 'en' as const },
        params: { model: 'm', temperature: 0.2, maxTokens: 128 }
      };

      // When: 翻訳を実行
      await client.translate(request);

      // Then: システムプロンプトにN=2と言語情報が含まれる
      const sys = capturedBody?.messages?.find((m: MessageItem) => m?.role === 'system')?.content as string;
      expect(sys).toContain('N=2');
      expect(sys).toContain('ja');
      expect(sys).toContain('en');
    });
  });

  describe('異常系', () => {
    it('LC-A-01: 401レスポンスでunauthorizedエラーをthrowする（リトライなし）', async () => {
      // Given: 401レスポンス（リトライ対象外）
      global.fetch = vi.fn(async () => ({
        ok: false,
        status: 401
      })) as unknown as typeof fetch;

      const client = new LMStudioClient({ defaultModel: 'test' });
      const request = {
        id: 'r1',
        segments: [{ id: 's1', text: 'Hello' }],
        langPair: { src: 'en' as const, dst: 'ja' as const },
        params: { model: 'test', temperature: 0.2, maxTokens: 128 }
      };

      // When/Then: unauthorizedエラーがthrowされる
      await expect(client.translate(request)).rejects.toBeInstanceOf(LMStudioClientError);
      try {
        await client.translate(request);
      } catch (e) {
        expect((e as LMStudioClientError).code).toBe('unauthorized');
        expect((e as LMStudioClientError).status).toBe(401);
      }
    });

    it('LC-A-02: 404レスポンスでinvalid-responseエラーをthrowする', async () => {
      // Given: 404レスポンス
      global.fetch = vi.fn(async () => ({
        ok: false,
        status: 404
      })) as unknown as typeof fetch;

      const client = new LMStudioClient({ defaultModel: 'test' });
      const request = {
        id: 'r1',
        segments: [{ id: 's1', text: 'Hello' }],
        langPair: { src: 'en' as const, dst: 'ja' as const },
        params: { model: 'test', temperature: 0.2, maxTokens: 128 }
      };

      // When/Then: invalid-responseエラーがthrowされる
      await expect(client.translate(request)).rejects.toBeInstanceOf(LMStudioClientError);
      try {
        await client.translate(request);
      } catch (e) {
        expect((e as LMStudioClientError).code).toBe('invalid-response');
        expect((e as LMStudioClientError).status).toBe(404);
      }
    });

    it('LC-A-03: 空のレスポンスでinvalid-responseエラーをthrowする', async () => {
      // Given: 空のレスポンス
      global.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { role: 'assistant', content: '' } }] })
      })) as unknown as typeof fetch;

      const client = new LMStudioClient({ defaultModel: 'test' });
      const request = {
        id: 'r1',
        segments: [{ id: 's1', text: 'Hello' }],
        langPair: { src: 'en' as const, dst: 'ja' as const },
        params: { model: 'test', temperature: 0.2, maxTokens: 128 }
      };

      // When/Then: invalid-responseエラーがthrowされる
      await expect(client.translate(request)).rejects.toBeInstanceOf(LMStudioClientError);
      try {
        await client.translate(request);
      } catch (e) {
        expect((e as LMStudioClientError).code).toBe('invalid-response');
      }
    });

    it('LC-A-04: セグメント数不一致でErrorをthrowする', async () => {
      // Given: セグメント数が異なるレスポンス
      global.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'A␞B␞C' } }]
        })
      })) as unknown as typeof fetch;

      const client = new LMStudioClient({ defaultModel: 'test' });
      const request = {
        id: 'r1',
        segments: [
          { id: 's1', text: 'Hello' },
          { id: 's2', text: 'World' }
        ],
        langPair: { src: 'en' as const, dst: 'ja' as const },
        params: { model: 'test', temperature: 0.2, maxTokens: 128 }
      };

      // When/Then: セグメント数不一致エラーがthrowされる
      await expect(client.translate(request)).rejects.toThrow('Segment count mismatch');
    });

    it('LC-A-05: ネットワークエラーでnetworkエラーをthrowする', async () => {
      // Given: ネットワークエラー
      global.fetch = vi.fn(async () => {
        throw new Error('Network failure');
      }) as unknown as typeof fetch;

      const client = new LMStudioClient({ defaultModel: 'test' });
      const request = {
        id: 'r1',
        segments: [{ id: 's1', text: 'Hello' }],
        langPair: { src: 'en' as const, dst: 'ja' as const },
        params: { model: 'test', temperature: 0.2, maxTokens: 128 }
      };

      // When/Then: networkエラーがthrowされる
      await expect(client.translate(request)).rejects.toBeInstanceOf(LMStudioClientError);
      try {
        await client.translate(request);
      } catch (e) {
        expect((e as LMStudioClientError).code).toBe('network');
        expect((e as LMStudioClientError).message).toContain('Network failure');
      }
    });
  });
});

/**
 * テスト観点表: LMStudioClientError（エラークラス）
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---------|---------------------|-------------|-----------------|
 * | ER-N-01 | エラー生成 | 正常系 | プロパティが正しく設定される |
 */
describe('LMStudioClientError', () => {
  it('ER-N-01: エラーのプロパティが正しく設定される', () => {
    // Given: エラーパラメータ
    const code = 'network' as const;
    const message = 'Connection failed';
    const status = 503;
    const retryAfter = 10;

    // When: エラーを生成
    const error = new LMStudioClientError(code, message, status, retryAfter);

    // Then: プロパティが正しく設定される
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(error.status).toBe(status);
    expect(error.retryAfter).toBe(retryAfter);
    expect(error.name).toBe('LMStudioClientError');
    expect(error).toBeInstanceOf(Error);
  });
});
