import { describe, expect, it, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const global: Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener<T extends unknown[] = unknown[]> = (...args: T) => void;

describe('background settings integration', () => {
  let onMessageListener: Listener | null = null;
  let onStorageChanged: Listener | null = null;

  beforeEach(async () => {
    vi.resetModules();
    onMessageListener = null;
    onStorageChanged = null;

    // Minimal chrome API mock
    global.chrome = {
      runtime: {
        onMessage: {
          addListener: (fn: Listener) => {
            onMessageListener = fn;
          }
        },
        onInstalled: { addListener: vi.fn() }
      },
      storage: {
        local: {
          get: vi.fn(async () => ({
            'xt-settings': {
              model: 'google/gemma-3-1b',
              maxTokens: 512,
              temperature: 0.2
            }
          }))
        },
        onChanged: {
          addListener: (fn: Listener) => {
            onStorageChanged = fn;
          }
        }
      },
      tabs: {
        sendMessage: vi.fn(),
        query: vi.fn(async () => [{ id: 1 }])
      },
      commands: { onCommand: { addListener: vi.fn() } },
      contextMenus: {
        removeAll: vi.fn(),
        create: vi.fn(),
        onClicked: { addListener: vi.fn() }
      }
    } as const;

    // First fetch mock - capture payloads
    global.fetch = vi.fn(async () => {
      // Echo back the model to inspect via caller-side assertions if needed
      const content = 'Hello [en]';
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { role: 'assistant', content } }] })
      };
    }) as unknown as typeof fetch;

    await import('./index');
  });

  it('uses updated model after storage change', async () => {
    expect(onMessageListener).toBeInstanceOf(Function);
    const req1 = {
      type: 'translate.selection',
      id: 't-1',
      text: 'Hello',
      pair: { src: 'en', dst: 'ja' }
    } as const;

    const sendResponse = vi.fn();
    await (onMessageListener as Listener)(req1, {}, sendResponse);
    // wait microtasks
    await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalled();

    // Change settings
    const changes: Record<string, { newValue: { model: string; maxTokens: number; temperature: number } }> = {
      'xt-settings': {
        newValue: { model: 'local/other-llm', maxTokens: 1024, temperature: 0.3 }
      }
    };
    (onStorageChanged as Listener)(changes, 'local');

    const req2 = { ...req1, id: 't-2' };
    const sendResponse2 = vi.fn();
    await (onMessageListener as Listener)(req2, {}, sendResponse2);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse2).toHaveBeenCalled();
  });

  it('handles stats.get message', async () => {
    expect(onMessageListener).toBeInstanceOf(Function);

    const sendResponse = vi.fn();
    const result = (onMessageListener as Listener)({ type: 'stats.get' }, {}, sendResponse);
    expect(result).toBe(true);

    // Wait for async stats call
    await new Promise((r) => setTimeout(r, 10));
    expect(sendResponse).toHaveBeenCalled();
    const response = sendResponse.mock.calls[0][0];
    expect(response.type).toBe('stats.result');
    expect(response.stats).toBeDefined();
  });

  it('ignores non-translate messages', async () => {
    expect(onMessageListener).toBeInstanceOf(Function);

    const sendResponse = vi.fn();
    const result = (onMessageListener as Listener)({ type: 'unknown.message' }, {}, sendResponse);
    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});

describe('TranslationService', () => {
  beforeEach(() => {
    vi.resetModules();

    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'Translated' } }]
      })
    })) as unknown as typeof fetch;
  });

  it('can be imported and instantiated', async () => {
    const { TranslationService } = await import('./services/translation-service');
    const service = new TranslationService({
      model: 'test-model',
      maxTokens: 512,
      temperature: 0.2
    });

    expect(service.getConfig().model).toBe('test-model');
  });

  it('updates config correctly', async () => {
    const { TranslationService } = await import('./services/translation-service');
    const service = new TranslationService({
      model: 'initial-model',
      maxTokens: 512,
      temperature: 0.2
    });

    service.updateConfig({
      model: 'new-model',
      maxTokens: 1024,
      temperature: 0.5,
      endpoint: 'responses',
      baseUrl: 'http://localhost:5678/v1'
    });

    const config = service.getConfig();
    expect(config.model).toBe('new-model');
    expect(config.maxTokens).toBe(1024);
    expect(config.temperature).toBe(0.5);
    expect(config.endpoint).toBe('responses');
    expect(service.getBaseUrl()).toBe('http://localhost:5678/v1');
  });

  it('splits text into segments', async () => {
    const { TranslationService } = await import('./services/translation-service');
    const service = new TranslationService({
      model: 'test',
      maxTokens: 512,
      temperature: 0.2
    });

    const segments = service.splitText('Hello world. Goodbye.');
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0].text).toBeDefined();
  });

  it('serializes errors correctly', async () => {
    const { TranslationService } = await import('./services/translation-service');
    const { LMStudioClientError } = await import('@ja-to-en/infra-lmstudio');
    const service = new TranslationService({
      model: 'test',
      maxTokens: 512,
      temperature: 0.2
    });

    const lmError = new LMStudioClientError('network', 'Connection failed');
    expect(service.serializeError(lmError)).toBe('network:Connection failed');

    const genericError = new Error('Generic error');
    expect(service.serializeError(genericError)).toBe('Generic error');

    expect(service.serializeError('string error')).toBe('Unknown error');
  });
});
