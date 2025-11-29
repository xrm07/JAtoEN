import { describe, expect, it } from 'vitest';
import {
  Segmenter,
  buildTranslationResult,
  createTranslationRequest,
  joinSegmentsForPrompt,
  splitTranslatedPayload,
  isValidSelection,
  normalizeText,
  TRANSLATION_SEPARATOR
} from './index';

/**
 * テスト観点表: Segmenter（セグメント分割）
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---------|---------------------|-------------|-----------------|
 * | SG-N-01 | 単一文「Hello.」 | 正常系 | 1セグメント |
 * | SG-N-02 | 複数文「Hello. World.」 | 正常系 | 2セグメント |
 * | SG-N-03 | 日本語文「こんにちは。世界。」 | 正常系 | 2セグメント |
 * | SG-N-04 | 改行を含む「Hello\nWorld」 | 正常系 | 2セグメント |
 * | SG-A-01 | 空文字列 | 境界値-空 | 空配列 |
 * | SG-A-02 | 空白のみ | 境界値-空白 | 空配列 |
 * | SG-A-03 | 1文字「a」 | 境界値-最小 | 1セグメント |
 * | SG-A-04 | 句読点のみ「...」 | 境界値-特殊 | 1セグメント（正規化後） |
 * | SG-A-05 | 連続空白「Hello   World」 | 正規化 | 空白正規化後に分割 |
 */
describe('Segmenter', () => {
  const segmenter = new Segmenter();

  describe('正常系', () => {
    it('SG-N-01: 単一文を1セグメントに分割する', () => {
      // Given: 単一の英文
      const input = 'Hello world.';

      // When: セグメント分割を実行
      const segments = segmenter.split(input);

      // Then: 1セグメントが返される
      expect(segments).toHaveLength(1);
      expect(segments[0]?.text).toBe('Hello world.');
      expect(segments[0]?.id).toMatch(/^segment-\d{4}$/);
    });

    it('SG-N-02: 複数文を複数セグメントに分割する', () => {
      // Given: 2つの英文
      const input = 'Hello world. Goodbye world.';

      // When: セグメント分割を実行
      const segments = segmenter.split(input);

      // Then: 2セグメントが返される
      expect(segments).toHaveLength(2);
      expect(segments[0]?.text).toBe('Hello world.');
      expect(segments[1]?.text).toBe('Goodbye world.');
    });

    it('SG-N-03: 日本語文を正しく分割する（句読点+空白）', () => {
      // Given: 日本語の複数文（句読点の後に空白あり）
      // Note: 実装は句読点の後に空白がある場合のみ分割する
      const input = 'こんにちは世界。 さようなら世界。';

      // When: セグメント分割を実行
      const segments = segmenter.split(input);

      // Then: 2セグメントが返される
      expect(segments).toHaveLength(2);
      expect(segments[0]?.text).toBe('こんにちは世界。');
      expect(segments[1]?.text).toBe('さようなら世界。');
    });

    it('SG-N-03b: 日本語文（句読点のみ）は1セグメントになる', () => {
      // Given: 日本語の複数文（句読点の後に空白なし）
      const input = 'こんにちは世界。さようなら世界。';

      // When: セグメント分割を実行
      const segments = segmenter.split(input);

      // Then: 空白がないため1セグメントとして扱われる
      expect(segments).toHaveLength(1);
      expect(segments[0]?.text).toBe('こんにちは世界。さようなら世界。');
    });

    it('SG-N-04: 改行を含むテキストを分割する', () => {
      // Given: 改行を含むテキスト
      const input = 'Hello\nWorld';

      // When: セグメント分割を実行
      const segments = segmenter.split(input);

      // Then: 2セグメントが返される
      expect(segments).toHaveLength(2);
      expect(segments[0]?.text).toBe('Hello');
      expect(segments[1]?.text).toBe('World');
    });

    it('SG-N-05: 英語と日本語の混在文を分割する', () => {
      // Given: 英語と日本語の混在文
      const input = 'Hello world. こんにちは世界。';

      // When: セグメント分割を実行
      const segments = segmenter.split(input);

      // Then: 2セグメントが返される
      expect(segments).toHaveLength(2);
      expect(segments[0]?.text).toBe('Hello world.');
      expect(segments[1]?.text).toBe('こんにちは世界。');
    });
  });

  describe('境界値・異常系', () => {
    it('SG-A-01: 空文字列は空配列を返す', () => {
      // Given: 空文字列
      const input = '';

      // When: セグメント分割を実行
      const segments = segmenter.split(input);

      // Then: 空配列が返される
      expect(segments).toHaveLength(0);
    });

    it('SG-A-02: 空白のみは空配列を返す', () => {
      // Given: 空白のみの文字列
      const input = '   \t\n  ';

      // When: セグメント分割を実行
      const segments = segmenter.split(input);

      // Then: 空配列が返される
      expect(segments).toHaveLength(0);
    });

    it('SG-A-03: 1文字は1セグメントを返す', () => {
      // Given: 1文字
      const input = 'a';

      // When: セグメント分割を実行
      const segments = segmenter.split(input);

      // Then: 1セグメントが返される
      expect(segments).toHaveLength(1);
      expect(segments[0]?.text).toBe('a');
    });

    it('SG-A-04: 句読点のみは1セグメントを返す', () => {
      // Given: 句読点のみ
      const input = '...';

      // When: セグメント分割を実行
      const segments = segmenter.split(input);

      // Then: 1セグメントが返される（空でない限り）
      expect(segments).toHaveLength(1);
      expect(segments[0]?.text).toBe('...');
    });

    it('SG-A-05: 連続空白は正規化される', () => {
      // Given: 連続空白を含むテキスト
      const input = 'Hello   World';

      // When: セグメント分割を実行
      const segments = segmenter.split(input);

      // Then: 空白が正規化される
      expect(segments).toHaveLength(1);
      expect(segments[0]?.text).toBe('Hello World');
    });

    it('SG-A-06: 連続改行は正規化される', () => {
      // Given: 連続改行を含むテキスト
      const input = 'Hello\n\n\n\nWorld';

      // When: セグメント分割を実行
      const segments = segmenter.split(input);

      // Then: 改行が正規化され2セグメントに分割
      expect(segments).toHaveLength(2);
    });
  });
});

