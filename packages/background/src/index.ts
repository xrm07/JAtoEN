import {
  Segmenter,
  TranslationRequest,
  createTranslationRequest
} from '@ja-to-en/domain';
import {
  CacheValue,
  buildCacheKey,
  estimateBytes,
  createCacheRepository
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

type StoredSettings = Partial<RuntimeConfig> & {
  baseUrl?: string;
  apiKey?: string;
};

const runtimeConfig: RuntimeConfig = {
  model: 'lmstudio/translate-enja',
  maxTokens: 1024,
  temperature: 0.2
};

const segmenter = new Segmenter();
const cache = createCacheRepository();

// LM Studio base URL uses the client's default when undefined
let lmBaseUrl: string | undefined;
let lmApiKey: string | undefined;

const getClient = (): LMStudioClient =>
  new LMStudioClient({
    // When not provided, LMStudioClient falls back to http://localhost:1234/v1
    baseUrl: lmBaseUrl,
    apiKey: lmApiKey,
    defaultModel: runtimeConfig.model,
    defaultTemperature: runtimeConfig.temperature,
  });

const handleMessage = async (
  message: BackgroundMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MsgTranslationResult | MsgProgress | { error: string }) => void
): Promise<void> => {
  if (message.type === 'translate.selection') {
    await handleSelection(message, sender, sendResponse);
    return;
  }

  if (message.type === 'translate.page') {
    await handlePageTranslation(message, sender, sendResponse);
  }
};

const handleSelection = async (
  message: MsgTranslateSelection,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MsgTranslationResult | { error: string }) => void
) => {
  const segments = segmenter.split(message.text);
  if (segments.length === 0) {
    const result: MsgTranslationResult = { type: 'translate.result', id: message.id, items: [] };
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, result);
    }
    sendResponse(result);
    return;
  }

  const cacheKey = buildCacheKey(message.pair, message.text);
  const cached = await cache.get(cacheKey);
  if (cached) {
    const result: MsgTranslationResult = {
      type: 'translate.result',
      id: message.id,
      items: [
        {
          id: segments[0]?.id ?? message.id,
          translated: cached.translated
        }
      ]
    };
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, result);
    }
    sendResponse(result);
    return;
  }

  const request = createRequestFromSegments(message.id, message.pair, segments);
  await executeTranslation(
    request,
    cacheKey,
    (resp: MsgTranslationResult | { error: string }) => {
      // Broadcast to content script for overlay handling
      if ('type' in resp && sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, resp);
      }
      sendResponse(resp);
    }
  );
};

const handlePageTranslation = async (
  message: MsgTranslatePage,
  sender: chrome.runtime.MessageSender,
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

  if (sender.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, {
      type: 'translate.progress',
      id: message.id,
      done: 0,
      total: message.segments.length
    } satisfies MsgProgress);
  }

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
    // Batch to respect token limits; simple fixed size grouping for now
    const batchSize = 20;
    const translatedItems: Array<{ id: string; translated: string }> = [];
    const client = getClient();
    for (let i = 0; i < request.segments.length; i += batchSize) {
      const slice = request.segments.slice(i, i + batchSize);
      const req = createTranslationRequest(
        `${message.id}-${i / batchSize}`,
        slice,
        message.pair,
        request.params
      );
      const res = await client.translate(req);
      translatedItems.push(...res.items);
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'translate.progress',
          id: message.id,
          done: Math.min(i + batchSize, request.segments.length),
          total: request.segments.length
        } satisfies MsgProgress);
      }
    }
    const finalResult: MsgTranslationResult = { type: 'translate.result', id: message.id, items: translatedItems };
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, finalResult);
    }
    sendResponse(finalResult);
  } catch (error) {
    sendResponse({ error: serializeError(error) });
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
    const client = getClient();
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

// Single runtime.onMessage listener to handle all background messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'stats.get') {
    void cache.stats().then((s) => sendResponse({ type: 'stats.result', stats: s }));
    return true;
  }
  if (message && typeof message.type === 'string' && message.type.startsWith('translate.')) {
    void handleMessage(message as BackgroundMessage, sender, sendResponse as never);
    return true;
  }
  return false;
});

// Load persisted settings
const loadSettings = async () => {
  try {
    const data = await chrome.storage.local.get(['xt-settings']);
    const s = data['xt-settings'] as StoredSettings | undefined;
    if (s?.model) runtimeConfig.model = s.model as string;
    if (typeof s?.maxTokens === 'number') runtimeConfig.maxTokens = s.maxTokens;
    if (typeof s?.temperature === 'number') runtimeConfig.temperature = s.temperature;
    lmBaseUrl = typeof s?.baseUrl === 'string' && s.baseUrl.trim() ? s.baseUrl.trim() : undefined;
    lmApiKey = typeof s?.apiKey === 'string' && s.apiKey.trim() ? s.apiKey.trim() : undefined;
  } catch {
    // ignore
  }
};

void loadSettings();

// Content script is declared in the manifest (document_start); no programmatic
// injection paths are needed in production.

// In production builds, LM base URL is the client default (Options can override in future).

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['xt-settings']) {
    const s = changes['xt-settings'].newValue as StoredSettings | undefined;
    if (s?.model) runtimeConfig.model = s.model as string;
    if (typeof s?.maxTokens === 'number') runtimeConfig.maxTokens = s.maxTokens;
    if (typeof s?.temperature === 'number') runtimeConfig.temperature = s.temperature;
    lmBaseUrl = typeof s?.baseUrl === 'string' && s.baseUrl.trim() ? s.baseUrl.trim() : undefined;
    lmApiKey = typeof s?.apiKey === 'string' && s.apiKey.trim() ? s.apiKey.trim() : undefined;
  }
});

// Keyboard shortcuts (commands)
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === 'translate-selection') {
    chrome.tabs.sendMessage(tab.id, { type: 'content.translateSelection' });
  }
  if (command === 'translate-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'content.startPageTranslation' });
  }
});

// Context menu entries
chrome.runtime.onInstalled.addListener(() => {
  try { chrome.contextMenus.removeAll(); } catch { /* noop */ }
  chrome.contextMenus.create({ id: 'xt-translate-selection', title: 'Translate selection', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'xt-translate-page', title: 'Translate entire page', contexts: ['page'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'xt-translate-selection') {
    chrome.tabs.sendMessage(tab.id, { type: 'content.translateSelection' });
  }
  if (info.menuItemId === 'xt-translate-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'content.startPageTranslation' });
  }
});
// (stats.get handled in unified onMessage above)
