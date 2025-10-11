// Removed dependency on '@ja-to-en/domain'

const BUTTON_ID = 'xt-selection-button';
const TOOLTIP_ID = 'xt-translation-tooltip';

let currentSelection: Selection | null = null;
let progressEl: HTMLDivElement | null = null;
const nodeMap = new Map<string, Text>();

const ensureButton = (): HTMLButtonElement => {
  const existing = document.querySelector<HTMLButtonElement>(`[data-xt-id="${BUTTON_ID}"]`);
  if (existing) {
    return existing;
  }

  const button = document.createElement('button');
  button.dataset.xtId = BUTTON_ID;
  button.dataset.xtRole = 'translate-trigger';
  button.type = 'button';
  button.textContent = '翻訳';
  button.style.position = 'fixed';
  button.style.padding = '4px 8px';
  button.style.zIndex = '2147483646';
  button.style.fontSize = '12px';
  button.style.display = 'none';
  button.style.cursor = 'pointer';
  document.body.appendChild(button);
  return button;
};

const ensureTooltip = (): HTMLDivElement => {
  const existing = document.querySelector<HTMLDivElement>(`[data-xt-id="${TOOLTIP_ID}"]`);
  if (existing) {
    return existing;
  }

  const tooltip = document.createElement('div');
  tooltip.dataset.xtId = TOOLTIP_ID;
  tooltip.dataset.xtRole = 'translate-result';
  tooltip.style.position = 'fixed';
  tooltip.style.maxWidth = '320px';
  tooltip.style.padding = '8px';
  tooltip.style.borderRadius = '6px';
  tooltip.style.background = '#1f2933';
  tooltip.style.color = '#fff';
  tooltip.style.fontSize = '12px';
  tooltip.style.lineHeight = '1.4';
  tooltip.style.display = 'none';
  tooltip.style.zIndex = '2147483647';
  document.body.appendChild(tooltip);
  return tooltip;
};

const ensureProgress = (): HTMLDivElement => {
  if (progressEl) return progressEl;
  const el = document.createElement('div');
  el.dataset.xtRole = 'xt-progress';
  el.style.display = 'none';
  document.body.appendChild(el);
  progressEl = el;
  return el;
};

const hideOverlays = () => {
  ensureButton().style.display = 'none';
  ensureTooltip().style.display = 'none';
  if (progressEl) progressEl.style.display = 'none';
};

const showButton = (x: number, y: number) => {
  const button = ensureButton();
  button.style.left = `${x}px`;
  button.style.top = `${y}px`;
  button.style.display = 'block';
};

const showTooltip = (text: string, x: number, y: number) => {
  const tooltip = ensureTooltip();
  tooltip.textContent = text;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y + 24}px`;
  tooltip.style.display = 'block';
};

const handleMouseUp = (event: MouseEvent) => {
  currentSelection = document.getSelection();
  const text = currentSelection?.toString().trim();
  if (text && text.length > 0) {
    showButton(event.clientX + 12, event.clientY + 12);
  } else {
    hideOverlays();
  }
};

const handleClick = () => {
  const text = currentSelection?.toString().trim();
  if (!text) {
    return;
  }

  const id = `selection-${Date.now()}`;
  void chrome.runtime.sendMessage({
    type: 'translate.selection',
    id,
    text,
    pair: { src: 'ja', dst: 'en' }
  });
};

const handleRuntimeMessage = (
  message: { type: string; id: string; items?: Array<{ translated: string }> ; done?: number; total?: number }
) => {
  if (message.type === 'translate.progress') {
    const el = ensureProgress();
    el.textContent = `Translating ${message.done}/${message.total}`;
    el.style.display = 'block';
    return;
  }

  if (message.type === 'translate.result') {
    if (message.items?.length && currentSelection?.rangeCount) {
      const range = currentSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showTooltip(message.items[0]?.translated ?? '', rect.left, rect.top);
    }

    // Page translation result: replace mapped nodes
    for (const item of message.items ?? []) {
      const node = nodeMap.get(item.id);
      if (node) node.textContent = item.translated;
    }
    if (progressEl) progressEl.style.display = 'none';
  }
};

ensureButton().addEventListener('click', handleClick);
document.addEventListener('mouseup', handleMouseUp);
document.addEventListener('keyup', (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    hideOverlays();
  }
});
chrome.runtime.onMessage.addListener((message) => {
  handleRuntimeMessage(message as never);
});

// Commands from background
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'content.startPageTranslation') {
    void startFullPageTranslation();
  }
  if (message?.type === 'content.translateSelection') {
    handleClick();
  }
});

const startFullPageTranslation = async () => {
  nodeMap.clear();
  const segments: { id: string; text: string; path: string }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node: Node) => {
      if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'textarea', 'input'].includes(tag)) {
        return NodeFilter.FILTER_REJECT;
      }
      const text = node.textContent?.trim() ?? '';
      if (text.length <= 0) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  } as never);

  let index = 0;
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      const id = `seg-${index.toString().padStart(4, '0')}`;
      nodeMap.set(id, current);
      segments.push({ id, text: current.textContent ?? '', path: getNodePath(current) });
      index += 1;
    }
    current = walker.nextNode();
  }

  const id = `page-${Date.now()}`;
  await chrome.runtime.sendMessage({
    type: 'translate.page',
    id,
    segments,
    pair: { src: 'ja', dst: 'en' }
  });
};

const getNodePath = (node: Node): string => {
  const parts: string[] = [];
  let n: Node | null = node;
  while (n && n !== document.body) {
    const parent = n.parentNode;
    if (!parent) break;
    const index = Array.prototype.indexOf.call(parent.childNodes, n);
    parts.push(String(index));
    n = parent;
  }
  return parts.reverse().join('/');
};
