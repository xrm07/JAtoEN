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
