import { describe, expect, it, vi, beforeEach } from 'vitest';

declare const global: any;

type Listener<T extends any[] = any[]> = (...args: T) => void;

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
        onMessage: { addListener: (fn: Listener) => { onMessageListener = fn; } },
        onInstalled: { addListener: vi.fn() },
      },
      storage: {
        local: {
          get: vi.fn(async () => ({ 'xt-settings': { model: 'google/gemma-3-1b', maxTokens: 512, temperature: 0.2 } }))
        },
        onChanged: { addListener: (fn: Listener) => { onStorageChanged = fn; } }
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
    global.fetch = vi.fn(async (url: URL, init: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      // Echo back the model to inspect via caller-side assertions if needed
      const content = 'Hello [en]';
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { role: 'assistant', content } }] })
      } as any;
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
    await (onMessageListener as Listener)(req1, { }, sendResponse);
    // wait microtasks
    await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse).toHaveBeenCalled();

    // Change settings
    const changes = {
      'xt-settings': { newValue: { model: 'local/other-llm', maxTokens: 1024, temperature: 0.3 } }
    } as any;
    (onStorageChanged as Listener)(changes, 'local');

    const req2 = { ...req1, id: 't-2' };
    const sendResponse2 = vi.fn();
    await (onMessageListener as Listener)(req2, { }, sendResponse2);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendResponse2).toHaveBeenCalled();
  });
});


