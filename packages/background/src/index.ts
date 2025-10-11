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

const runtimeConfig: RuntimeConfig = {
  model: 'lmstudio/translate-enja',
  maxTokens: 1024,
  temperature: 0.2
};

const segmenter = new Segmenter();
const cache = createCacheRepository();
const client = new LMStudioClient({
  defaultModel: runtimeConfig.model,
  defaultTemperature: runtimeConfig.temperature
});

const handleMessage = async (
  message: BackgroundMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MsgTranslationResult | MsgProgress | { error: string }) => void
): Promise<void> => {
  if (message.type === 'translate.selection') {
    await handleSelection(message, sendResponse);
    return;
  }

  if (message.type === 'translate.page') {
    await handlePageTranslation(message, sender, sendResponse);
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
    sendResponse({ type: 'translate.result', id: message.id, items: translatedItems });
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message as BackgroundMessage, sender, sendResponse);
  return true;
});

// Load persisted settings
const loadSettings = async () => {
  try {
    const data = await chrome.storage.local.get(['xt-settings']);
    const s = data['xt-settings'] as Partial<RuntimeConfig> | undefined;
    if (s?.model) runtimeConfig.model = s.model as string;
    if (typeof s?.maxTokens === 'number') runtimeConfig.maxTokens = s.maxTokens;
    if (typeof s?.temperature === 'number') runtimeConfig.temperature = s.temperature;
  } catch {
    // ignore
  }
};

void loadSettings();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['xt-settings']) {
    const s = changes['xt-settings'].newValue as Partial<RuntimeConfig> | undefined;
    if (s?.model) runtimeConfig.model = s.model as string;
    if (typeof s?.maxTokens === 'number') runtimeConfig.maxTokens = s.maxTokens;
    if (typeof s?.temperature === 'number') runtimeConfig.temperature = s.temperature;
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

// Stats endpoint for popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'stats.get') {
    void cache.stats().then((s) => sendResponse({ type: 'stats.result', stats: s }));
    return true;
  }
  return undefined;
});
