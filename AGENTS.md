# Repository Guidelines

このドキュメントは、**AI エージェント（Cursor など）と人間の開発者**の両方が、このリポジトリで作業を始める際の共通スタート地点です。  
リポジトリ構成・開発フロー・テスト・コミット/PR ルール・AI エージェント用の振る舞い指針を **1 ファイルから辿れるように統合** しています。  
詳細は各セクション末尾のリンク先を参照してください。

---

## 0. 目的と対象読者

| 対象 | 本ドキュメントで得られること |
|---|---|
| **人間の開発者** | リポジトリ構成、開発コマンド、コーディングスタイル、テスト・コミット/PR ルールの概要 |
| **AI エージェント** | タスク分類、ツール利用ポリシー、禁止事項、承認が必要な判断基準 |

---

## 1. リポジトリ構成と役割

### 1.1 モノレポ概要

このリポジトリは pnpm ワークスペースによるモノレポです。`requirements.txt` を権威ある要件仕様とし、各パッケージは `packages/` 配下に配置します。

| パッケージ | 責務 |
|---|---|
| `packages/domain` | 翻訳リクエスト・セグメント処理などコアドメインロジック |
| `packages/infra-lmstudio` | LM Studio OpenAI 互換 API クライアント（リトライ・エラーコード付き） |
| `packages/infra-cache` | IndexedDB / ローカルキャッシュの抽象と in-memory 実装（LRU・TTL対応） |
| `packages/background` | MV3 サービスワーカー。`TranslationService` / `handlers/` によるモジュール分離済み |
| `packages/ui-content` | 選択検知とオーバーレイ UI（`overlays.ts` に分離）を提供するコンテンツスクリプト |
| `packages/ui-popup` | Vite + React で構築したポップアップ UI（ページ全体翻訳ボタン付き） |
| `packages/e2e` | Puppeteer テスト資産（ポップアップ・ページ全体翻訳 E2E） |

共有ヘルパーは各パッケージ内に留め、安定したら `index.ts` で公開します。

### 1.2 DDD 境界づけられたコンテキスト

詳細は [`requirements.txt`](requirements.txt) §4 を参照。

| コンテキスト | 主な構成要素 |
|---|---|
| **Translate Core** | `TranslationRequest`, `LanguagePair`, `TextSegment`, `Segmenter`, `Translator`, `PostProcessor` |
| **Cache** | `CacheRepository` IF, `StorageLocalRepository`, `MemoryShard` |
| **Integration** | `LMStudioClient`, `RetryPolicy`, `RateLimiter` |
| **UI** | `PopupPresenter`, `ContentOverlayController`, `FullPageTranslator` |

### 1.3 主要ユースケースと MV3 コンテキスト

| ユースケース | 関連コンテキスト | トリガー |
|---|---|---|
| 選択テキスト翻訳 | Content Script → Background (SW) → LM Studio | フローティングボタン / `Alt+T` / 右クリック |
| ポップアップ翻訳 | Popup → Background (SW) → LM Studio | ポップアップ入力 |
| ページ全体翻訳 | Popup → Background (SW) → Content Script (DOM 置換) | 「ページ全体を翻訳」ボタン / `Alt+Shift+T` |
| キャッシュ | Background (SW) ↔ IndexedDB | 自動（LRU・TTL） |
| ショートカット | Background (SW) commands API | `Alt+T` / `Alt+Shift+T` |

---

## 2. 開発環境と主要コマンド

### 2.1 セットアップ

1. pnpm v8 以上をインストール
2. `pnpm install`
3. `pnpm build`

### 2.2 ビルド / テスト / 静的解析

