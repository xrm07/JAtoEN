const SEGMENT_DELIMITER = '\u241E';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 512;

type SupportedLanguage = 'en' | 'ja';

export type LanguagePair = {
  src: SupportedLanguage;
  dst: SupportedLanguage;
};

export type TextSegment = {
  id: string;
  text: string;
};

export type TranslationParams = {
  temperature?: number;
  maxTokens?: number;
  model?: string;
};

export type TranslationRequest = {
  id: string;
  segments: TextSegment[];
  langPair: LanguagePair;
  params: RequiredTranslationParams;
};

export type RequiredTranslationParams = {
  temperature: number;
  maxTokens: number;
  model: string;
};

export type TranslationResult = {
  id: string;
  items: Array<{
    id: string;
    translated: string;
  }>;
};

export const TRANSLATION_SEPARATOR = SEGMENT_DELIMITER;

export const DEFAULT_PARAMS: RequiredTranslationParams = {
  temperature: DEFAULT_TEMPERATURE,
  maxTokens: DEFAULT_MAX_TOKENS,
  model: 'lmstudio'
};

export const createTranslationRequest = (
  id: string,
  segments: TextSegment[],
  langPair: LanguagePair,
  params?: TranslationParams
): TranslationRequest => {
  if (segments.length === 0) {
    throw new Error('Translation request requires at least one segment.');
  }
  if (langPair.src === langPair.dst) {
    throw new Error('Source and destination languages must differ.');
  }

  const normalizedParams: RequiredTranslationParams = {
    temperature: params?.temperature ?? DEFAULT_PARAMS.temperature,
    maxTokens: params?.maxTokens ?? DEFAULT_PARAMS.maxTokens,
    model: params?.model ?? DEFAULT_PARAMS.model
  };

  if (!normalizedParams.model) {
    throw new Error('Model is required for translation.');
  }

  return {
    id,
    segments: segments.map((segment) => ({
      ...segment,
      text: normalizeText(segment.text)
    })),
    langPair,
    params: normalizedParams
  };
};

export const normalizeText = (value: string): string =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const joinSegmentsForPrompt = (segments: TextSegment[]): string =>
  segments.map((segment) => segment.text).join(SEGMENT_DELIMITER);

export const splitTranslatedPayload = (
  payload: string,
  expectedLength: number
): string[] => {
  const tokens = payload.split(SEGMENT_DELIMITER);
  if (tokens.length !== expectedLength) {
    throw new Error(
      `Segment count mismatch. expected=${expectedLength} actual=${tokens.length}`
    );
  }

  return tokens;
};

export const buildTranslationResult = (
  request: TranslationRequest,
  translatedSegments: string[]
): TranslationResult => {
  if (request.segments.length !== translatedSegments.length) {
    throw new Error('Result segment count does not match request.');
  }

  return {
    id: request.id,
    items: request.segments.map((segment, index) => ({
      id: segment.id,
      translated: translatedSegments[index]
    }))
  };
};

export const isValidSelection = (value: string): boolean => {
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) return false;
  return /[\p{L}\p{N}]/u.test(normalized);
};

export class Segmenter {
  split(input: string): TextSegment[] {
    const sanitized = normalizeText(input);
    if (!sanitized) {
      return [];
    }

    const parts = sanitized
      .split(/(?<=[.。！？!?])\s+/u)
      .flatMap((chunk) =>
        chunk
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
      );

    if (parts.length === 0) {
      return [
        {
          id: generateSegmentId(0),
          text: sanitized
        }
      ];
    }

    return parts.map((text, index) => ({
      id: generateSegmentId(index),
      text
    }));
  }
}

const generateSegmentId = (index: number): string =>
  `segment-${index.toString().padStart(4, '0')}`;
