import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const root = dirname(new URL(import.meta.url).pathname.replace(/^\/+/, '/'));
const pkgRoot = join(root, '..');

const outDir = join(pkgRoot, 'dist');
const manifestSrc = join(pkgRoot, 'public', 'manifest.json');
const backgroundJs = join(pkgRoot, 'dist', 'background.js');
const contentJs = join(pkgRoot, '..', 'ui-content', 'dist', 'content.js');
// const overlayCss = join(pkgRoot, '..', 'ui-content', 'src', 'overlay.css');
const popupDist = join(pkgRoot, '..', 'ui-popup', 'dist');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// Copy manifest
if (existsSync(manifestSrc)) {
  cpSync(manifestSrc, join(outDir, 'manifest.json'));
}

// Ensure background.js exists (built by tsup)
if (!existsSync(backgroundJs)) {
  console.warn('[assemble] background.js not found. Build background first.');
}

// Copy content.js from ui-content build (hard requirement)
if (!existsSync(contentJs)) {
  throw new Error('[assemble] content.js not found. Ensure @ja-to-en/ui-content build ran before assembling.');
}
cpSync(contentJs, join(outDir, 'content.js'));

// Overlay CSS is currently unused; skip copying for a minimal bundle.

// Copy popup (vite build) as popup.html + assets/
if (existsSync(popupDist)) {
  const htmlPath = join(popupDist, 'index.html');
  if (existsSync(htmlPath)) {
    const html = readFileSync(htmlPath, 'utf8');
    const updated = html.replace(/<title>.*?<\/title>/, '<title>EN⇄JA Translator<\/title>');
    writeFileSync(join(outDir, 'popup.html'), updated);
  }
  // Copy assets dir if present
  const assetsDir = join(popupDist, 'assets');
  if (existsSync(assetsDir)) {
    cpSync(assetsDir, join(outDir, 'assets'), { recursive: true });
  }
} else {
  console.warn('[assemble] ui-popup dist not found. Skipping popup copy.');
}

console.log('[assemble] Extension artifacts prepared in', outDir);
