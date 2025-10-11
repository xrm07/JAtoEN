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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim()) {
      return;
    }
    setIsTranslating(true);
    setOutput('');
    const id = `popup-${Date.now()}`;
    await chrome.runtime.sendMessage({
      type: 'translate.selection',
      id,
      text: input,
      pair
    });
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
