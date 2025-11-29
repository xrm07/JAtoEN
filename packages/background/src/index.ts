/**
 * Background service worker entry point
 * Orchestrates translation messages, settings, and browser integration
 */
import { TranslationService } from './services/translation-service';
import { handleSelection } from './handlers/selection';
import { handlePageTranslation } from './handlers/page';
import type {
  BackgroundMessage,
  MsgTranslationResult,
  MsgProgress,
  StoredSettings,
  RuntimeConfig
} from './types';

// Default runtime configuration
const DEFAULT_CONFIG: RuntimeConfig = {
  model: 'lmstudio/translate-enja',
  maxTokens: 1024,
  temperature: 0.2,
  endpoint: 'chat/completions'
};

// Initialize translation service
const translationService = new TranslationService(DEFAULT_CONFIG);

// Message handler dispatcher
const handleMessage = async (
  message: BackgroundMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MsgTranslationResult | MsgProgress | { error: string }) => void
): Promise<void> => {
  if (message.type === 'translate.selection') {
    await handleSelection(message, sender, sendResponse, translationService);
    return;
  }

  if (message.type === 'translate.page') {
    await handlePageTranslation(message, sender, sendResponse, translationService);
    return;
  }

  // Fallback for unexpected message types
  sendResponse({ error: 'Unrecognized message type' });
};

// Single runtime.onMessage listener to handle all background messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'stats.get') {
    void translationService
      .getStats()
      .then((stats) => {
        sendResponse({ type: 'stats.result', stats });
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[xt][stats] getStats failed', error);
        sendResponse({
          type: 'stats.error',
          error: error instanceof Error ? error.message : String(error)
        });
      });
    return true;
  }

  if (message && typeof message.type === 'string' && message.type.startsWith('translate.')) {
    void handleMessage(message as BackgroundMessage, sender, sendResponse);
    return true;
  }

  return false;
});

// Load persisted settings
const loadSettings = async () => {
  try {
    const data = await chrome.storage.local.get(['xt-settings']);
    const s = data['xt-settings'] as StoredSettings | undefined;
    if (s) {
      translationService.updateConfig({
        model: s.model,
        maxTokens: s.maxTokens,
        temperature: s.temperature,
        endpoint: s.endpoint,
        baseUrl: s.baseUrl,
        apiKey: s.apiKey
      });
    }
  } catch {
    // ignore
  }
};

void loadSettings();

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['xt-settings']) {
    const s = changes['xt-settings'].newValue as StoredSettings | undefined;
    if (s) {
      translationService.updateConfig({
        model: s.model,
        maxTokens: s.maxTokens,
        temperature: s.temperature,
        endpoint: s.endpoint,
        baseUrl: s.baseUrl,
        apiKey: s.apiKey
      });
    }
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
  try {
    chrome.contextMenus.removeAll();
  } catch {
    /* noop */
  }
  chrome.contextMenus.create({
    id: 'xt-translate-selection',
    title: 'Translate selection',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'xt-translate-page',
    title: 'Translate entire page',
    contexts: ['page']
  });
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

// Export for testing
export { translationService, handleMessage };
