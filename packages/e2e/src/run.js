import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
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

  const server = await startStubServer();

  const executablePath = resolveChromePath();
  const browser = await puppeteer.launch({
    headless: false, // Extensions require headful
    executablePath,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ]
  });

  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:1234/test', { waitUntil: 'networkidle0' });

    // Drag-select the test text to trigger button
    const handle = await page.$('#text');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 5, box.y + 5, { steps: 10 });
    await page.mouse.up();

    // Wait and click overlay translate button
    await page.waitForSelector('[data-xt-id="xt-selection-button"]', { timeout: 4000 });
    await page.click('[data-xt-id="xt-selection-button"]');

    // Expect tooltip to show the echoed translation
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-xt-role="translate-result"]');
        return el && el.textContent && el.textContent.includes('こんにちは世界。');
      },
      { timeout: 8000 }
    );

    console.log('[e2e] PASS selection → overlay flow');
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
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
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(
        `<!doctype html><meta charset="utf-8"><title>e2e</title><div id="text">こんにちは世界。</div>`
      );
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
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
          res.end(out);
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise((resolve, reject) => server.listen(1234, resolve).on('error', reject));
  console.log('[stub] LM Studio stub listening at http://localhost:1234');
  return server;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

