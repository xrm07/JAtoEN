# JAtoEN MV3 Read-Only Audit — Findings & Fix Plan

## Key Findings (read-only)

- MV3 wiring is correct; manifest located at `packages/background/public/manifest.json` with SW `background.js`, content `content.js`, popup `popup.html`.
```8:15:/home/xrm07/GitHub_Remote/JAtoEN/packages/background/public/manifest.json
  "permissions": [
    "storage",
    "scripting",
    "activeTab",
    "contextMenus",
    "webNavigation",
    "tabs"
  ],
```

- Likely unused permissions: `scripting`, `webNavigation`, and `activeTab` (no `chrome.scripting` or `chrome.webNavigation` usage; `tabs` already suffices for queries and messaging).
- Popup currently listens for `translate.result` via broadcast, but background replies only via `sendResponse` (not broadcast to popup). Result: popup may never update output/stop spinner on success/error.
```24:48:/home/xrm07/GitHub_Remote/JAtoEN/packages/ui-popup/src/popup/PopupApp.tsx
  useEffect(() => {
    const listener = (message: { type: string; id: string; items?: Array<{ translated: string }> }) => {
      if (message.type !== 'translate.result') {
        return;
      }
      const translated = message.items?.map((item) => item.translated).join('\n') ?? '';
      setOutput(translated);
      setHistory((prev) => [
        {
          id: message.id,
          input,
          output: translated,
          pair: `${pair.src}/${pair.dst}`,
          createdAt: Date.now()
        },
        ...prev
      ]);
      setIsTranslating(false);
    };
```

- LM Studio segmentation: requests join segments with a delimiter, but the system prompt doesn’t explicitly instruct the model to output with the same delimiter; multi-segment responses can fail `splitTranslatedPayload`.
```58:61:/home/xrm07/GitHub_Remote/JAtoEN/packages/infra-lmstudio/src/index.ts
const DEFAULT_BASE_URL = 'http://localhost:1234/v1';
const SYSTEM_PROMPT =
  'Translate strictly. Preserve punctuation and newlines. No extra commentary.';
```

- Overlay CSS is assembled and exposed but not injected/used by content script (styles are inline). Also WAR lists `icons/*.svg` that don’t exist.
```11:12:/home/xrm07/GitHub_Remote/JAtoEN/packages/background/scripts/assemble-extension.mjs
const overlayCss = join(pkgRoot, '..', 'ui-content', 'src', 'overlay.css');
const popupDist = join(pkgRoot, '..', 'ui-popup', 'dist');
```


```32:35:/home/xrm07/GitHub_Remote/JAtoEN/packages/background/scripts/assemble-extension.mjs

// Copy overlay.css (static)

if (existsSync(overlayCss))

cpSync(overlayCss, join(outDir, 'overlay.css'));

````
```47:51:/home/xrm07/GitHub_Remote/JAtoEN/packages/background/public/manifest.json
      "resources": [
        "overlay.css",
        "icons/*.svg"
      ],
````

## Proposed Edits (safe, minimal)

1) Minimize permissions

- Remove: `scripting`, `webNavigation`, `activeTab`.
- Keep: `storage`, `contextMenus`, `tabs` and LM Studio `host_permissions`.

2) Fix popup result/error flow

- Update `handleSubmit` to handle the resolved response from `sendMessage` and update UI/history on success; show an error message and stop spinner on failure. Keep or remove the broadcast listener; it’s unnecessary for popup path.

3) Harden LM Studio segmentation

- Amend `SYSTEM_PROMPT` to require preserving the U+241E (␞) delimiter and returning the same number of segments, e.g.: “Return one translated segment per input segment, separated by U+241E (␞). Do not add or remove segments.”

4) Clean unused assets

- Either inject `overlay.css` via `chrome.runtime.getURL('overlay.css')` at content start, or remove it from assembly/manifest (simplest: remove).
- Remove `icons/*.svg` from WAR or add actual icons and `manifest.icons` entries (16/48/128) — recommend adding icons.

5) Optional quality-of-life

- Add base URL/API key fields to settings (existing popup Settings section), read them in background to set `lmBaseUrl`/Authorization header for non-local deployments.
- Improve IndexedDB repo stats to track hits/misses like memory repo (not critical for MVP).

## Acceptance/Verification

- Build succeeds: `pnpm build` assembles `packages/background/dist/` with `manifest.json`, `background.js`, `content.js`, `popup.html`, and assets.
- Install unpacked: content UI appears; selection and page translation work; popup translation returns and updates UI, including errors.
- Permissions review in Chrome devtools shows only `storage/contextMenus/tabs` and host `http://localhost:1234/*`.

## Targeted Edit Locations

- `packages/background/public/manifest.json` (permissions, WAR entries, optional icons)
- `packages/ui-popup/src/popup/PopupApp.tsx` (submit handler + error handling; listener simplification)
- `packages/infra-lmstudio/src/index.ts` (SYSTEM_PROMPT wording)
- `packages/background/scripts/assemble-extension.mjs` (remove overlay copy or switch to inject)

## Essential Snippets (indicative)

- Popup: handle resolved response
```tsx
const res = await chrome.runtime.sendMessage({ type: 'translate.selection', id, text: input, pair });
if (res?.type === 'translate.result') { /* update output/history; setIsTranslating(false) */ }
else if (res?.error) { setIsTranslating(false); setOutput(`[Error] ${res.error}`); }
```

- LM Studio prompt (augment)
```ts
const SYSTEM_PROMPT = 'Translate strictly. Use U+241E (␞) between segments. Return the same number of segments as input. No commentary.';
```

- If keeping overlay.css: inject once in content script
```ts
const href = chrome.runtime.getURL('overlay.css');
const link = document.createElement('link');
link.rel = 'stylesheet'; link.href = href; withBody((b) => b.appendChild(link));
```
