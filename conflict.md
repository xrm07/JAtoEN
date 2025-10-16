```manifest.json
{
  "manifest_version": 3,
  "name": "EN⇄JA Translator",
  "version": "0.2.0",
  "action": {
    "default_popup": "popup.html"
  },
  "permissions": [
    "storage",
    "contextMenus",
    "tabs"
  ],
  "host_permissions": [
    "http://localhost:1234/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "commands": {
    "translate-selection": {
      "suggested_key": {
        "default": "Alt+T"
      }
    },
    "translate-page": {
      "suggested_key": {
        "default": "Alt+Shift+T"
      }
    }
  },
  "content_scripts": [
    {
      "matches": [
        "http://*/*",
        "https://*/*"
      ],
      "js": [
        "content.js"
      ],
      "run_at": "document_start"
    }
  ],
  "web_accessible_resources": [
    
  ]
  ]
}
```

```assemble-extension.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const root = dirname(new URL(import.meta.url).pathname.replace(/^\/+/, '/'));
const pkgRoot = join(root, '..');

const outDir = join(pkgRoot, 'dist');
const manifestSrc = join(pkgRoot, 'public', 'manifest.json');
const backgroundJs = join(pkgRoot, 'dist', 'background.js');
const contentJs = join(pkgRoot, '..', 'ui-content', 'dist', 'content.js');
// const overlayCss = join(pkgRoot, '..', 'ui-content', 'src', 'overlay.css');
const popupDist = join(pkgRoot, '..', 'ui-popup', 'dist');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// Copy manifest
if (existsSync(manifestSrc)) {
  cpSync(manifestSrc, join(outDir, 'manifest.json'));
}

// Ensure background.js exists (built by tsup)
if (!existsSync(backgroundJs)) {
  console.warn('[assemble] background.js not found. Build background first.');
}

// Copy content.js from ui-content build (hard requirement)
if (!existsSync(contentJs)) {
  throw new Error('[assemble] content.js not found. Ensure @ja-to-en/ui-content build ran before assembling.');
}
cpSync(contentJs, join(outDir, 'content.js'));

// Overlay CSS is currently unused; skip copying for a minimal bundle.

// Copy popup (vite build) as popup.html + assets/
if (existsSync(popupDist)) {
  const htmlPath = join(popupDist, 'index.html');
  if (existsSync(htmlPath)) {
    const html = readFileSync(htmlPath, 'utf8');
    const updated = html.replace(/<title>.*?<\/title>/, '<title>EN⇄JA Translator<\/title>');
    writeFileSync(join(outDir, 'popup.html'), updated);
  }
  // Copy assets dir if present
  const assetsDir = join(popupDist, 'assets');
  if (existsSync(assetsDir)) {
    cpSync(assetsDir, join(outDir, 'assets'), { recursive: true });
  }
} else {
  console.warn('[assemble] ui-popup dist not found. Skipping popup copy.');
}

console.log('[assemble] Extension artifacts prepared in', outDir);
```

```index.ts
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
    const s = data['xt-settings'] as (Partial<RuntimeConfig> & { baseUrl?: string; apiKey?: string }) | undefined;
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
    const s = changes['xt-settings'].newValue as (Partial<RuntimeConfig> & { baseUrl?: string; apiKey?: string }) | undefined;
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
```

