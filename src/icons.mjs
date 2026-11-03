// Icons for tours and recaps, inlined so pages stay one file.
// - Generic: Lucide (lucide.dev, ISC), e.g. "cpu", "file-text", "mic".
// - Brands: SVGL (svgl.app, its registry on GitHub), by catalog title, e.g.
//   "Microsoft Word", "Slack", "GitHub". Prefix "svgl:" or "lucide:" to force one.
// Fetched once from pinned sources and cached in ~/.cache/prtour. Offline with
// no cache, an icon is skipped with a warning; nothing else breaks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CACHE = path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'prtour', 'icons');
const LUCIDE = 'https://cdn.jsdelivr.net/npm/lucide-static@1.67.0/icons';
const SVGL = 'https://raw.githubusercontent.com/pheralb/svgl/main';

async function cached(key, url, maxAgeDays = 365) {
  const file = path.join(CACHE, key);
  try { if (Date.now() - fs.statSync(file).mtimeMs < maxAgeDays * 864e5) return fs.readFileSync(file, 'utf8'); } catch {}
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'prtour' } });
    if (!res.ok) return null;
    const text = await res.text();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return text;
  } catch { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } }
}

// SVGL's catalog is a TypeScript array of { title, route } (route is a path or { light, dark }).
let registry;
async function svglRoute(title) {
  registry ??= (async () => {
    const src = await cached('svgl-svgs.ts', `${SVGL}/src/data/svgs.ts`, 7);
    if (!src) return new Map();
    const map = new Map();
    for (const block of src.split(/\n\s*\{\s*\n/)) {
      const t = block.match(/title:\s*["'`]([^"'`]+)["'`]/)?.[1];
      const light = block.match(/route:\s*\{[^}]*light:\s*["'`]([^"'`]+)/)?.[1] ?? block.match(/route:\s*["'`]([^"'`]+)/)?.[1];
      if (t && light) map.set(t.toLowerCase(), light);
    }
    return map;
  })();
  return (await registry).get(title.toLowerCase());
}

const SAFE = (svg) => svg && /<svg[\s>]/i.test(svg) && !/<script|<foreignObject|\son[a-z]+\s*=|javascript:/i.test(svg);
const clean = (svg) => svg.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g, '').trim();

export async function resolveIcon(name) {
  const [kind, id] = /^(svgl|lucide):/.test(name) ? name.split(/:(.*)/s) : [null, name];
  if (kind !== 'svgl' && /^[a-z0-9-]+$/.test(id)) {
    const svg = await cached(`lucide-${id}.svg`, `${LUCIDE}/${id}.svg`);
    if (SAFE(svg)) return { svg: clean(svg), kind: 'lucide' };
    if (kind === 'lucide') return null;
  }
  const route = await svglRoute(id);
  if (!route) return null;
  const svg = await cached(`svgl-${path.basename(route)}`, `${SVGL}/static${route}`);
  return SAFE(svg) ? { svg: clean(svg), kind: 'brand' } : null;
}

export async function resolveIcons(names) {
  const out = new Map();
  const missing = [];
  await Promise.all([...new Set(names.filter(Boolean))].map(async (n) => { const ic = await resolveIcon(n); if (ic) out.set(n, ic); else missing.push(n); }));
  return { icons: out, missing };
}

// Every icon name a tour or recap mentions.
export function iconNames(spec) {
  const names = [];
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === 'icon' && typeof v === 'string') names.push(v); else walk(v); } };
  walk(spec);
  return names;
}

// Inline HTML: brand logos keep their colors; Lucide strokes follow the text color.
export function iconHTML(icons, name, cls = 'ic') {
  const ic = name && icons?.get(name);
  if (!ic) return '';
  return `<span class="${cls} ${ic.kind === 'brand' ? 'ic-brand' : 'ic-line'}" aria-hidden="true">${ic.svg}</span>`;
}

// Nested <svg> for use inside another SVG (diagram nodes), size x size at (x, y).
export function iconSVG(icons, name, x, y, size = 16) {
  const ic = name && icons?.get(name);
  if (!ic) return '';
  return ic.svg.replace(/<svg\b([^>]*)>/i, (m, attrs) => `<svg${attrs.replace(/\s(width|height|x|y|class)="[^"]*"/g, '')} x="${x}" y="${y}" width="${size}" height="${size}" class="dg-ic ${ic.kind === 'brand' ? 'ic-brand' : 'ic-line'}">`);
}

export const ICON_CSS = `.ic{display:inline-flex;width:1.15em;height:1.15em;vertical-align:-.2em;flex:none}.ic svg{width:100%;height:100%}.ic-line{color:currentColor}.ic-line svg{stroke-width:1.75}
.ic-chip{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;background:var(--card);border:1px solid var(--border);box-shadow:0 1px 2px rgb(0 0 0/.04)}.ic-chip .ic{width:19px;height:19px}
.dg-ic.ic-line{color:var(--muted-foreground)}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import('node:assert')).strict;
  assert.deepEqual(iconNames({ a: { icon: 'cpu' }, b: [{ icon: 'Microsoft Word' }, { nodes: [{ icon: 'mic' }] }] }), ['cpu', 'Microsoft Word', 'mic']);
  assert.equal(SAFE('<svg onload="x()"></svg>'), false);
  assert.equal(SAFE('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'), true);
  const fake = new Map([['x', { svg: '<svg width="24" height="24" viewBox="0 0 24 24"><path/></svg>', kind: 'lucide' }]]);
  assert.match(iconSVG(fake, 'x', 3, 4), /<svg viewBox="0 0 24 24" x="3" y="4" width="16" height="16" class="dg-ic ic-line">/);
  console.log('icons.mjs ok');
}
