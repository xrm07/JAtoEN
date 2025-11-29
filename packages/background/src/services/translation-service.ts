/**
 * Translation service - centralizes LM Studio client and cache access
 */
import {
  Segmenter,
  TranslationRequest,
  createTranslationRequest
} from '@ja-to-en/domain';
import {
  CacheValue,
  buildCacheKey,
  estimateBytes,
  createCacheRepository,
  CacheRepository
} from '@ja-to-en/infra-cache';
import { LMStudioClient, LMStudioClientError } from '@ja-to-en/infra-lmstudio';
import type { RuntimeConfig, LangPair } from '../types';

export class TranslationService {
  private readonly segmenter = new Segmenter();
  private readonly cache: CacheRepository;
  private config: RuntimeConfig;
  private baseUrl?: string;
  private apiKey?: string;

  constructor(initialConfig: RuntimeConfig) {
    this.config = { ...initialConfig };
    this.cache = createCacheRepository();
  }

  updateConfig(config: Partial<RuntimeConfig & { baseUrl?: string; apiKey?: string }>) {
    if (config.model) this.config.model = config.model;
    if (typeof config.maxTokens === 'number') this.config.maxTokens = config.maxTokens;
    if (typeof config.temperature === 'number') this.config.temperature = config.temperature;
    if (config.endpoint === 'responses' || config.endpoint === 'chat/completions') {
      this.config.endpoint = config.endpoint;
    }
    if (typeof config.baseUrl === 'string') {
      this.baseUrl = config.baseUrl.trim() || undefined;
    }
    if (typeof config.apiKey === 'string') {
      this.apiKey = config.apiKey.trim() || undefined;
    }
  }

  getConfig(): RuntimeConfig {
    return { ...this.config };
  }

  getBaseUrl(): string | undefined {
    return this.baseUrl;
  }

  private createClient(): LMStudioClient {
    return new LMStudioClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      defaultModel: this.config.model,
      defaultTemperature: this.config.temperature,
      endpoint: this.config.endpoint ?? 'chat/completions'
    });
  }

  splitText(text: string) {
    return this.segmenter.split(text);
  }

  async getCached(pair: LangPair, text: string): Promise<CacheValue | undefined> {
    const key = buildCacheKey(pair, text);
    return this.cache.get(key);
  }

  async translateSelection(
    id: string,
    text: string,
    pair: LangPair
  ): Promise<{ items: Array<{ id: string; translated: string }> }> {
    const segments = this.segmenter.split(text);
    if (segments.length === 0) {
      return { items: [] };
    }

    const cacheKey = buildCacheKey(pair, text);
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return {
        items: [{ id: segments[0]?.id ?? id, translated: cached.translated }]
      };
    }

    const request = createTranslationRequest(id, segments, pair, {
      model: this.config.model,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature
    });

    const client = this.createClient();
    const result = await client.translate(request);

    // Cache the result
    const combinedText = result.items.map((item) => item.translated).join('\n');
    const cacheValue: CacheValue = {
      key: cacheKey,
      langPair: `${pair.src}:${pair.dst}`,
      text: request.segments.map((s) => s.text).join('\n'),
      translated: combinedText,
      size: estimateBytes(combinedText),
      lastAccess: Date.now(),
      meta: {
        model: this.config.model,
        temperature: this.config.temperature,
        timestamp: Date.now(),
        hits: 0
      }
    };
    await this.cache.set(cacheValue);

    return result;
  }

  async translatePageBatch(
    request: TranslationRequest,
    onProgress?: (done: number, total: number) => void
  ): Promise<Array<{ id: string; translated: string }>> {
    const batchSize = 20;
    const translatedItems: Array<{ id: string; translated: string }> = [];
    const client = this.createClient();
    const totalSegments = request.segments.length;

    for (let i = 0; i < totalSegments; i += batchSize) {
      const slice = request.segments.slice(i, i + batchSize);
      const batchRequest = createTranslationRequest(
        `${request.id}-${Math.floor(i / batchSize)}`,
        slice,
        request.langPair,
        request.params
      );
      const res = await client.translate(batchRequest);
      translatedItems.push(...res.items);

      const done = Math.min(i + batchSize, totalSegments);
      onProgress?.(done, totalSegments);
    }

    // Final progress callback to ensure 100%
    if (translatedItems.length === totalSegments) {
      onProgress?.(totalSegments, totalSegments);
    }

    return translatedItems;
  }

  async getStats() {
    return this.cache.stats();
  }

  serializeError(error: unknown): string {
    if (error instanceof LMStudioClientError) {
      return `${error.code}:${error.message}`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown error';
  }
}

