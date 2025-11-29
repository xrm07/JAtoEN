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
  endpoint?: 'chat/completions' | 'responses';
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

type ResponsesApiMessageContent =
  | { type: 'output_text'; text: string }
  | { type: 'input_text'; text: string }
  | { type: string; [k: string]: unknown };

type ResponsesApiResponse = {
  output_text?: string;
  response?: {
    output?: Array<ResponsesApiMessageContent>;
  };
  choices?: Array<{
    message?: { content?: string };
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

const DEFAULT_BASE_URL = 'http://localhost:1234/v1/';
const BASE_SYSTEM_PROMPT =
  'You are a professional machine translation engine. Follow the format rules exactly.';

export class LMStudioClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultTemperature: number;
  private readonly defaultModel: string;
  private readonly endpoint: 'chat/completions' | 'responses';
  private readonly concurrency = 2;
  private inflight = 0;
  private readonly queue: Array<() => void> = [];

  constructor(options: LMStudioClientOptions) {
    this.baseUrl = ensureTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL);
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel;
    this.defaultTemperature = options.defaultTemperature ?? 0.2;
    this.endpoint = options.endpoint ?? 'chat/completions';
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const model = request.params.model || this.defaultModel;
    const temperature = request.params.temperature ?? this.defaultTemperature;
    const systemMessage = buildSystemPrompt(request);
    const userContent = joinSegmentsForPrompt(request.segments);

    let payload: unknown;
    if (this.endpoint === 'responses') {
      payload = {
        model,
        temperature,
        max_output_tokens: request.params.maxTokens,
        input: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userContent }
        ]
      };
    } else {
      payload = {
        model,
        temperature,
        max_tokens: request.params.maxTokens,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userContent }
        ]
      } satisfies ChatCompletionPayload;
    }

    const response = (await this.requestWithRetry(() =>
      this.send('POST', this.endpoint, payload)
    )) as unknown;
    const content = extractTextFromResponse(response as ResponsesApiResponse);

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

  private async send(method: HttpMethod, path: string, body: unknown): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    let response: Response;
    try {
      // Debug logging for integration diagnosis
      if (typeof console !== 'undefined') {
        console.info('[lmstudio][request]', {
          url: url.href,
          method,
          model: (body as { model?: string })?.model,
          endpoint: this.endpoint
        });
      }
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
      if (typeof console !== 'undefined') {
        console.info('[lmstudio][response]', {
          url: url.href,
          status: response.status,
          endpoint: this.endpoint
        });
      }
      return (await response.json()) as unknown;
    } catch (error) {
      throw new LMStudioClientError(
        'invalid-response',
        error instanceof Error ? error.message : 'Failed to parse LM Studio response.'
      );
    }
  }

  private buildHeaders(): HeadersInit {
    return buildHeadersForApiKey(this.apiKey);
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

// --- Models listing API ---

type ModelsResponse = {
  data?: Array<{ id?: string }>;
};

const buildHeadersForApiKey = (apiKey?: string): HeadersInit => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
};

/**
 * Retrieve available model identifiers from LM Studio's OpenAI-compatible endpoint.
 * Falls back to DEFAULT_BASE_URL when baseUrl is not provided.
 */
export const listModels = async (options?: {
  baseUrl?: string;
  apiKey?: string;
}): Promise<string[]> => {
  const baseUrl = ensureTrailingSlash(options?.baseUrl ?? DEFAULT_BASE_URL);
  let response: Response;
  try {
    response = await fetch(new URL('models', baseUrl), {
      method: 'GET',
      headers: buildHeadersForApiKey(options?.apiKey)
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

  if (!response.ok) {
    throw new LMStudioClientError(
      'invalid-response',
      `LM Studio returned unexpected status ${response.status}.`,
      response.status
    );
  }

  let payload: ModelsResponse;
  try {
    payload = (await response.json()) as ModelsResponse;
  } catch (error) {
    throw new LMStudioClientError(
      'invalid-response',
      error instanceof Error ? error.message : 'Failed to parse LM Studio response.'
    );
  }

  const ids = Array.isArray(payload?.data)
    ? payload.data
        .map((m) => (typeof m?.id === 'string' ? m.id : undefined))
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  return ids;
};

const ensureTrailingSlash = (value: string): string => (value.endsWith('/') ? value : `${value}/`);

/**
 * Build the system prompt for LM Studio, using U+241E (␞) as a segment delimiter.
 *
 * U+241E is a rarely used visible separator chosen to avoid collisions with normal text.
 * Downstream code relies on this exact character to split and join translated segments,
 * so it must not be changed without updating the corresponding split/join logic.
 */
const buildSystemPrompt = (request: TranslationRequest): string => {
  const n = request.segments.length;
  const src = request.langPair.src;
  const dst = request.langPair.dst;
  return [
    BASE_SYSTEM_PROMPT,
    `Task: Translate from ${src} to ${dst}.`,
    `Return exactly N segments separated by U+241E (␞). N=${n}.`,
    'Rules:',
    '- Do not add or remove segments; keep order.',
    '- Output only the translated text segments; no commentary, no labels.',
    '- Use the delimiter exactly once between segments, no spaces around it.',
    '- Preserve punctuation and line breaks as appropriate; numbers unchanged.',
  ].join('\n');
};

const extractTextFromResponse = (res: ResponsesApiResponse): string | undefined => {
  // OpenAI chat-like
  const choiceContent = res?.choices?.[0]?.message?.content;
  if (typeof choiceContent === 'string' && choiceContent.length > 0) return choiceContent;

  // OpenAI Responses API shape (LM Studio may support output_text or response.output)
  if (typeof res?.output_text === 'string' && res.output_text.length > 0) return res.output_text;

  const outItems = res?.response?.output;
  if (Array.isArray(outItems) && outItems.length > 0) {
    const texts = outItems
      .map((item) => ('text' in item ? item.text : undefined))
      .filter((t): t is string => typeof t === 'string');
    if (texts.length > 0) return texts.join('');
  }
  return undefined;
};
