// HTML -> PDF with headless Chrome/Chromium/Edge, so diagrams, mermaid and
// shadow-DOM diffs print exactly as the page shows them.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.PRTOUR_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'chrome',
].filter(Boolean);

export function findChrome() {
  for (const c of CANDIDATES) {
    if (c.includes('/')) { if (fs.existsSync(c)) return c; continue; }
    try { return execFileSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' }).trim(); } catch {}
  }
  return null;
}

export function htmlToPdf(html, out) {
  const chrome = findChrome();
  if (!chrome) throw new Error('PDF needs Chrome, Chromium or Edge. Install one, or set PRTOUR_CHROME to its path.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prtour-pdf-'));
  const src = path.join(dir, 'page.html');
  fs.writeFileSync(src, html);
  try {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${path.join(dir, 'profile')}`,
      '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=8000', `--print-to-pdf=${path.resolve(out)}`, `file://${src}`], { stdio: 'ignore', timeout: 120000 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  if (!fs.existsSync(out)) throw new Error('Chrome did not write the PDF');
  return out;
}
