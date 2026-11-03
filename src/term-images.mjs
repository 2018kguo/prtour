// Inline images in terminals. kitty graphics protocol (kitty, Ghostty, WezTerm,
// Konsole, and any terminal that answers the query) or the iTerm2 protocol
// (iTerm2, WezTerm). Everything else gets text, so callers must have a text
// fallback.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Ask the terminal whether it speaks the kitty graphics protocol: a 1x1 query
// image, answered with `_Gi=31;OK`. Silent terminals time out after 150ms.
function probeKitty() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(false);
  return new Promise((resolve) => {
    let buf = '';
    const done = (ok) => { clearTimeout(timer); process.stdin.off('data', on); process.stdin.setRawMode(false); process.stdin.pause(); resolve(ok); };
    const on = (d) => { buf += d.toString('latin1'); if (buf.includes('_Gi=31')) done(buf.includes('OK')); else if (/\x1b\[\?[\d;]*c/.test(buf)) done(false); };
    const timer = setTimeout(() => done(false), 150);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', on);
    // The query, then a device-attributes request: every terminal answers DA, so a
    // terminal without graphics support replies fast instead of waiting out the timer.
    process.stdout.write('\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\\x1b[c');
  });
}

export async function detect(mode = 'auto') {
  if (mode === 'none' || mode === false) return null;
  if (mode === 'kitty' || mode === 'iterm') return mode;
  const tp = process.env.TERM_PROGRAM ?? '';
  if (process.env.KITTY_WINDOW_ID || /kitty/.test(process.env.TERM ?? '') || tp === 'ghostty') return 'kitty';
  if (await probeKitty()) return 'kitty';
  if (tp === 'iTerm.app' || tp === 'WezTerm') return 'iterm';
  return null;
}

export function imageEscape(proto, png, { cols } = {}) {
  const b64 = png.toString('base64');
  if (proto === 'iterm') return `\x1b]1337;File=inline=1;size=${png.length};preserveAspectRatio=1${cols ? `;width=${cols}` : ''}:${b64}\x07\n`;
  // kitty: PNG (f=100), transmit+display (a=T), 4096-byte chunks.
  const chunks = b64.match(/.{1,4096}/g);
  return `${chunks.map((c, i) => `\x1b_G${i ? '' : `a=T,f=100,q=2${cols ? `,c=${cols}` : ''},`}m=${i < chunks.length - 1 ? 1 : 0};${c}\x1b\\`).join('')}\n`;
}

const has = (cmd) => { try { execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }); return true; } catch { return false; } };

// SVG -> PNG with whatever is installed; null when nothing is.
export function svgToPng(svg, width = 1600) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prtour-svg-'));
  const src = path.join(dir, 'd.svg');
  const out = path.join(dir, 'd.png');
  fs.writeFileSync(src, svg);
  try {
    if (has('rsvg-convert')) execFileSync('rsvg-convert', ['-w', String(width), '-b', 'white', '-o', out, src]);
    else if (has('resvg')) execFileSync('resvg', ['-w', String(width), '--background', 'white', src, out]);
    else if (has('magick')) execFileSync('magick', ['-density', '200', '-background', 'white', src, out]);
    else if (process.platform === 'darwin') {
      // QuickLook renders a square thumbnail; crop it back to the SVG's aspect ratio.
      execFileSync('qlmanage', ['-t', '-s', String(width), '-o', dir, src], { stdio: 'ignore' });
      fs.renameSync(`${src}.png`, out);
      const vb = svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/);
      if (vb) execFileSync('sips', ['-c', String(Math.ceil((width * vb[2]) / vb[1]) + 8), String(width), out], { stdio: 'ignore' });
    }
    else return null;
    return fs.readFileSync(out);
  } catch { return null; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import('node:assert')).strict;
  const png = Buffer.alloc(5000, 1);
  const k = imageEscape('kitty', png);
  assert.ok(k.startsWith('\x1b_Ga=T,f=100,q=2,m=1;') && k.includes('\x1b_Gm=0;'));
  assert.ok(imageEscape('iterm', png).startsWith('\x1b]1337;File=inline=1;size=5000'));
  assert.equal(await detect('none'), null);
  console.log('term-images.mjs ok');
}