/**
 * テスト観点表: isValidSelection（選択検証）
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---------|---------------------|-------------|-----------------|
 * | VS-N-01 | 通常テキスト「hello」 | 正常系 | true |
 * | VS-N-02 | 日本語「こんにちは」 | 正常系 | true |
 * | VS-N-03 | 数字「123」 | 正常系 | true |
 * | VS-A-01 | 空文字列 | 境界値-空 | false |
 * | VS-A-02 | 空白のみ | 境界値-空白 | false |
 * | VS-A-03 | 句読点のみ「...」 | 境界値-特殊 | false |
 * | VS-A-04 | 絵文字のみ「😀」 | 境界値-特殊 | false |
 * | VS-A-05 | 全角文字「ＡＢＣ」 | NFKC正規化 | true |
 * | VS-A-06 | 結合文字「a\u0301」 | Unicode | true |
 */
describe('isValidSelection', () => {
  describe('正常系', () => {
    it('VS-N-01: 通常の英文テキストはtrueを返す', () => {
      // Given: 通常の英文テキスト
      const input = 'hello';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: trueが返される
      expect(result).toBe(true);
    });

    it('VS-N-02: 日本語テキストはtrueを返す', () => {
      // Given: 日本語テキスト
      const input = 'こんにちは';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: trueが返される
      expect(result).toBe(true);
    });

    it('VS-N-03: 数字のみはtrueを返す', () => {
      // Given: 数字のみ
      const input = '123';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: trueが返される
      expect(result).toBe(true);
    });

    it('VS-N-04: 英数字混在はtrueを返す', () => {
      // Given: 英数字混在
      const input = 'abc123';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: trueが返される
      expect(result).toBe(true);
    });

    it('VS-N-05: 文字と句読点の混在はtrueを返す', () => {
      // Given: 文字と句読点の混在
      const input = 'hello...';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: trueが返される
      expect(result).toBe(true);
    });
  });

  describe('境界値・異常系', () => {
    it('VS-A-01: 空文字列はfalseを返す', () => {
      // Given: 空文字列
      const input = '';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: falseが返される
      expect(result).toBe(false);
    });

    it('VS-A-02: 空白のみはfalseを返す', () => {
      // Given: 空白のみ
      const input = '   ';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: falseが返される
      expect(result).toBe(false);
    });

    it('VS-A-03: 句読点のみはfalseを返す', () => {
      // Given: 句読点のみ
      const input = '...';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: falseが返される
      expect(result).toBe(false);
    });

    it('VS-A-04: 絵文字のみはfalseを返す', () => {
      // Given: 絵文字のみ
      const input = '😀';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: falseが返される
      expect(result).toBe(false);
    });

    it('VS-A-05: 全角英数字はNFKC正規化後にtrueを返す', () => {
      // Given: 全角英数字
      const input = 'ＡＢＣ１２３';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: trueが返される
      expect(result).toBe(true);
    });

    it('VS-A-06: 結合文字を含むテキストはtrueを返す', () => {
      // Given: 結合文字（a + combining acute accent）
      const input = 'a\u0301';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: trueが返される
      expect(result).toBe(true);
    });

    it('VS-A-07: 1文字の英字はtrueを返す', () => {
      // Given: 1文字の英字
      const input = 'a';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: trueが返される
      expect(result).toBe(true);
    });

    it('VS-A-08: 1文字の数字はtrueを返す', () => {
      // Given: 1文字の数字
      const input = '1';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: trueが返される
      expect(result).toBe(true);
    });

    it('VS-A-09: 1文字の句読点はfalseを返す', () => {
      // Given: 1文字の句読点
      const input = '.';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: falseが返される
      expect(result).toBe(false);
    });

    it('VS-A-10: 空白と句読点の組み合わせはfalseを返す', () => {
      // Given: 空白と句読点の組み合わせ
      const input = '  ...  ';

      // When: 選択検証を実行
      const result = isValidSelection(input);

      // Then: falseが返される
      expect(result).toBe(false);
    });
  });
});

