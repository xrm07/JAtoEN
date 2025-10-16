import {
  TranslationRequest,
  TranslationResult,
  buildTranslationResult,
  joinSegmentsForPrompt,
  splitTranslatedPayload
} from '@ja-to-en/domain';

type HttpMethod = 'POST';

type LMStudioClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  defaultModel: string;
  defaultTemperature?: number;
};

type ChatCompletionPayload = {
  model: string;
  temperature: number;
  max_tokens: number;
  messages: Array<{
    role: 'system' | 'user';
    content: string;
  }>;
};

type ChatCompletionResponse = {
  choices: Array<{
    message?: {
      role: string;
      content?: string;
    };
  }>;
};

type LMStudioClientErrorCode =
  | 'network'
  | 'rate-limit'
  | 'server'
  | 'invalid-response'
  | 'unauthorized';

export class LMStudioClientError extends Error {
  readonly code: LMStudioClientErrorCode;
  readonly status?: number;
  readonly retryAfter?: number;

  constructor(code: LMStudioClientErrorCode, message: string, status?: number, retryAfter?: number) {
    super(message);
    this.name = 'LMStudioClientError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const DEFAULT_BASE_URL = 'http://localhost:1234/v1';
const SYSTEM_PROMPT =
  'Translate strictly. Return exactly N segments separated by U+241E (␞). Do not add or remove segments. Preserve punctuation and newlines. No commentary.';

export class LMStudioClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultTemperature: number;
  private readonly defaultModel: string;
  private readonly concurrency = 2;
  private inflight = 0;
  private readonly queue: Array<() => void> = [];

  constructor(options: LMStudioClientOptions) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel;
    this.defaultTemperature = options.defaultTemperature ?? 0.2;
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const model = request.params.model || this.defaultModel;
    const temperature = request.params.temperature ?? this.defaultTemperature;
    const payload: ChatCompletionPayload = {
      model,
      temperature,
      max_tokens: request.params.maxTokens,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: joinSegmentsForPrompt(request.segments) }
      ]
    };

    const response = await this.requestWithRetry(() =>
      this.send('POST', '/chat/completions', payload)
    );
    const firstChoice = response.choices.at(0);
    const content = firstChoice?.message?.content;

    if (!content) {
      throw new LMStudioClientError(
        'invalid-response',
        'LM Studio returned an empty response payload.'
      );
    }

    const translatedSegments = splitTranslatedPayload(content, request.segments.length);
    return buildTranslationResult(request, translatedSegments);
  }

  private async requestWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    const attempt = async (n: number): Promise<T> => {
      try {
        return await this.withRateLimit(fn);
      } catch (error) {
        if (!(error instanceof LMStudioClientError)) throw error;
        if (n >= 2) throw error;
        let delay = 500 * 2 ** n;
        if (error.code === 'rate-limit' && error.retryAfter) {
          delay = error.retryAfter * 1000;
        }
        await sleep(delay);
        return attempt(n + 1);
      }
    };
    return attempt(0);
  }

  private async withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inflight >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.inflight += 1;
    try {
      const result = await fn();
      return result;
    } finally {
      this.inflight -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  private async send(method: HttpMethod, path: string, body: unknown): Promise<ChatCompletionResponse> {
    const url = new URL(path, this.baseUrl);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.buildHeaders(),
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new LMStudioClientError(
        'network',
        error instanceof Error ? error.message : 'Failed to reach LM Studio.'
      );
    }

    if (response.status === 401) {
      throw new LMStudioClientError('unauthorized', 'LM Studio rejected the API key.', 401);
    }

    if (response.status === 429) {
      throw new LMStudioClientError(
        'rate-limit',
        'LM Studio rate limit exceeded.',
        response.status,
        parseRetryAfter(response.headers.get('retry-after'))
      );
    }

    if (response.status >= 500) {
      throw new LMStudioClientError(
        'server',
        `LM Studio returned ${response.status}.`,
        response.status,
        parseRetryAfter(response.headers.get('retry-after'))
      );
    }

    if (!response.ok) {
      throw new LMStudioClientError(
        'invalid-response',
        `LM Studio returned unexpected status ${response.status}.`,
        response.status
      );
    }

    try {
      return (await response.json()) as ChatCompletionResponse;
    } catch (error) {
      throw new LMStudioClientError(
        'invalid-response',
        error instanceof Error ? error.message : 'Failed to parse LM Studio response.'
      );
    }
  }

  private buildHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }
}

const parseRetryAfter = (value: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }

  const delay = Number.parseInt(value, 10);
  return Number.isFinite(delay) ? delay : undefined;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