| コマンド | 用途 |
|---|---|
| `pnpm build` | 全パッケージビルド（esbuild + Vite） |
| `pnpm dev --filter ui-popup` | ポップアップ UI のライブ開発 |
| `pnpm dev --filter ui-content` | コンテンツスクリプトのライブ開発 |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm test` | vitest によるユニットテスト（E2E 除外）。102 テスト |
| `pnpm test:e2e` | Puppeteer E2E テスト（`CHROME_PATH` 指定）。ポップアップ・ページ全体翻訳 |
| `pnpm coverage` | ドメイン層・キャッシュ層のカバレッジ |

---

## 3. コーディングスタイル & 命名規則

- **言語**: TypeScript (ES2022)
- **インデント**: 2 スペース
- **クォート**: シングルクォート
- **末尾カンマ**: マルチラインリテラルで付与
- **命名**
  - 関数 / 変数: `camelCase`
  - クラス / エクスポート型: `PascalCase`
  - ファイル: `kebab-case`（React コンポーネントは `PascalCase.tsx`）
- **DOM フック**: ホストページとの分離のため `data-xt-*` 属性を使用
- **コミット前チェック**: `pnpm lint` / `pnpm format` を実行

---

## 4. テスト戦略

詳細は [`.cursor/rules/test-strategy.mdc`](.cursor/rules/test-strategy.mdc) を参照。

### 4.1 観点表の作成

テスト作業を開始する前に、Markdown 形式の **テスト観点表** を作成します。

| 列 | 説明 |
|---|---|
| Case ID | 一意の識別子（例: `TC-N-01`） |
| Input / Precondition | 入力値や前提条件 |
| Perspective | 等価分割 / 境界値 |
| Expected Result | 期待する結果 |
| Notes | 補足（対象外理由など） |

境界値は最低でも `0 / 最小値 / 最大値 / ±1 / 空 / NULL` を含めます。

### 4.2 テストコード実装ポリシー

- 観点表のケースを **すべて** 自動化テストとして実装
- **正常系と同数以上の失敗系** を含める
- 各テストケースに `// Given: ... // When: ... // Then: ...` コメントを付与
- 例外発生時は **型とメッセージ** を検証
- 外部依存の失敗はモックで擬似的に再現

### 4.3 カバレッジと報告

- 分岐網羅 100% を目標（domain / cache は ≥90%）
- PR 本文に実行コマンドとカバレッジ結果を記載

---

## 5. コミットメッセージ規約

詳細は [`.cursor/rules/commit-message-format.mdc`](.cursor/rules/commit-message-format.mdc) を参照。

### フォーマット

```
<Prefix>: <サマリ（日本語・命令形・50 文字以内）>

- 変更内容1（箇条書き）
- 変更内容2
- ...

Refs: #<Issue番号>（任意）
BREAKING CHANGE: <内容>（任意）
```

### Prefix 一覧

| Prefix | 用途 |
|---|---|
| `feat` | 新機能 |
| `fix` | バグ修正 |
| `refactor` | リファクタリング（挙動変更なし） |
| `perf` | パフォーマンス改善 |
| `test` | テスト追加/修正 |
| `docs` | ドキュメント更新 |
| `build` | ビルド/依存関係の変更 |
| `ci` | CI 関連 |
| `chore` | 雑務 |
| `style` | スタイルのみ |
| `revert` | 取り消し |

スコープ付きも可: `fix(translation): ...`

### 禁止事項

- 英語だけのサマリ
- 抽象的なサマリ（例: "update", "fix bug"）
- 箇条書きのない長文本文
- 差分と無関係な説明

---

## 6. PR メッセージ規約

詳細は [`.cursor/rules/pr-message-format.mdc`](.cursor/rules/pr-message-format.mdc) を参照。

### タイトル

```
<Prefix>: <サマリ（日本語・50 文字以内）>
```

### 本文テンプレート

```markdown
## 概要

このPRで実装・修正した内容の要約

## 変更内容

- 変更点1
- 変更点2

## 技術的な詳細（任意）

- 実装の詳細や設計意図

## テスト内容

- 実施したテストの種類と結果

## 関連Issue

- Closes #123
- Refs #456
```

---

## 7. LM Studio 連携

