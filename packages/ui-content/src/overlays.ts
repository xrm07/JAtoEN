/**
 * Overlay UI components for content script
 * Manages translate button, tooltip, and progress indicator
 */

const BUTTON_ID = 'xt-selection-button';
const TOOLTIP_ID = 'xt-translation-tooltip';

export type OverlayElements = {
  button: HTMLButtonElement;
  tooltip: HTMLDivElement;
  progress: HTMLDivElement;
};

/**
 * Execute callback when document.body is available.
 * If body exists now, run immediately; otherwise wait for DOMContentLoaded.
 */
export const withBody = (fn: (body: HTMLElement) => void): void => {
  const run = () => {
    const body = document.body;
    if (body) fn(body);
  };
  if (document.body) {
    run();
  } else {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  }
};

/**
 * Create or retrieve the translate button element
 */
export const ensureButton = (): HTMLButtonElement => {
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
  withBody((body) => body.appendChild(button));
  return button;
};

/**
 * Create or retrieve the translation result tooltip
 */
export const ensureTooltip = (): HTMLDivElement => {
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
  withBody((body) => body.appendChild(tooltip));
  return tooltip;
};

/**
 * Create or retrieve the progress indicator
 */
export const ensureProgress = (): HTMLDivElement => {
  const existing = document.querySelector<HTMLDivElement>('[data-xt-role="xt-progress"]');
  if (existing) {
    return existing;
  }

  const el = document.createElement('div');
  el.dataset.xtRole = 'xt-progress';
  el.style.position = 'fixed';
  el.style.top = '10px';
  el.style.right = '10px';
  el.style.padding = '8px 12px';
  el.style.background = '#3b82f6';
  el.style.color = '#fff';
  el.style.borderRadius = '4px';
  el.style.fontSize = '12px';
  el.style.zIndex = '2147483647';
  el.style.display = 'none';
  withBody((body) => body.appendChild(el));
  return el;
};

/**
 * Hide all overlay elements
 */
export const hideOverlays = (): void => {
  ensureButton().style.display = 'none';
  ensureTooltip().style.display = 'none';
  const progress = document.querySelector<HTMLDivElement>('[data-xt-role="xt-progress"]');
  if (progress) progress.style.display = 'none';
};

/**
 * Show the translate button at specified position
 */
export const showButton = (x: number, y: number): void => {
  const button = ensureButton();
  button.style.left = `${x}px`;
  button.style.top = `${y}px`;
  button.style.display = 'block';
};

/**
 * Show the tooltip with translation result
 */
export const showTooltip = (text: string, x: number, y: number): void => {
  const tooltip = ensureTooltip();
  tooltip.textContent = text;
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y + 24}px`;
  tooltip.style.display = 'block';
};

/**
 * Update progress indicator
 */
export const updateProgress = (done: number, total: number): void => {
  const el = ensureProgress();
  el.textContent = `Translating ${done}/${total}`;
  el.style.display = 'block';
};

/**
 * Hide progress indicator
 */
export const hideProgress = (): void => {
  const progress = document.querySelector<HTMLDivElement>('[data-xt-role="xt-progress"]');
  if (progress) progress.style.display = 'none';
};

