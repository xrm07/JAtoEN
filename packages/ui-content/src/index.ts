import { isValidSelection } from '@ja-to-en/domain';
import {
  withBody,
  ensureButton,
  hideOverlays,
  showButton,
  showTooltip,
  updateProgress,
  hideProgress
} from './overlays';

// Early boot log (before body)
// eslint-disable-next-line no-console
console.log('[xt] cs:init state=', document.readyState);
declare global {
  interface Window {
    __xtInit?: boolean;
  }
}

let currentSelection: Selection | null = null;
const nodeMap = new Map<string, Text>();

const initOnce = () => {
  ensureButton().addEventListener('click', handleClick);
  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('keyup', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      hideOverlays();
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'content.startPageTranslation') {
      void startFullPageTranslation();
      return;
    }
    if (message?.type === 'content.translateSelection') {
      handleClick();
      return;
    }
    if (message && typeof message === 'object' && 'type' in message) {
      handleRuntimeMessage(message as IncomingMessage);
    }
  });
  // Testing hook: allow the page to dispatch a custom event to start full-page translation
  window.addEventListener('xt:translate-page', () => {
    void startFullPageTranslation();
  });
};

const handleMouseUp = (event: MouseEvent) => {
  currentSelection = document.getSelection();
  const text = currentSelection?.toString().trim();
  if (text && isValidSelection(text)) {
    showButton(event.clientX + 12, event.clientY + 12);
  } else {
    hideOverlays();
  }
};

const handleClick = () => {
  const text = currentSelection?.toString().trim();
  if (!text || !isValidSelection(text)) {
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

type MsgTranslateProgress = {
  type: 'translate.progress';
  id: string;
  done: number;
  total: number;
};
type MsgTranslateResult = {
  type: 'translate.result';
  id: string;
  items: Array<{ id: string; translated: string }>;
};
type IncomingMessage = MsgTranslateProgress | MsgTranslateResult | { type: string };

const handleRuntimeMessage = (message: IncomingMessage) => {
  if (message.type === 'translate.progress') {
    updateProgress(message.done, message.total);
    return;
  }

  if (message.type === 'translate.result') {
    if (message.items.length && currentSelection?.rangeCount) {
      const range = currentSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showTooltip(message.items[0]?.translated ?? '', rect.left, rect.top);
    }

    // Page translation result: replace mapped nodes
    for (const item of message.items) {
      const node = nodeMap.get(item.id);
      if (node) node.textContent = item.translated;
    }
    hideProgress();
  }
};

if (!window.__xtInit) {
  window.__xtInit = true;
  withBody(() => {
    try {
      initOnce();
      // eslint-disable-next-line no-console
      console.log('[xt] content script boot:', location.href);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[xt] init error:', (e as Error)?.message || e);
    }
  });
}

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
