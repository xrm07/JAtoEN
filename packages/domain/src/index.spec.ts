import { describe, expect, it } from 'vitest';
import {
  Segmenter,
  buildTranslationResult,
  createTranslationRequest,
  joinSegmentsForPrompt,
  splitTranslatedPayload
} from './index';

describe('Segmenter', () => {
  it('splits sentences and trims whitespace', () => {
    const segmenter = new Segmenter();
    const segments = segmenter.split('Hello world. こんにちは世界。');
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe('Hello world.');
    expect(segments[1].text).toBe('こんにちは世界。');
  });
});

describe('translation helpers', () => {
  it('creates translation request and joins segments', () => {
    const segmenter = new Segmenter();
    const segments = segmenter.split('Hello world.');
    const request = createTranslationRequest(
      'req-1',
      segments,
      { src: 'en', dst: 'ja' },
      { model: 'lmstudio/test' }
    );
    const prompt = joinSegmentsForPrompt(request.segments);
    const roundTrip = splitTranslatedPayload(prompt, request.segments.length);
    const result = buildTranslationResult(request, roundTrip);
    expect(result.items[0]?.translated).toBe('Hello world.');
  });
});
