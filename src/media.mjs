// Screenshots and short clips for recaps: compress them with whatever tool the
// machine has (ffmpeg, cwebp, sips), and embed them in the page as data URIs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
export const mimeOf = (src) => MIME[String(src ?? '').split('.').pop().toLowerCase()];
export const isVideo = (src) => /^video/.test(mimeOf(src) ?? '');
// Embedded media past this many bytes (before base64) is a `check` warning; `mediaBudgetMB` overrides it.
export const MEDIA_BUDGET_MB = 12;
export const STILL_MAX = 1600;
export const VIDEO_MAX = 1280;

// A clip's poster is `<name>.poster.jpg` beside it (what `prtour media` writes), unless set.
export const posterOf = (im) => im.poster ?? (isVideo(im.src) ? String(im.src).replace(/\.\w+$/, '.poster.jpg') : null);

export function dataUrl(abs, src = abs) {
  return abs && fs.existsSync(abs) ? `data:${mimeOf(src) ?? 'application/octet-stream'};base64,${fs.readFileSync(abs).toString('base64')}` : null;
}

// Every local file a list of media items embeds (clips and their posters), with sizes.
export function embeddedFiles(items, dir) {
  const out = new Map();
  for (const im of items) {
    for (const src of [im.src, posterOf(im)]) {
      if (!src || /^https?:/.test(src)) continue;
      const abs = path.resolve(dir, src);
      if (fs.existsSync(abs)) out.set(abs, fs.statSync(abs).size);
    }
  }
  return out;
}

export function budgetWarning(files, budgetMB = MEDIA_BUDGET_MB) {
  const total = [...files.values()].reduce((s, n) => s + n, 0);
  if (total <= budgetMB * 1e6) return null;
  const big = [...files].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, n]) => `${path.basename(f)} ${(n / 1e6).toFixed(1)} MB`).join(', ');
  return `media: ${(total / 1e6).toFixed(1)} MB embedded (budget ${budgetMB} MB; largest: ${big}). Run \`prtour media\` on the originals, trim clips, or drop one`;
}

// Width of a PNG, JPEG, GIF or WebP from its header, so stills are only ever scaled down.
export function imageWidth(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) return buf.readUInt32BE(16);
  if (buf.toString('ascii', 0, 3) === 'GIF') return buf.readUInt16LE(6);
  if (buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return 1 + buf.readUIntLE(24, 3);
    if (kind === 'VP8L') return 1 + (buf.readUInt16LE(21) & 0x3fff);
    return buf.readUInt16LE(26) & 0x3fff;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i < buf.length - 9;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return buf.readUInt16BE(i + 7);
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

const has = (cmd) => { try { execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }); return true; } catch { return false; } };
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 1 << 26 });
const ffmpegHas = (encoder) => { try { return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes(` ${encoder} `); } catch { return false; } };

// Stills become webp (ffmpeg with libwebp, or cwebp) or jpg (ffmpeg or sips) at
// most 1600 px wide. Clips and GIFs become muted H.264 mp4 at most 1280 px wide,
// plus a poster frame. Returns one record per input for the caller to print.
export function compress(inputs, outDir, tools = { ffmpeg: has('ffmpeg'), cwebp: has('cwebp'), sips: has('sips') }) {
  fs.mkdirSync(outDir, { recursive: true });
  const webp = tools.ffmpeg && ffmpegHas('libwebp');
  return inputs.map((input) => {
    const base = path.join(outDir, path.basename(input).replace(/\.\w+$/, '').replace(/[^\w.-]+/g, '-'));
    const before = fs.statSync(input).size;
    const ext = path.extname(input).slice(1).toLowerCase();
    const video = ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi', 'gif'].includes(ext);
    if (video) {
      if (!tools.ffmpeg) return { input, error: 'clips need ffmpeg (brew install ffmpeg, apt install ffmpeg)' };
      const out = `${base}.mp4`;
      const poster = `${base}.poster.jpg`;
      run('ffmpeg', ['-y', '-v', 'error', '-i', input, '-an', '-vf', `scale='trunc(min(${VIDEO_MAX},iw)/2)*2':-2,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-movflags', '+faststart', out]);
      run('ffmpeg', ['-y', '-v', 'error', '-i', out, '-vf', 'thumbnail', '-frames:v', '1', '-q:v', '3', poster]);
      return { input, out, poster, before, after: fs.statSync(out).size + fs.statSync(poster).size };
    }
    const width = imageWidth(fs.readFileSync(input));
    const scale = width == null || width > STILL_MAX;
    let out;
    if (webp || tools.cwebp) {
      out = `${base}.webp`;
      if (webp) run('ffmpeg', ['-y', '-v', 'error', '-i', input, '-vf', `scale='min(${STILL_MAX},iw)':-2`, '-c:v', 'libwebp', '-quality', '80', out]);
      else run('cwebp', ['-quiet', '-q', '80', ...(scale && width ? ['-resize', String(STILL_MAX), '0'] : []), input, '-o', out]);
    } else if (tools.ffmpeg) {
      out = `${base}.jpg`;
      run('ffmpeg', ['-y', '-v', 'error', '-i', input, '-vf', `scale='min(${STILL_MAX},iw)':-2`, '-q:v', '4', out]);
    } else if (tools.sips) {
      out = `${base}.jpg`;
      run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', ...(scale ? ['--resampleWidth', String(STILL_MAX)] : []), input, '--out', out]);
    } else return { input, error: 'stills need ffmpeg, cwebp or sips' };
    return { input, out, before, after: fs.statSync(out).size };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import('node:assert')).strict;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  assert.equal(imageWidth(png), 1);
  assert.equal(posterOf({ src: 'media/a.mp4' }), 'media/a.poster.jpg');
  assert.equal(posterOf({ src: 'media/a.webp' }), null);
  assert.equal(budgetWarning(new Map([['a', 5e6]]), 12), null);
  assert.match(budgetWarning(new Map([['/x/a.mp4', 9e6], ['/x/b.png', 4e6]]), 12), /13\.0 MB embedded \(budget 12 MB; largest: a\.mp4 9\.0 MB/);
  console.log('media.mjs ok');
}
