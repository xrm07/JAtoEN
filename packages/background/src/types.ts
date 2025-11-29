/**
 * Shared types for background service worker messaging
 */

export type LangPair = { src: 'en' | 'ja'; dst: 'en' | 'ja' };

export type MsgTranslateSelection = {
  type: 'translate.selection';
  id: string;
  text: string;
  pair: LangPair;
};

export type MsgTranslatePage = {
  type: 'translate.page';
  id: string;
  segments: Array<{ id: string; text: string; path: string }>;
  pair: LangPair;
};

export type MsgTranslationResult = {
  type: 'translate.result';
  id: string;
  items: Array<{ id: string; translated: string }>;
};

export type MsgProgress = {
  type: 'translate.progress';
  id: string;
  done: number;
  total: number;
};

export type BackgroundMessage = MsgTranslateSelection | MsgTranslatePage;

export type RuntimeConfig = {
  model: string;
  maxTokens: number;
  temperature: number;
  endpoint?: 'chat/completions' | 'responses';
};

export type StoredSettings = Partial<RuntimeConfig> & {
  baseUrl?: string;
  apiKey?: string;
};

