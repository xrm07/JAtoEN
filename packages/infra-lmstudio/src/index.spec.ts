import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LMStudioClient, LMStudioClientError, listModels } from './index';

declare const global: any;

describe('listModels', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns model ids from /v1/models', async () => {
    const models = ['google/gemma-3-1b', 'text-embedding-nomic-embed-text-v1.5'];
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: models.map((id) => ({ id })) })
    })) as unknown as typeof fetch;

    const ids = await listModels({ baseUrl: 'http://localhost:1234/v1' });
    expect(ids).toEqual(models);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('throws unauthorized on 401', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
    await expect(listModels()).rejects.toBeInstanceOf(LMStudioClientError);
    try {
      await listModels();
    } catch (e) {
      expect(e).toBeInstanceOf(LMStudioClientError);
      expect((e as LMStudioClientError).code).toBe('unauthorized');
    }
  });

  it('throws invalid-response on bad json', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('bad json'); }
    })) as unknown as typeof fetch;

    await expect(listModels()).rejects.toBeInstanceOf(LMStudioClientError);
  });

  it('embeds N and languages in system prompt', async () => {
    let capturedBody: any = null;
    global.fetch = vi.fn(async (_url: URL, init: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
      const user = capturedBody?.messages?.find((m: any) => m?.role === 'user');
      const content: string = user?.content ?? '';
      const response = {
        choices: [{ message: { role: 'assistant', content } }]
      };
      return { ok: true, status: 200, json: async () => response } as any;
    }) as unknown as typeof fetch;

    const client = new LMStudioClient({ defaultModel: 'test' });
    const req = {
      id: 'r1',
      segments: [ { id: 's1', text: 'A' }, { id: 's2', text: 'B' } ],
      langPair: { src: 'ja', dst: 'en' },
      params: { model: 'm', temperature: 0.2, maxTokens: 128 }
    } as any;
    await client.translate(req);
    const sys = capturedBody?.messages?.find((m: any) => m?.role === 'system')?.content as string;
    expect(sys).toContain('N=2');
    expect(sys).toContain('ja');
    expect(sys).toContain('en');
  });

  it('formats payload for responses endpoint and parses output', async () => {
    let capturedBody: any = null;
    global.fetch = vi.fn(async (_url: URL, init: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
      const response = {
        response: {
          output: [
            { type: 'output_text', text: 'Hello␞World' }
          ]
        }
      };
      return { ok: true, status: 200, json: async () => response } as any;
    }) as unknown as typeof fetch;

    const client = new LMStudioClient({ defaultModel: 'test', endpoint: 'responses', defaultTemperature: 0.3 });
    const req = {
      id: 'r1',
      segments: [ { id: 's1', text: 'Hello' }, { id: 's2', text: 'World' } ],
      langPair: { src: 'en', dst: 'ja' },
      params: { model: 'google/gemma-3-1b', temperature: 0.1, maxTokens: 256 }
    } as any;
    const result = await client.translate(req);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.translated).toBe('Hello');
    expect(result.items[1]?.translated).toBe('World');
    expect(capturedBody).toMatchObject({
      model: 'google/gemma-3-1b',
      temperature: 0.1,
      max_output_tokens: 256
    });
    expect(Array.isArray(capturedBody.input)).toBe(true);
    expect(capturedBody.input?.[0]?.role).toBe('system');
    expect(capturedBody.input?.[1]?.role).toBe('user');
  });
});


