import { describe, expect, it } from 'vitest';
import { Segmenter, buildTranslationResult, createTranslationRequest, joinSegmentsForPrompt, splitTranslatedPayload, isValidSelection } from './index';

describe('Segmenter', () => {
  it('splits sentences and trims whitespace', () => {
    const segmenter = new Segmenter();
    const segments = segmenter.split('Hello world. こんにちは世界。');
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe('Hello world.');
    expect(segments[1].text).toBe('こんにちは世界。');
  });
});

describe('isValidSelection', () => {
  it('rejects empty or whitespace', () => {
    expect(isValidSelection('')).toBe(false);
    expect(isValidSelection('   ')).toBe(false);
  });
  it('rejects punctuation only', () => {
    expect(isValidSelection('...')).toBe(false);
  });
  it('accepts letters and numbers incl. NFKC cases', () => {
    expect(isValidSelection('abc123')).toBe(true);
    expect(isValidSelection('ＡＢＣ１２３')).toBe(true);
  });
  it('accepts mixed alphanumeric and punctuation', () => {
    expect(isValidSelection('hello...')).toBe(true);
    expect(isValidSelection('...world')).toBe(true);
  });
  it('handles single character inputs', () => {
    expect(isValidSelection('a')).toBe(true);
    expect(isValidSelection('1')).toBe(true);
    expect(isValidSelection('.')).toBe(false);
  });
  it('rejects whitespace plus punctuation only', () => {
    expect(isValidSelection('  ...  ')).toBe(false);
  });
  it('handles unicode edge cases', () => {
    expect(isValidSelection('😀')).toBe(false);
    // combining character sequence: a + combining acute accent
    expect(isValidSelection('a\u0301')).toBe(true);
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
