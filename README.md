# JA⇄EN Translator Extension

[![CI](https://github.com/xrm07/JAtoEN/actions/workflows/ci.yml/badge.svg)](https://github.com/xrm07/JAtoEN/actions/workflows/ci.yml)

ローカルの LM Studio 推論を活用してブラウザ内で英日・日英翻訳を提供する Chrome 拡張のモノレポです。`requirements.txt` に記載された要件を実装するための初期スキャフォールドを用意しています。

## リポジトリ構成

- `packages/domain`: 翻訳リクエストとセグメント処理などコアドメイン。
- `packages/infra-lmstudio`: LM Studio OpenAI互換 API クライアント。
- `packages/infra-cache`: IndexedDB/ローカルキャッシュの抽象と in-memory 実装。
- `packages/background`: MV3 サービスワーカー。メッセージハンドラと翻訳ジョブのオーケストレーション。
- `packages/ui-content`: 選択検知とオーバーレイ UI を提供するコンテンツスクリプト。
- `packages/ui-popup`: Vite + React で構築したポップアップ UI。
- `packages/e2e`: Puppeteer テスト資産（初期コミットではプレースホルダー）。

## セットアップ

1. `pnpm install`
2. `pnpm build`

個別パッケージの開発は `pnpm dev --filter ui-popup` や `pnpm dev --filter ui-content` など、requirements のガイドラインに従って進めてください。E2E は `pnpm build` の後、`CHROME_PATH` を指定して `pnpm test:e2e` を実行します（CI では xvfb と Google Chrome を自動セットアップ）。

## スクリプト

- `pnpm build`: 全パッケージのビルド。
- `pnpm dev`: 各パッケージの `dev` スクリプトを並列実行（存在する場合）。
- `pnpm lint` / `pnpm lint:fix`: ESLint。
- `pnpm format` / `pnpm format:check`: Prettier。
- `pnpm test`: vitest によるユニットテスト（E2Eは除外）。
- `pnpm test:e2e`: E2E テスト（現状はプレースホルダー）。
- `pnpm coverage`: ドメイン層・キャッシュ層のカバレッジ実行用フック。

## 次のステップ

- LM Studio モデル一覧の取得（`GET /v1/models`）とポップアップでの選択 UI を実装済みです。`保存` 後は即時反映されます（背景SWが `xt-settings` を監視）。
- `packages/e2e` のテストは LM Studio スタブサーバを内蔵し、モデル切替えまで検証します。実機LM Studioで試す場合はポップアップ設定の Base URL を `http://127.0.0.1:1234/v1` に設定し、`モデル再読込` を押してください。

## CI

- GitHub Actions の CI が `lint` / `test` / `build` を実行し、`packages/background/dist` の内容を `extension-dist` アーティファクトとして保存します。
- 成果物のZIPは `extension.zip` で取得できます。
