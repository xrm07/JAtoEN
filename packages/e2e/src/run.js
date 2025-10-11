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

  const { server, port } = await startStubServer();

  const executablePath = resolveChromePath();
  const browser = await puppeteer.launch({
    headless: false, // Extensions require headful (run under xvfb in CI)
    executablePath,
    // Puppeteer adds --disable-extensions by default; drop it so our MV3 loads
    ignoreDefaultArgs: ['--disable-extensions'],
    // Use a dedicated user data dir to ensure extension state is preserved during the run
    userDataDir: path.join(repoRoot, '.e2e-profile'),
    args: [
      '--disable-features=DialMediaRouteProvider',
      '--remote-debugging-port=0',
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ]
  });

  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/test`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#text', { timeout: 30000 });
    // Wait for content script to inject the (hidden) selection button element
    await page.waitForSelector('[data-xt-id="xt-selection-button"]', { timeout: 30000 });

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
    try {
      await browser.close();
    } catch (e) {
      console.error('[e2e] Failed to close browser:', e);
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
