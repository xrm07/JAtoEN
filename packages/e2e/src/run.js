import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

const EXT_DIR = path.join(repoRoot, 'packages/background/dist');

async function main() {
  // Ensure extension artifacts exist
  if (!existsSync(path.join(EXT_DIR, 'manifest.json'))) {
    console.error('[e2e] Extension not built. Run `pnpm build` first.');
    process.exit(1);
  }
  if (!existsSync(path.join(EXT_DIR, 'content.js'))) {
    console.error('[e2e] content.js missing in extension dist. Ensure ui-content built and assembly copied it.');
    process.exit(1);
  }

  const { server, port } = await startStubServer();
  let browser;

  // Write e2e-settings.json BEFORE launching Chrome so the service worker can read it at startup
  await writeE2ESettings(EXT_DIR, port);

  const executablePath = resolveChromePath();
  browser = await puppeteer.launch({
    headless: false, // Extensions require headful (run under xvfb in CI)
    executablePath,
    // Puppeteer adds --disable-extensions by default; drop it so our MV3 loads
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--user-data-dir=${path.join(repoRoot, '.e2e-profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=DialMediaRouteProvider',
      '--remote-debugging-port=0',
      '--enable-logging=stderr',
      '--v=1',
      '--vmodule=*extensions*=2',
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ]
  });

  try {
    // Capture extension service worker console/log output in CI logs
    await captureExtensionServiceWorkerLogs(browser);
    // Small pause to allow Chrome to register the extension before first nav
    await new Promise((r) => setTimeout(r, 1500));
    await dumpTargets(browser, '[e2e] targets before nav');
    // Prefer to see the MV3 service worker at least once before first navigation
    try {
      await waitForExtensionServiceWorker(browser, 20000);
    } catch (e) {
      console.warn('[e2e] SW not detected before navigation; continuing anyway:', e?.message || e);
    }
    const page = await browser.newPage();
    // Surface console/page errors to CI logs
    page.on('console', (msg) => console.log(`[console] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', (err) => console.error('[pageerror]', err.message));
    await page.bringToFront();
    await page.goto(`http://localhost:${port}/test`, { waitUntil: 'networkidle0' });
    // Keep watching in background to log if the SW never appears after nav
    void waitForExtensionServiceWorker(browser, 60000).catch((e) =>
      console.warn('[e2e] service worker did not appear within timeout:', e?.message || e)
    );
    await page.waitForSelector('#text', { timeout: 30000 });
    // Wait for content script to inject the (hidden) selection button element.
    // Implement multi reload fallback to avoid races on first navigation after extension load.
    const selectionBtnSel = '[data-xt-id="xt-selection-button"]';
    const quickTimeout = 5000;
    const longTimeout = 30000;
    const maxReloads = 2;
    for (let attempt = 0; attempt <= maxReloads; attempt += 1) {
      try {
        await page.waitForSelector(selectionBtnSel, { timeout: attempt === 0 ? quickTimeout : longTimeout });
        break; // injected
      } catch {
        if (attempt === maxReloads) throw new Error('content script not detected after reloads');
        console.warn(`[e2e] content script not detected, reloading page (attempt ${attempt + 1}/${maxReloads})`);
        await page.reload({ waitUntil: 'networkidle0' });
        await dumpTargets(browser, `[e2e] targets after reload ${attempt + 1}`);
        await page.waitForSelector('#text', { timeout: 30000 });
      }
    }

    // Drag-select the test text to trigger button
    const handle = await page.$('#text');
    if (!handle) {
      throw new Error('[e2e] Could not find element with selector "#text"');
    }
    const box = await handle.boundingBox();
    if (!box) {
      throw new Error('[e2e] Could not get bounding box for "#text"');
    }
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 5, box.y + 5, { steps: 10 });
    await page.mouse.up();

    // Wait until the selection button becomes visible and click it
    await page.waitForSelector('[data-xt-id="xt-selection-button"]', { timeout: 30000, visible: true });
    await page.click('[data-xt-id="xt-selection-button"]');

    // Expect tooltip to show the echoed translation
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-xt-role="translate-result"]');
        return el && el.textContent && el.textContent.includes('こんにちは世界。');
      },
      { timeout: 30000 }
    );

    console.log('[e2e] PASS selection → overlay flow');

    // Trigger full-page translation via custom event and await progress visibility
    await page.evaluate(() => {
      window.dispatchEvent(new Event('xt:translate-page'));
    });
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-xt-role="xt-progress"]');
        return el && getComputedStyle(el).display === 'block';
      },
      { timeout: 30000 }
    );
    // Wait for progress to hide after completion
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-xt-role="xt-progress"]');
        return el && getComputedStyle(el).display === 'none';
      },
      { timeout: 30000 }
    );
    console.log('[e2e] PASS full-page translation progress flow');
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('[e2e] Failed to close browser:', e);
      }
    }
    try {
      await new Promise((r) => server.close(r));
    } catch (e) {
      console.error('[e2e] Failed to close server:', e);
    }
  }
}

