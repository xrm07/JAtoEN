# TODO after syncing to latest PR

This workspace was synchronized to the latest PR head to match GitHub.

- Branch: `feat/e2e-puppeteer`
- Remote: `origin`
- Commit: `8f5a5a0` (2025-10-12 05:53:04 +0000)

The following items had been implemented locally but were intentionally rolled back to align with the PR. Track and re-apply as needed according to requirements.txt.

## Spec Alignment Tasks

- [ ] Cache defaults (TTL/size)
  - Set defaults to TTL 30 days and 50MB.
  - Files: `packages/infra-cache/src/index.ts`, `packages/infra-cache/src/indexeddb-repo.ts`.
  - Tests: verify TTL eviction and size-based LRU.

- [ ] Record delimiter “\n␞\n” in domain
  - Use “\n␞\n” for `joinSegmentsForPrompt` and `splitTranslatedPayload`.
  - File: `packages/domain/src/index.ts`.
  - Tests: add unit test for round-trip split/join.

- [ ] Host permissions
  - Restrict to `http://localhost:1234/*` per requirements.
  - File: `packages/background/public/manifest.json`.

- [ ] Content script: dynamic translation + toggle
  - Add `MutationObserver` to incrementally translate new/changed Text nodes after page translation starts.
  - Preserve originals via `WeakMap<Text,string>` and mark via `data-xt-orig` / `data-xt-marked` to avoid re-translation.
  - Implement message `content.toggleOriginal`.
  - File: `packages/ui-content/src/index.ts`.

- [ ] Popup CTAs
  - Buttons: 「ページ全体を翻訳」「原文⇄訳文トグル」「キャッシュ消去」。
  - Active-tab messaging to content/background.
  - File: `packages/ui-popup/src/popup/PopupApp.tsx`.

- [ ] Background cache control
  - Handle `cache.clear` by calling `evictLRUUntil(0)` and respond with updated stats.
  - File: `packages/background/src/index.ts`.

- [ ] SHA‑256 cache keys
  - Implement `buildCacheKeySha256()` using WebCrypto/Node fallback and use it in background selection caching.
  - File: `packages/infra-cache/src/index.ts` and references in background.
  - Tests: update cache unit tests to use SHA‑256 builder.

- [ ] LM Studio client docs
  - Add `packages/infra-lmstudio/README.md` documenting defaults (baseUrl, temperature, model) and retry/concurrency behavior.

- [ ] E2E coverage additions
  - Cover popup CTAs, toggle original, and cache clear behavior using the stub LM Studio server.
  - File: `packages/e2e/src/run.js` (extend scenarios).

## Notes

- Concurrency target remains 2 in-flight requests per client instance.
- Keep all cross-context messaging names consistent with the contract in requirements.txt.
- Ensure unit coverage targets (≥90% for domain/cache) remain satisfied after re-applying changes.

