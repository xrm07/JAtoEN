import { Segmenter } from '@ja-to-en/domain';

const BUTTON_ID = 'xt-selection-button';
const TOOLTIP_ID = 'xt-translation-tooltip';

const segmenter = new Segmenter();
let currentSelection: Selection | null = null;

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

const hideOverlays = () => {
  ensureButton().style.display = 'none';
  ensureTooltip().style.display = 'none';
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

  const segments = segmenter.split(text);
  if (segments.length === 0) {
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
  message: { type: string; id: string; items?: Array<{ translated: string }> }
) => {
  if (message.type !== 'translate.result' || !message.items?.length) {
    return;
  }
  const range = currentSelection?.rangeCount ? currentSelection.getRangeAt(0) : undefined;
  if (!range) {
    return;
  }

  const rect = range.getBoundingClientRect();
  showTooltip(message.items[0]?.translated ?? '', rect.left, rect.top);
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
