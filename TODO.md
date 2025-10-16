# TODO tracker after PR split

This project now has two active PR tracks:

- PR #4: test(e2e) — E2E harness + CI hardening (dynamic stub port, popup pre‑warm, programmatic injection for localhost, richer logs).
- PR #5: feat — Translation MVP (product‑only). No E2E harness inside this PR to keep review focused.

Use this file to coordinate re‑application of spec items and to track follow‑ups across both PRs.

## Spec Alignment Tasks (Product, PR #5)

- [ ] Cache defaults (TTL/size)
  - Set defaults to TTL 30 days and 50MB.
  - Files: `packages/infra-cache/src/index.ts`, `packages/infra-cache/src/indexeddb-repo.ts`.
  - Tests: verify TTL eviction and size-based LRU.

- [ ] Record delimiter “\n␞\n” in domain
  - Use “\n␞\n” for `joinSegmentsForPrompt` and `splitTranslatedPayload`.
  - File: `packages/domain/src/index.ts`.
  - Tests: add unit test for round-trip split/join.

- [x] Host permissions
  - Restrict to `http://localhost:1234/*` per requirements.
  - Done in PR #5 branch: `packages/background/public/manifest.json`.

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

## E2E/CI Tasks (PR #4)

- [x] Fix runner SyntaxError (TS cast in JS)
  - Removed `as string | undefined` in `packages/e2e/src/run.js`.
- [x] Add xvfb E2E step in CI workflow
  - `xvfb-run -a -s "-screen 0 1280x800x24" pnpm test:e2e`.
- [x] Dynamic stub port wiring
  - Runner writes `e2e-settings.json`; SW reads and logs override.
- [x] Manifest widened for test ports
  - `http://localhost/*` only in PR #4 to allow random ports.
- [ ] Stabilize content injection
  - Verify SW registration log appears; if flaky, increase pre‑nav delay and reload attempts.
- [ ] Extend E2E scenarios
  - Cover popup CTAs, toggle original, and cache clear behavior.

## Notes

- Concurrency target remains 2 in-flight requests per client instance.
- Keep all cross-context messaging names consistent with the contract in requirements.txt.
- Ensure unit coverage targets (≥90% for domain/cache) remain satisfied after re-applying changes.