詳細は [`packages/infra-lmstudio/README.md`](packages/infra-lmstudio/README.md) を参照。

| 項目 | 値 |
|---|---|
| Base URL | `http://localhost:1234/v1` |
| API Key | `lm-studio`（プレースホルダ） |
| エンドポイント | `POST /chat/completions` |
| セパレータ | U+241E (␞) |
| 温度 | 0.2（既定） |

モデル一覧は `GET /v1/models` で取得可能。ポップアップ設定で Base URL / モデルを変更できます。

---

## 8. AI エージェント実行ポリシー

詳細は [`.cursor/rules/jptoen.mdc`](.cursor/rules/jptoen.mdc) および [`.cursor/rules/v5.mdc`](.cursor/rules/v5.mdc) を参照。

### 8.1 タスク分類

| 分類 | 例 | 進め方 |
|---|---|---|
| 🟢 軽量 | 1〜2 ファイル・10 行以下の修正、設定確認 | 簡易分析 → 即実行 → 簡潔報告 |
| 🟡 標準 | 機能追加、複数ファイルのリファクタ | 分析 → チェックリスト → 実行 → 検証 → 報告 |
| 🔴 重要 | アーキテクチャ変更、セキュリティ、本番影響 | 詳細分析 → **Plan 提示 → 承認待ち** → 段階実行 → 厳密検証 |

### 8.2 ツール利用ポリシー

| ツール | 方針 |
|---|---|
| `read_file` / `grep` / `codebase_search` | 読み取り系は並列実行可（最大 5 同時） |
| `apply_patch` | 状態変更。並列実行しない |
| `run_terminal_cmd` | ユーザー指示 or ビルド/テスト時のみ。非対話フラグ優先 |
| `web_search` | 外部サービス仕様・バージョン依存・エラー調査時に積極利用 |
| ブラウザツール | E2E 確認時に使用。ローカルサーバー起動は指示がある場合のみ |

### 8.3 禁止事項

- **UI/UX の無断変更**（事前承認必須）
- **技術スタックバージョンの無断変更**（承認必須）
- **`any` 型の使用**
- **機能デグレード**（エラー回避目的）
- **重要タスクでの承認スキップ**
- **静的解析を無効化・迂回するだけの変更**

### 8.4 承認が必要な判断

- 破壊的変更、環境変更、コスト発生
- セキュリティ影響、本番環境影響
- アーキテクチャレベルの変更
- 外部依存関係の大幅変更
- PII / 機微データの取り扱い方針変更

---

## 9. 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`README.md`](README.md) | リポジトリ概要・セットアップ・スクリプト |
| [`requirements.txt`](requirements.txt) | 要件・設計ドラフト |
| [`packages/infra-lmstudio/README.md`](packages/infra-lmstudio/README.md) | LM Studio クライアント仕様 |
| [`.cursor/rules/jptoen.mdc`](.cursor/rules/jptoen.mdc) | AI アシスタント実行ルール（適応的プロセス） |
| [`.cursor/rules/v5.mdc`](.cursor/rules/v5.mdc) | コーディング支援ルール |
| [`.cursor/rules/commit-message-format.mdc`](.cursor/rules/commit-message-format.mdc) | コミットメッセージ規約 |
| [`.cursor/rules/pr-message-format.mdc`](.cursor/rules/pr-message-format.mdc) | PR メッセージ規約 |
| [`.cursor/rules/test-strategy.mdc`](.cursor/rules/test-strategy.mdc) | テスト戦略ルール |

---

## 10. メンテナンス方針

- **ルールやアーキテクチャが変わった際は、まずこの `AGENTS.md` を更新する**ことで、AI エージェントと人間開発者の両方が最新情報を参照できるようにします。
- 詳細ルールは `.cursor/rules/*.mdc` に記載し、`AGENTS.md` は **ハブ** として位置付けます。
- 変更時は `pnpm lint` / `pnpm test` を実行し、CI がグリーンであることを確認してからコミットしてください。
