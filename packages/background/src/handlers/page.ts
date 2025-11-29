/**
 * Handler for page translation messages
 */
import { createTranslationRequest } from '@ja-to-en/domain';
import type { TranslationService } from '../services/translation-service';
import type { MsgTranslatePage, MsgTranslationResult, MsgProgress } from '../types';

export const handlePageTranslation = async (
  message: MsgTranslatePage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MsgTranslationResult | MsgProgress | { error: string }) => void,
  service: TranslationService
): Promise<void> => {
  if (message.segments.length === 0) {
    sendResponse({
      type: 'translate.result',
      id: message.id,
      items: []
    });
    return;
  }

  // Send initial progress
  if (sender.tab?.id) {
    chrome.tabs.sendMessage(sender.tab.id, {
      type: 'translate.progress',
      id: message.id,
      done: 0,
      total: message.segments.length
    } satisfies MsgProgress);
  }

  const config = service.getConfig();
  const request = createTranslationRequest(
    message.id,
    message.segments.map((segment) => ({
      id: segment.id,
      text: segment.text
    })),
    message.pair,
    {
      model: config.model,
      maxTokens: config.maxTokens,
      temperature: config.temperature
    }
  );

  try {
    const translatedItems = await service.translatePageBatch(
      request,
      (done, total) => {
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'translate.progress',
            id: message.id,
            done,
            total
          } satisfies MsgProgress);
        }
      }
    );

    const finalResult: MsgTranslationResult = {
      type: 'translate.result',
      id: message.id,
      items: translatedItems
    };

    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, finalResult);
    }
    sendResponse(finalResult);
  } catch (error) {
    sendResponse({ error: service.serializeError(error) });
  }
};

