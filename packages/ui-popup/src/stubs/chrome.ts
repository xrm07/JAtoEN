/* eslint-disable @typescript-eslint/no-explicit-any */

// Minimal Chrome API stub for dev server usage (non-extension context)
// Provides runtime.sendMessage/onMessage and storage.local used by PopupApp

type SendResponse = (response: any) => void;

const messageListeners: Array<(
  message: any,
  sender: any,
  sendResponse: SendResponse
) => void> = [];

const storageChangeListeners: Array<(
  changes: any,
  area: string
) => void> = [];

const SETTINGS_KEY = 'xt-settings';

const storage = {
  local: {
    async get(_keys?: string[] | Record<string, any>): Promise<Record<string, any>> {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        const value = raw ? JSON.parse(raw) : null;
        return { 'xt-settings': value };
      } catch {
        return { 'xt-settings': null };
      }
    },
    async set(obj: Record<string, any>) {
      if (Object.prototype.hasOwnProperty.call(obj, 'xt-settings')) {
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj['xt-settings']));
        } catch {
          // ignore
        }
        const change = { 'xt-settings': { newValue: obj['xt-settings'] } };
        for (const listener of storageChangeListeners) {
          try {
            listener(change, 'local');
          } catch {
            // ignore
          }
        }
      }
    },
  },
  onChanged: {
    addListener(cb: (changes: any, area: string) => void) {
      storageChangeListeners.push(cb);
    },
    removeListener(cb: (changes: any, area: string) => void) {
      const idx = storageChangeListeners.indexOf(cb);
      if (idx >= 0) storageChangeListeners.splice(idx, 1);
    },
  },
};

const runtime = {
  onMessage: {
    addListener(cb: (message: any, sender: any, sendResponse: SendResponse) => void) {
      messageListeners.push(cb);
    },
    removeListener(cb: (message: any, sender: any, sendResponse: SendResponse) => void) {
      const idx = messageListeners.indexOf(cb);
      if (idx >= 0) messageListeners.splice(idx, 1);
    },
  },
  async sendMessage(message: any): Promise<any> {
    if (message?.type === 'translate.selection') {
      const text = typeof message.text === 'string' ? message.text : '';
      const translated = `【mock】${text ? ' ' : ''}${text}`;
      const res = {
        type: 'translate.result',
        id: message.id,
        items: [{ id: message.id, translated }],
      };
      // Also notify any listeners to mimic background→content broadcast
      for (const listener of messageListeners) {
        try {
          listener(res, {}, () => {});
        } catch {
          // ignore
        }
      }
      return res;
    }
    if (message?.type === 'stats.get') {
      return { type: 'stats.result', stats: { entries: 0, estimatedBytes: 0, hits: 0, misses: 0 } };
    }
    return { error: 'unsupported message in dev stub' };
  },
};

const contextMenus = {
  create() {},
  removeAll() {},
  onClicked: { addListener() {} },
};

const commands = {
  onCommand: { addListener() {} },
};

const tabs = {
  sendMessage() {},
};

(window as any).chrome = {
  runtime,
  storage,
  contextMenus,
  commands,
  tabs,
};

export {};


