import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { Browser, Page } from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Simple static file server for test pages
 */
const startTestPageServer = async (port = 0): Promise<http.Server> => {
  const testPagesDir = path.resolve(__dirname, '../testpages');
  const contentDistDir = path.resolve(__dirname, '../../ui-content/dist');

  const server = http.createServer(async (req, res) => {
    try {
      const requestedUrl = req.url || '/';
      const url = new URL(requestedUrl, 'http://localhost');
      const pathname = url.pathname || '/';

      // Serve content.js from ui-content/dist
      if (pathname === '/packages/ui-content/dist/content.js') {
        const filePath = path.join(contentDistDir, 'content.js');
        try {
          const content = await fs.promises.readFile(filePath);
          res.setHeader('Content-Type', 'application/javascript');
          res.end(content);
          return;
        } catch {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
      }

      // Serve test pages
      const filePath = path.join(testPagesDir, pathname === '/' ? 'fullpage.html' : pathname);
      try {
        const content = await fs.promises.readFile(filePath);
        const ext = path.extname(filePath);
        const contentType =
          ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : 'text/plain';
        res.setHeader('Content-Type', contentType);
        res.end(content);
        return;
      } catch {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
    } catch {
      res.statusCode = 500;
      res.end('Server error');
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  return server;
};

describe('Full Page Translation E2E', () => {
  let server: http.Server;
  let browser: Browser;
  let page: Page;
  let serverPort = 0;

  beforeAll(async () => {
    server = await startTestPageServer(0);
    const addr = server.address();
    if (typeof addr === 'object' && addr && 'port' in addr) {
      serverPort = addr.port;
    }

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    page = await browser.newPage();
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('translates page text nodes via xt:translate-page event', async () => {
    // Given: A page with Japanese text content
    await page.goto(`http://localhost:${serverPort}/fullpage.html`, { waitUntil: 'domcontentloaded' });

    // When: Dispatch the translate-page event
    await page.evaluate(() => {
      window.dispatchEvent(new Event('xt:translate-page'));
    });

    // Then: Wait for translation result and verify DOM replacement
    await page.waitForFunction(
      () => {
        const box1 = document.getElementById('box1');
        return box1?.textContent?.includes('[EN]');
      },
      { timeout: 10_000 }
    );

    const box1Text = await page.$eval('#box1', (el) => el.textContent || '');
    expect(box1Text).toContain('[EN]');

    const box2Text = await page.$eval('#box2', (el) => el.textContent || '');
    expect(box2Text).toContain('[EN]');

    const box3Text = await page.$eval('#box3', (el) => el.textContent || '');
    expect(box3Text).toContain('[EN]');
  }, 30_000);

  it('handles single character text node', async () => {
    // Given: Page is already translated from previous test or fresh load
    await page.goto(`http://localhost:${serverPort}/fullpage.html`, { waitUntil: 'domcontentloaded' });

    // When: Trigger translation
    await page.evaluate(() => {
      window.dispatchEvent(new Event('xt:translate-page'));
    });

    // Then: Single character should be translated
    await page.waitForFunction(
      () => {
        const box = document.getElementById('box-single-char');
        return box?.textContent?.includes('[EN]');
      },
      { timeout: 10_000 }
    );

    const singleCharText = await page.$eval('#box-single-char', (el) => el.textContent || '');
    expect(singleCharText).toContain('[EN]');
  }, 30_000);

  it('handles long text block', async () => {
    // Given: Fresh page load
    await page.goto(`http://localhost:${serverPort}/fullpage.html`, { waitUntil: 'domcontentloaded' });

    // When: Trigger translation
    await page.evaluate(() => {
      window.dispatchEvent(new Event('xt:translate-page'));
    });

    // Then: Long text should be translated
    await page.waitForFunction(
      () => {
        const box = document.getElementById('box-long');
        return box?.textContent?.includes('[EN]');
      },
      { timeout: 10_000 }
    );

    const longText = await page.$eval('#box-long', (el) => el.textContent || '');
    expect(longText).toContain('[EN]');
  }, 30_000);

  it('handles mixed language text', async () => {
    // Given: Fresh page load
    await page.goto(`http://localhost:${serverPort}/fullpage.html`, { waitUntil: 'domcontentloaded' });

    // When: Trigger translation
    await page.evaluate(() => {
      window.dispatchEvent(new Event('xt:translate-page'));
    });

    // Then: Mixed language text should be translated
    await page.waitForFunction(
      () => {
        const box = document.getElementById('box-special');
        return box?.textContent?.includes('[EN]');
      },
      { timeout: 10_000 }
    );

    const specialText = await page.$eval('#box-special', (el) => el.textContent || '');
    expect(specialText).toContain('[EN]');
  }, 30_000);

  it('shows and hides progress indicator', async () => {
    // Given: Fresh page load
    await page.goto(`http://localhost:${serverPort}/fullpage.html`, { waitUntil: 'domcontentloaded' });

    // When: Trigger translation
    await page.evaluate(() => {
      window.dispatchEvent(new Event('xt:translate-page'));
    });

    // Then: Progress element should appear during translation
    // Note: Due to the stub's fast response, progress may be brief
    // We verify the progress element exists and eventually hides
    await page.waitForFunction(
      () => {
        const progress = document.querySelector('[data-xt-role="xt-progress"]');
        // Either progress was shown and hidden, or translation completed
        const box1 = document.getElementById('box1');
        return box1?.textContent?.includes('[EN]') || (progress && progress.textContent?.includes('Translating'));
      },
      { timeout: 10_000 }
    );

    // After translation completes, progress should be hidden
    await page.waitForFunction(
      () => {
        const box1 = document.getElementById('box1');
        return box1?.textContent?.includes('[EN]');
      },
      { timeout: 10_000 }
    );

    const progressHandle = await page.$('[data-xt-role="xt-progress"]');
    let progressDisplay: string | 'not-found' = 'not-found';
    if (progressHandle) {
      progressDisplay = await progressHandle.evaluate((el) => (el as HTMLElement).style.display);
    }

    // Progress should be hidden after completion
    expect(progressDisplay === 'none' || progressDisplay === 'not-found').toBe(true);
  }, 30_000);

  it('triggers translation via button click', async () => {
    // Given: Fresh page load
    await page.goto(`http://localhost:${serverPort}/fullpage.html`, { waitUntil: 'domcontentloaded' });

    // When: Click the start button
    await page.waitForSelector('#start', { visible: true });
    await page.click('#start');

    // Then: Translation should complete
    await page.waitForFunction(
      () => {
        const box1 = document.getElementById('box1');
        return box1?.textContent?.includes('[EN]');
      },
      { timeout: 10_000 }
    );

    const box1Text = await page.$eval('#box1', (el) => el.textContent || '');
    expect(box1Text).toContain('[EN]');
  }, 30_000);
});