/**
 * テスト観点表: normalizeText（テキスト正規化）
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---------|---------------------|-------------|-----------------|
 * | NT-N-01 | 通常テキスト | 正常系 | そのまま返す |
 * | NT-A-01 | CRLF改行 | 正規化 | LFに変換 |
 * | NT-A-02 | 連続空白 | 正規化 | 単一空白に |
 * | NT-A-03 | 連続改行 | 正規化 | 2改行に制限 |
 * | NT-A-04 | 前後空白 | 正規化 | trim |
 */
describe('normalizeText', () => {
  it('NT-N-01: 通常テキストはそのまま返す', () => {
    // Given: 通常テキスト
    const input = 'Hello World';

    // When: 正規化を実行
    const result = normalizeText(input);

    // Then: そのまま返される
    expect(result).toBe('Hello World');
  });

  it('NT-A-01: CRLF改行はLFに変換される', () => {
    // Given: CRLF改行を含むテキスト
    const input = 'Hello\r\nWorld';

    // When: 正規化を実行
    const result = normalizeText(input);

    // Then: LFに変換される
    expect(result).toBe('Hello\nWorld');
  });

  it('NT-A-02: 連続空白は単一空白に正規化される', () => {
    // Given: 連続空白を含むテキスト
    const input = 'Hello   World';

    // When: 正規化を実行
    const result = normalizeText(input);

    // Then: 単一空白に正規化される
    expect(result).toBe('Hello World');
  });

  it('NT-A-03: 連続改行は2改行に制限される', () => {
    // Given: 連続改行を含むテキスト
    const input = 'Hello\n\n\n\nWorld';

    // When: 正規化を実行
    const result = normalizeText(input);

    // Then: 2改行に制限される
    expect(result).toBe('Hello\n\nWorld');
  });

  it('NT-A-04: 前後の空白はtrimされる', () => {
    // Given: 前後に空白を含むテキスト
    const input = '  Hello World  ';

    // When: 正規化を実行
    const result = normalizeText(input);

    // Then: trimされる
    expect(result).toBe('Hello World');
  });
});

/**
 * テスト観点表: createTranslationRequest（翻訳リクエスト作成）
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---------|---------------------|-------------|-----------------|
 * | TR-N-01 | 有効なセグメント | 正常系 | リクエスト作成 |
 * | TR-A-01 | 空セグメント配列 | 異常系 | Error throw |
 * | TR-A-02 | 同一言語ペア | 異常系 | Error throw |
 * | TR-A-03 | モデル未指定 | 異常系 | デフォルトモデル使用 |
 */
