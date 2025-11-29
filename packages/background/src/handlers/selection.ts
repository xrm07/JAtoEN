/**
 * Handler for selection translation messages.
 *
 * Receives a translate.selection message from content scripts or the popup,
 * delegates to TranslationService, and forwards the result back via sendResponse.
 * When a sender tab is available, the result is also broadcast to that tab so
 * the content script can update its overlays.
 */
import type { TranslationService } from '../services/translation-service';
import type { MsgTranslateSelection, MsgTranslationResult } from '../types';

export const handleSelection = async (
  message: MsgTranslateSelection,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MsgTranslationResult | { error: string }) => void,
  service: TranslationService
): Promise<void> => {
  try {
    console.info('[xt][translate] start selection', {
      id: message.id,
      textLength: message.text.length,
      model: service.getConfig().model,
      endpoint: service.getConfig().endpoint ?? 'chat/completions',
      baseUrl: service.getBaseUrl() ?? 'default'
    });

    const result = await service.translateSelection(message.id, message.text, message.pair);

    console.info('[xt][translate] success selection', {
      id: message.id,
      items: result.items.length
    });

    const response: MsgTranslationResult = {
      type: 'translate.result',
      id: message.id,
      items: result.items
    };

    // Broadcast to content script for overlay handling
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, response);
    }
    sendResponse(response);
  } catch (error) {
    console.error('[xt][translate] error selection', error);
    sendResponse({ error: service.serializeError(error) });
  }
};

