import { useEffect, useState } from 'react';
import { listModels } from '@ja-to-en/infra-lmstudio';

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
  const [endpoint, setEndpoint] = useState<'chat/completions' | 'responses'>('chat/completions');
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [isPageTranslating, setIsPageTranslating] = useState(false);

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
      setEndpoint(s.endpoint === 'responses' || s.endpoint === 'chat/completions' ? s.endpoint : 'chat/completions');
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

  // Load models from LM Studio when baseUrl/apiKey change or on first mount
  useEffect(() => {
    const run = async () => {
      setModelsLoading(true);
      setModelsError(null);
      try {
        const ids = await listModels({ baseUrl: baseUrl || undefined, apiKey: apiKey || undefined });
        const chatCapable = ids.filter((id) => !/embed|embedding/i.test(id));
        setModelOptions(chatCapable);
        if (chatCapable.length > 0 && !chatCapable.includes(model)) {
          setModel(chatCapable[0]!);
        }
      } catch (e) {
        setModelsError(e instanceof Error ? e.message : String(e));
      } finally {
        setModelsLoading(false);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, apiKey]);

  const handleReloadModels = async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const ids = await listModels({ baseUrl: baseUrl || undefined, apiKey: apiKey || undefined });
      const chatCapable = ids.filter((id) => !/embed|embedding/i.test(id));
      setModelOptions(chatCapable);
      if (chatCapable.length > 0 && !chatCapable.includes(model)) {
        setModel(chatCapable[0]!);
      }
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelsLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim()) {
      return;
    }
    setIsTranslating(true);
    setOutput('');
    const id = `popup-${Date.now()}`;
    try {
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
        return;
      }
      if (res?.error) {
        setOutput(`[Error] ${String(res.error)}`);
        return;
      }
      setOutput('[Error] Unexpected response from background script');
    } catch (error) {
      setOutput(`[Error] ${error instanceof Error ? error.message : 'Failed to send message'}`);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSwap = () => {
    setPair(({ src, dst }) => ({ src: dst, dst: src }));
  };

  const handleTranslatePage = async () => {
    setIsPageTranslating(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'content.startPageTranslation', pair });
      }
    } catch (error) {
      setOutput(`[Error] ${error instanceof Error ? error.message : 'Failed to start page translation'}`);
    } finally {
      setIsPageTranslating(false);
    }
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
        <button
          type="button"
          onClick={handleTranslatePage}
          disabled={isPageTranslating}
          style={{ marginTop: 8, width: '100%', padding: 8, background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          data-xt-role="translate-page-button"
        >
          {isPageTranslating ? 'ページ翻訳中...' : 'ページ全体を翻訳'}
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
          <div style={{ display: 'grid', gap: 4 }}>
          <label style={{ fontSize: 12 }}>
              モデル
              {modelOptions.length > 0 ? (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  style={{ width: '100%' }}
                  data-xt-role="settings-model-select"
                >
                  {modelOptions.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  style={{ width: '100%' }}
                  data-xt-role="settings-model-input"
                />
              )}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={handleReloadModels} data-xt-role="settings-reload-models">
                モデル再読込{modelsLoading ? '…' : ''}
              </button>
              {modelsError ? (
                <span style={{ fontSize: 12, color: '#b91c1c' }}>取得失敗: {modelsError}</span>
              ) : null}
            </div>
          </div>
          <label style={{ fontSize: 12 }}>
            API Endpoint
            <select value={endpoint} onChange={(e) => setEndpoint(e.target.value as any)} style={{ width: '100%' }} data-xt-role="settings-endpoint">
              <option value="chat/completions">/v1/chat/completions</option>
              <option value="responses">/v1/responses</option>
            </select>
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
            <input
              placeholder="http://localhost:1234/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              style={{ width: '100%' }}
              data-xt-role="settings-base-url"
            />
          </label>
          <label style={{ fontSize: 12 }}>
            API Key (optional)
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ width: '100%' }}
              data-xt-role="settings-api-key"
            />
          </label>
          <button type="button" onClick={() => chrome.storage.local.set({ 'xt-settings': { model, temperature, maxTokens, baseUrl, apiKey, endpoint } })}>
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
