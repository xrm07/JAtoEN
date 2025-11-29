import { describe, it, expect } from 'vitest';
import { LMStudioClient } from './index';
import { createTranslationRequest } from '@ja-to-en/domain';

const REAL_BASE_URL = process.env.LM_BASE_URL;
const REAL_MODEL = process.env.LM_MODEL || 'google/gemma-3-1b';

const maybe = REAL_BASE_URL ? describe : describe.skip;

const originalFetch = globalThis.fetch;

maybe('LMStudioClient realtime integration', () => {
  it('sends translate request via /v1/chat/completions', async () => {
    // Ensure tests that stub fetch do not affect this integration test
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }

    const client = new LMStudioClient({
      baseUrl: REAL_BASE_URL,
      defaultModel: REAL_MODEL,
      defaultTemperature: 0.2,
      endpoint: 'chat/completions'
    });

    const request = createTranslationRequest(
      `real-${Date.now()}`,
      [
        { id: 'seg-0', text: 'こんにちは世界' }
      ],
      { src: 'ja', dst: 'en' },
      { model: REAL_MODEL, temperature: 0.1, maxTokens: 256 }
    );

    const result = await client.translate(request);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.translated.length).toBeGreaterThan(0);
  }, 20_000);
});