function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
  ].filter(Boolean);
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  throw new Error('Chrome executable not found. Set CHROME_PATH to your Chrome binary.');
}

async function startStubServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/test') {
      const content = `<!doctype html><meta charset="utf-8"><title>e2e</title>
        <div id="text">こんにちは世界。</div>
        <p id="p1">これはテスト用の段落です。</p>
        <p id="p2">もう一つの段落です。</p>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(content));
      return res.end(content);
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      return handleChatCompletion(req, res);
    }
    res.statusCode = 404;
    res.end('not found');
  });

  const requested = Number.parseInt(process.env.E2E_PORT || '1234', 10);
  await new Promise((resolve, reject) => {
    server
      .listen(requested, resolve)
      .on('error', (err) => {
        if ((err && /** @type {any} */ (err).code) === 'EADDRINUSE') {
          reject(new Error(`Port ${requested} is already in use. Set E2E_PORT to use a different port.`));
        } else {
          reject(err);
        }
      });
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : requested;
  console.log(`[stub] LM Studio stub listening at http://localhost:${actualPort}`);
  return { server, port: actualPort };
}

import { writeFile } from 'node:fs/promises';
async function writeE2ESettings(extDir, port) {
  try {
    const json = { baseUrl: `http://localhost:${port}/v1` };
    await writeFile(path.join(extDir, 'e2e-settings.json'), JSON.stringify(json), 'utf8');
  } catch (e) {
    console.warn('[e2e] Failed to write e2e-settings.json:', e);
  }
}

function handleChatCompletion(req, res) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const json = JSON.parse(body);
      const userMsg = json?.messages?.find?.((m) => m.role === 'user');
      const content = typeof userMsg?.content === 'string' ? userMsg.content : '';
      const out = JSON.stringify({
        choices: [
          {
            message: { role: 'assistant', content }
          }
        ]
      });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Length', Buffer.byteLength(out));
      res.end(out);
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end(String(e));
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

async function waitForExtensionServiceWorker(browser, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const targets = await browser.targets();
    const ok = targets.some((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for extension service worker');
}

async function dumpTargets(browser, label) {
  try {
    const targets = await browser.targets();
    const summary = targets.map((t) => `${t.type()}:${t.url()}`).join('\n');
    console.log(label + "\n" + summary);
  } catch (e) {
    console.warn('[e2e] failed to dump targets:', e?.message || e);
  }
}

async function captureExtensionServiceWorkerLogs(browser) {
  const attach = async (target) => {
    try {
      if (target.type() !== 'service_worker') return;
      if (!target.url().startsWith('chrome-extension://')) return;
      const client = await target.createCDPSession();
      await client.send('Runtime.enable');
      await client.send('Log.enable');
      client.on('Runtime.consoleAPICalled', (ev) => {
        const args = (ev.args || []).map((a) => a.value ?? a.description).join(' ');
        console.log(`[sw][console:${ev.type}] ${args}`);
      });
      client.on('Log.entryAdded', (payload) => {
        const e = payload.entry;
        console.log(`[sw][log:${e.level}] ${e.text}`);
      });
    } catch (e) {
      console.warn('[e2e] Failed to attach to SW logs:', e?.message || e);
    }
  };

  // Attach to already-existing targets
  const targets = await browser.targets();
  await Promise.all(targets.map(attach));
  // Attach to future service workers (MV3 worker restarts)
  browser.on('targetcreated', attach);
}