describe('createTranslationRequest', () => {
  it('TR-N-01: 有効なセグメントからリクエストを作成する', () => {
    // Given: 有効なセグメント
    const segments = [{ id: 'seg-0001', text: 'Hello' }];
    const langPair = { src: 'en' as const, dst: 'ja' as const };

    // When: リクエスト作成を実行
    const request = createTranslationRequest('req-1', segments, langPair, { model: 'test-model' });

    // Then: 正しいリクエストが作成される
    expect(request.id).toBe('req-1');
    expect(request.segments).toHaveLength(1);
    expect(request.langPair).toEqual(langPair);
    expect(request.params.model).toBe('test-model');
  });

  it('TR-A-01: 空セグメント配列はErrorをthrowする', () => {
    // Given: 空のセグメント配列
    const segments: { id: string; text: string }[] = [];
    const langPair = { src: 'en' as const, dst: 'ja' as const };

    // When/Then: Error がthrowされる
    expect(() => createTranslationRequest('req-1', segments, langPair, { model: 'test' })).toThrow(
      'Translation request requires at least one segment.'
    );
  });

  it('TR-A-02: 同一言語ペアはErrorをthrowする', () => {
    // Given: 同一言語ペア
    const segments = [{ id: 'seg-0001', text: 'Hello' }];
    const langPair = { src: 'ja' as const, dst: 'ja' as const };

    // When/Then: Error がthrowされる
    expect(() => createTranslationRequest('req-1', segments, langPair, { model: 'test' })).toThrow(
      'Source and destination languages must differ.'
    );
  });

  it('TR-A-03: パラメータ未指定時はデフォルト値が使用される', () => {
    // Given: パラメータ未指定
    const segments = [{ id: 'seg-0001', text: 'Hello' }];
    const langPair = { src: 'en' as const, dst: 'ja' as const };

    // When: リクエスト作成を実行
    const request = createTranslationRequest('req-1', segments, langPair);

    // Then: デフォルト値が使用される
    expect(request.params.temperature).toBe(0.2);
    expect(request.params.maxTokens).toBe(512);
    expect(request.params.model).toBe('lmstudio');
  });
});

/**
 * テスト観点表: splitTranslatedPayload（翻訳結果分割）
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---------|---------------------|-------------|-----------------|
 * | SP-N-01 | 正しいセグメント数 | 正常系 | 配列を返す |
 * | SP-A-01 | セグメント数不一致 | 異常系 | Error throw |
 */
describe('splitTranslatedPayload', () => {
  it('SP-N-01: 正しいセグメント数の場合は配列を返す', () => {
    // Given: セパレータで区切られた翻訳結果
    const payload = `Hello${TRANSLATION_SEPARATOR}World`;
    const expectedLength = 2;

    // When: 分割を実行
    const result = splitTranslatedPayload(payload, expectedLength);

    // Then: 正しく分割される
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('Hello');
    expect(result[1]).toBe('World');
  });

  it('SP-A-01: セグメント数不一致はErrorをthrowする', () => {
    // Given: セグメント数が期待と異なる
    const payload = `Hello${TRANSLATION_SEPARATOR}World`;
    const expectedLength = 3;

    // When/Then: Error がthrowされる
    expect(() => splitTranslatedPayload(payload, expectedLength)).toThrow('Segment count mismatch');
  });
});

/**
 * テスト観点表: buildTranslationResult（翻訳結果構築）
 *
 * | Case ID | Input / Precondition | Perspective | Expected Result |
 * |---------|---------------------|-------------|-----------------|
 * | BR-N-01 | 正しいセグメント数 | 正常系 | 結果を返す |
 * | BR-A-01 | セグメント数不一致 | 異常系 | Error throw |
 */
describe('buildTranslationResult', () => {
  it('BR-N-01: 正しいセグメント数の場合は結果を返す', () => {
    // Given: リクエストと翻訳結果
    const request = createTranslationRequest(
      'req-1',
      [{ id: 'seg-0001', text: 'Hello' }],
      { src: 'en', dst: 'ja' },
      { model: 'test' }
    );
    const translatedSegments = ['こんにちは'];

    // When: 結果構築を実行
    const result = buildTranslationResult(request, translatedSegments);

    // Then: 正しい結果が返される
    expect(result.id).toBe('req-1');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.translated).toBe('こんにちは');
  });

  it('BR-A-01: セグメント数不一致はErrorをthrowする', () => {
    // Given: セグメント数が異なる
    const request = createTranslationRequest(
      'req-1',
      [{ id: 'seg-0001', text: 'Hello' }],
      { src: 'en', dst: 'ja' },
      { model: 'test' }
    );
    const translatedSegments = ['こんにちは', '世界'];

    // When/Then: Error がthrowされる
    expect(() => buildTranslationResult(request, translatedSegments)).toThrow(
      'Result segment count does not match request.'
    );
  });
});

/**
 * テスト観点表: joinSegmentsForPrompt（セグメント結合）
 */
describe('joinSegmentsForPrompt', () => {
  it('セグメントをセパレータで結合する', () => {
    // Given: 複数のセグメント
    const segments = [
      { id: 'seg-0001', text: 'Hello' },
      { id: 'seg-0002', text: 'World' }
    ];

    // When: 結合を実行
    const result = joinSegmentsForPrompt(segments);

    // Then: セパレータで結合される
    expect(result).toBe(`Hello${TRANSLATION_SEPARATOR}World`);
  });
});
