import {
  Segmenter,
  TranslationRequest,
  createTranslationRequest
} from '@ja-to-en/domain';
import {
  CacheValue,
  MemoryCacheRepository,
  buildCacheKey,
  estimateBytes
} from '@ja-to-en/infra-cache';
import { LMStudioClient, LMStudioClientError } from '@ja-to-en/infra-lmstudio';

type LangPair = { src: 'en' | 'ja'; dst: 'en' | 'ja' };

type MsgTranslateSelection = {
  type: 'translate.selection';
  id: string;
  text: string;
  pair: LangPair;
};

type MsgTranslatePage = {
  type: 'translate.page';
  id: string;
  segments: Array<{ id: string; text: string; path: string }>;
  pair: LangPair;
};

type MsgTranslationResult = {
  type: 'translate.result';
  id: string;
  items: Array<{ id: string; translated: string }>;
};

type MsgProgress = {
  type: 'translate.progress';
  id: string;
  done: number;
  total: number;
};

type BackgroundMessage = MsgTranslateSelection | MsgTranslatePage;

type RuntimeConfig = {
  model: string;
  maxTokens: number;
  temperature: number;
};

const runtimeConfig: RuntimeConfig = {
  model: 'lmstudio/translate-enja',
  maxTokens: 1024,
  temperature: 0.2
};

const segmenter = new Segmenter();
const cache = new MemoryCacheRepository();
const client = new LMStudioClient({
  defaultModel: runtimeConfig.model,
  defaultTemperature: runtimeConfig.temperature
});

const handleMessage = async (
  message: BackgroundMessage,
  sendResponse: (response: MsgTranslationResult | MsgProgress | { error: string }) => void
): Promise<void> => {
  if (message.type === 'translate.selection') {
    await handleSelection(message, sendResponse);
    return;
  }

  if (message.type === 'translate.page') {
    await handlePageTranslation(message, sendResponse);
  }
};

const handleSelection = async (
  message: MsgTranslateSelection,
  sendResponse: (response: MsgTranslationResult | { error: string }) => void
) => {
  const segments = segmenter.split(message.text);
  if (segments.length === 0) {
    sendResponse({
      type: 'translate.result',
      id: message.id,
      items: []
    });
    return;
  }

  const cacheKey = buildCacheKey(message.pair, message.text);
  const cached = await cache.get(cacheKey);
  if (cached) {
    sendResponse({
      type: 'translate.result',
      id: message.id,
      items: [
        {
          id: segments[0]?.id ?? message.id,
          translated: cached.translated
        }
      ]
    });
    return;
  }

  const request = createRequestFromSegments(message.id, message.pair, segments);
  await executeTranslation(request, cacheKey, sendResponse);
};

const handlePageTranslation = async (
  message: MsgTranslatePage,
  sendResponse: (response: MsgTranslationResult | MsgProgress | { error: string }) => void
) => {
  if (message.segments.length === 0) {
    sendResponse({
      type: 'translate.result',
      id: message.id,
      items: []
    });
    return;
  }

  sendResponse({
    type: 'translate.progress',
    id: message.id,
    done: 0,
    total: message.segments.length
  });

  const request = createTranslationRequest(
    message.id,
    message.segments.map((segment) => ({
      id: segment.id,
      text: segment.text
    })),
    message.pair,
    {
      model: runtimeConfig.model,
      maxTokens: runtimeConfig.maxTokens,
      temperature: runtimeConfig.temperature
    }
  );

  try {
    const result = await client.translate(request);
    sendResponse(result);
  } catch (error) {
    sendResponse({
      error: serializeError(error)
    });
  }
};

const createRequestFromSegments = (
  id: string,
  pair: LangPair,
  segments: TranslationRequest['segments']
): TranslationRequest =>
  createTranslationRequest(
    id,
    segments,
    pair,
    {
      model: runtimeConfig.model,
      maxTokens: runtimeConfig.maxTokens,
      temperature: runtimeConfig.temperature
    }
  );

const executeTranslation = async (
  request: TranslationRequest,
  cacheKey: string,
  sendResponse: (response: MsgTranslationResult | { error: string }) => void
) => {
  try {
    const result = await client.translate(request);
    const combinedText = result.items.map((item) => item.translated).join('\n');
    const cacheValue: CacheValue = {
      key: cacheKey,
      langPair: `${request.langPair.src}:${request.langPair.dst}`,
      text: request.segments.map((segment) => segment.text).join('\n'),
      translated: combinedText,
      size: estimateBytes(combinedText),
      lastAccess: Date.now(),
      meta: {
        model: request.params.model,
        temperature: request.params.temperature,
        timestamp: Date.now(),
        hits: 0
      }
    };
    await cache.set(cacheValue);
    sendResponse(result);
  } catch (error) {
    sendResponse({
      error: serializeError(error)
    });
  }
};

const serializeError = (error: unknown): string => {
  if (error instanceof LMStudioClientError) {
    return `${error.code}:${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message as BackgroundMessage, sendResponse);
  return true;
});