```PopupApp.tsx
import { useEffect, useState } from 'react';

type HistoryEntry = {
  id: string;
  input: string;
  output: string;
  pair: string;
  createdAt: number;
};

const INITIAL_PAIR = { src: 'ja', dst: 'en' } as const;

export const PopupApp = () => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [pair, setPair] = useState(INITIAL_PAIR);
  const [isTranslating, setIsTranslating] = useState(false);
  const [model, setModel] = useState('lmstudio/translate-enja');
  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [stats, setStats] = useState<{ entries: number; estimatedBytes: number; hits: number; misses: number } | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    const listener = (message: { type: string; id: string; items?: Array<{ translated: string }> }) => {
      if (message.type !== 'translate.result') {
        return;
      }
      const translated = message.items?.map((item) => item.translated).join('\n') ?? '';
      setOutput(translated);
      setHistory((prev) => [
        {
          id: message.id,
          input,
          output: translated,
          pair: `${pair.src}/${pair.dst}`,
          createdAt: Date.now()
        },
        ...prev
      ]);
      setIsTranslating(false);
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [input, pair]);

  // Load settings
  useEffect(() => {
    void chrome.storage.local.get(['xt-settings']).then((res) => {
      const s = res['xt-settings'] as any;
      if (!s) return;
      setModel(s.model ?? model);
      setTemperature(Number(s.temperature ?? temperature));
      setMaxTokens(Number(s.maxTokens ?? maxTokens));
      setBaseUrl(typeof s.baseUrl === 'string' ? s.baseUrl : '');
      setApiKey(typeof s.apiKey === 'string' ? s.apiKey : '');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stats polling
  useEffect(() => {
    const id = setInterval(() => {
      void chrome.runtime.sendMessage({ type: 'stats.get' }).then((res) => {
        if (res?.type === 'stats.result') setStats(res.stats);
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim()) {
      return;
    }
    setIsTranslating(true);
    setOutput('');
    const id = `popup-${Date.now()}`;
    const res = await chrome.runtime.sendMessage({
      type: 'translate.selection',
      id,
      text: input,
      pair
    });
    if (res?.type === 'translate.result') {
      const translated = res.items?.map((item: { translated: string }) => item.translated).join('\n') ?? '';
      setOutput(translated);
      setHistory((prev) => [
        {
          id: res.id,
          input,
          output: translated,
          pair: `${pair.src}/${pair.dst}`,
          createdAt: Date.now()
        },
        ...prev
      ]);
      setIsTranslating(false);
      return;
    }
    if (res?.error) {
      setIsTranslating(false);
      setOutput(`[Error] ${String(res.error)}`);
    }
  };

  const handleSwap = () => {
    setPair(({ src, dst }) => ({ src: dst, dst: src }));
  };

  return (
    <div data-xt-role="popup-root" style={{ width: 360, padding: 16, fontFamily: 'sans-serif' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>EN⇄JA Translator</h1>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#4b5563' }}>
          Powered by LM Studio at http://localhost:1234/v1
        </p>
      </header>
      <form onSubmit={handleSubmit} data-xt-role="popup-form">
        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          入力テキスト
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            style={{
              display: 'block',
              width: '100%',
              minHeight: 96,
              marginTop: 4,
              padding: 8,
              resize: 'vertical'
            }}
            data-xt-role="popup-input"
          />
        </label>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12 }}>
            {pair.src.toUpperCase()} → {pair.dst.toUpperCase()}
          </span>
          <button type="button" onClick={handleSwap} data-xt-role="swap-button">
            言語入替
          </button>
        </div>
        <button
          type="submit"
          disabled={isTranslating}
          style={{ marginTop: 12, width: '100%', padding: 8 }}
          data-xt-role="translate-button"
        >
          {isTranslating ? '翻訳中...' : '翻訳'}
        </button>
      </form>
      <section style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, marginBottom: 8 }}>翻訳結果</h2>
        <div
          data-xt-role="popup-output"
          style={{
            minHeight: 96,
            padding: 8,
            border: '1px solid #d1d5db',
            borderRadius: 4,
            background: '#f9fafb'
          }}
        >
          {output || '結果がここに表示されます'}
        </div>
      </section>
      <section style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, marginBottom: 8 }}>設定</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 12 }}>
            モデル
            <input value={model} onChange={(e) => setModel(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label style={{ fontSize: 12 }}>
            Temperature
            <input type="number" step="0.1" value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))} style={{ width: '100%' }} />
          </label>
          <label style={{ fontSize: 12 }}>
            Max tokens
            <input type="number" value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))} style={{ width: '100%' }} />
          </label>
          <label style={{ fontSize: 12 }}>
            LM Studio Base URL
            <input placeholder="http://localhost:1234/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={{ width: '100%' }} />
          </label>
          <label style={{ fontSize: 12 }}>
            API Key (optional)
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={{ width: '100%' }} />
          </label>
          <button type="button" onClick={() => chrome.storage.local.set({ 'xt-settings': { model, temperature, maxTokens, baseUrl, apiKey } })}>
            保存
          </button>
        </div>
      </section>
      <section style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, marginBottom: 8 }}>統計</h2>
        <div style={{ fontSize: 12, color: '#374151' }}>
          {stats ? (
            <>
              <div>Entries: {stats.entries}</div>
              <div>Estimated bytes: {stats.estimatedBytes}</div>
              <div>Hits: {stats.hits} / Misses: {stats.misses}</div>
            </>
          ) : '—'}
        </div>
      </section>
      <section style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, marginBottom: 8 }}>履歴</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {history.map((entry) => (
            <li key={entry.id} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {entry.pair}・{new Date(entry.createdAt).toLocaleString()}
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>入力: {entry.input}</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>出力: {entry.output}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
```
