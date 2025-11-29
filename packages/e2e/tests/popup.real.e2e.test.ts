import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import puppeteer, { Browser, CDPSession, Page, Target } from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const loadExtensionBrowser = async (): Promise<Browser> => {
  const extensionPath = path.resolve(__dirname, '../../background/dist');
  return puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox'
    ]
  });
};

const LM_BASE_URL = process.env.LM_BASE_URL;
const LM_MODEL = process.env.LM_MODEL || 'google/gemma-3-1b';
const LM_ENDPOINT = (process.env.LM_ENDPOINT as 'responses' | 'chat/completions') || 'chat/completions';

// Run only when LM_BASE_URL is provided to hit a real LM Studio instance
const maybe = LM_BASE_URL ? describe : describe.skip;

maybe('Popup REAL LM Studio', () => {
  let browser: Browser;
  let page: Page;
  let extensionId = '';
let swTarget: Target | null = null;
let swSession: CDPSession | null = null;
let forwardServer: http.Server | null = null;
let forwardPort = 0;
let hitPaths: string[] = [];

  beforeAll(async () => {
    // Start a lightweight forwarder that proxies to real LM Studio and records paths
    if (!LM_BASE_URL) throw new Error('LM_BASE_URL is required');
    const base = new URL(LM_BASE_URL);
    hitPaths = [];
    forwardServer = http.createServer(async (req, res) => {
      try {
        const target = new URL(req.url || '/', base);
        let body = Buffer.alloc(0);
        req.on('data', (c) => (body = Buffer.concat([body, c])));
        req.on('end', async () => {
          const incoming = req.url || '';
          hitPaths.push(incoming);
          hitPaths.push(target.pathname);
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string' && key.toLowerCase() !== 'host') {
              headers[key] = value;
            }
          }
          if (body.length && !headers['content-type']) {
            headers['content-type'] = 'application/json';
          }
          const resp = await fetch(target, {
            method: req.method,
            headers,
            body: body.length ? body : undefined,
          } as any);
          const text = await resp.text();
          res.statusCode = resp.status;
          resp.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          res.end(text);
        });
      } catch (e) {
        res.statusCode = 500;
        res.end(String(e));
      }
    });
    await new Promise<void>((resolve) => forwardServer!.listen(0, resolve));
    const addr = forwardServer!.address();
    if (typeof addr === 'object' && addr) forwardPort = addr.port as number;

    browser = await loadExtensionBrowser();
    page = await browser.newPage();
    // Try service worker first (fast path)
    try {
      const swTarget = await browser.waitForTarget(
        (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
        { timeout: 5000 }
      );
      const url = swTarget?.url() ?? '';
      const match = url.match(/^chrome-extension:\/\/([a-z]+)\//i);
      extensionId = match?.[1] ?? '';
    } catch {
      // Fallback: parse chrome://extensions and read the item id by name
      const extPage = await browser.newPage();
      await extPage.goto('chrome://extensions/');
      const id = await extPage.evaluate(() => {
        const targetName = 'EN⇄JA Translator';
        const visit = (root: Document | ShadowRoot): string => {
          const all = (root as any).querySelectorAll('*');
          for (const el of Array.from(all)) {
            const text = (el.textContent || '').trim();
            if (text.includes(targetName)) {
              let node: any = el;
              while (true) {
                if (node.tagName && String(node.tagName).toLowerCase() === 'extensions-item') {
                  const attr = node.getAttribute('id');
                  if (attr) return attr;
                }
                const rootNode: any = node.getRootNode();
                if (rootNode && rootNode.host) {
                  node = rootNode.host as Element;
                } else if (node.parentElement) {
                  node = node.parentElement as Element;
                } else {
                  break;
                }
              }
            }
          }
          for (const el of Array.from(all)) {
            // @ts-ignore
            if ((el as any).shadowRoot) {
              const found = visit((el as any).shadowRoot);
              if (found) return found;
            }
          }
          return '';
        };
        return visit(document);
      });
      extensionId = (id as any) || '';
      await extPage.close();
    }
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    try {
      await swSession?.detach();
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => forwardServer?.close(() => resolve()));
  });

  it('translates via real LM Studio', async () => {
    if (!extensionId) throw new Error('extension id not found');

    // Attach to service worker for logging
    const ensureSession = async () => {
      if (swSession) return;
      swTarget = await browser.waitForTarget(
        (t) => t.type() === 'service_worker' && t.url().includes(extensionId),
        { timeout: 10000 }
      );
      swSession = await swTarget.createCDPSession();
      await swSession.send('Runtime.enable');
      swSession.on('Runtime.consoleAPICalled', (event) => {
        const values = event.args?.map((arg) => arg.value ?? arg.description);
        console.log('[sw][console]', event.type, values);
      });
    };
    await ensureSession();

    // Open popup
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    // Set base URL
    await popup.focus('[data-xt-role="settings-base-url"]');
    await popup.keyboard.down('Control');
    await popup.keyboard.press('KeyA');
    await popup.keyboard.up('Control');
    await popup.type('[data-xt-role="settings-base-url"]', `http://localhost:${forwardPort}/v1`);

    // Reload models and select model if dropdown exists
    const reloadBtn = await popup.$('[data-xt-role="settings-reload-models"]');
    await reloadBtn?.click();
    const hasSelect = await popup.$('[data-xt-role="settings-model-select"]');
    if (hasSelect) {
      try {
        await popup.select('[data-xt-role="settings-model-select"]', LM_MODEL);
      } catch {
        const first = await popup.$eval('[data-xt-role="settings-model-select"]', (el) => {
          const s = el as HTMLSelectElement; return s.options[0]?.value || '';
        });
        if (first) await popup.select('[data-xt-role="settings-model-select"]', first);
      }
    } else {
      await popup.type('[data-xt-role="settings-model-input"]', LM_MODEL);
    }

    // Pick endpoint
    try { await popup.select('[data-xt-role="settings-endpoint"]', LM_ENDPOINT); } catch {}

    // Save settings
    await popup.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
      const save = buttons.find((b) => (b.textContent || '').includes('保存'));
      save?.click();
    });

    // Wait for storage to persist settings to background
    await popup.waitForFunction(
      (expectedBase: string, expectedEndpoint: string) =>
        new Promise((resolve) => {
          chrome.storage.local.get(['xt-settings'], (res) => {
            const s = res['xt-settings'];
            if (!s) {
              resolve(false);
              return;
            }
            const baseMatches = typeof s.baseUrl === 'string' && s.baseUrl.trim() === expectedBase.trim();
            const endpointMatches = !expectedEndpoint || s.endpoint === expectedEndpoint;
            resolve(baseMatches && endpointMatches);
          });
        }),
      {},
      `http://localhost:${forwardPort}/v1`,
      LM_ENDPOINT
    );

    // Translate
    const inputText = `Hello ${Date.now()}`;
    await popup.click('[data-xt-role="popup-input"]');
    await popup.type('[data-xt-role="popup-input"]', inputText);
    const translateBtn = await popup.$('[data-xt-role="translate-button"]');
    await translateBtn?.click();

    await popup.waitForSelector('[data-xt-role="popup-output"]');
    await popup.waitForFunction(() => {
      const el = document.querySelector('[data-xt-role="popup-output"]');
      if (!el) return false;
      const text = el.textContent?.trim() ?? '';
      if (!text) return false;
      if (text.includes('[Error]')) return true;
      return text !== '結果がここに表示されます';
    }, { timeout: 20000 });
    const out = await popup.$eval('[data-xt-role="popup-output"]', (el) => el.textContent || '');
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).not.toContain('[Error]');

    const expectedPath = LM_ENDPOINT === 'responses' ? '/v1/responses' : '/v1/chat/completions';
    await new Promise<void>((resolve, reject) => {
      const timeout = Date.now() + 15000;
      const check = () => {
        if (hitPaths.some((p) => typeof p === 'string' && p.endsWith(expectedPath))) {
          resolve();
          return;
        }
        if (Date.now() > timeout) {
          reject(new Error(`Requests seen: ${JSON.stringify(hitPaths)}`));
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });

    await popup.close();
  }, 120_000);
});


