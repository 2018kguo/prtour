// Resolved tour -> one self-contained HTML file. Diffs are pre-rendered by
// @pierre/diffs into declarative shadow DOM, so the page needs no bundle and
// works from file://, an artifact host, or `prtour open`.
import { preloadPatchDiff } from '@pierre/diffs/ssr';
import { filePatch } from './patch.mjs';
import fs from 'node:fs';
import { diagramSVG } from './diagram.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ponytail: tiny markdown (paragraphs, lists, `code`, **bold**, [links](url)); swap for a real parser if tours need tables
export function md(text) {
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const blocks = (Array.isArray(text) ? text.join('\n\n') : String(text ?? '')).trim().split(/\n\s*\n/).filter(Boolean);
  return blocks.map((b) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) {
      const tag = /^\s*\d/.test(lines[0]) ? 'ol' : 'ul';
      return `<${tag}>${lines.map((l) => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s/, ''))}</li>`).join('')}</${tag}>`;
    }
    return `<p>${inline(b).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

const OPTS = (o) => ({ theme: { dark: 'pierre-dark', light: 'pierre-light' }, themeType: 'system', diffStyle: o.split ? 'split' : 'unified', overflow: o.wrap ? 'wrap' : 'scroll', unsafeCSS: '[data-column-number]{cursor:pointer}' });

const noteHTML = (n) => `<div class="note" id="note-${n.n}" data-note="${n.n}"><span class="note-n" title="${esc(n.label)}">${n.n}</span><div class="note-body">${n.title ? `<b>${esc(n.title)}</b> ` : ''}${md(n.body).replace(/^<p>|<\/p>$/g, '')}</div><button class="reply" data-reply="${n.n}" title="Reply">Reply</button></div>`;

async function diffHTML(file, hunks, notes, o, reviewable = false) {
  o = { ...o, reviewable };
  if (file.binary || !file.hunks.length) {
    return `<div class="nodiff"><b>${esc(file.path)}</b> <span class="muted">${file.binary ? 'binary file' : file.status}${file.oldPath && file.oldPath !== file.path ? ` from ${esc(file.oldPath)}` : ''}</span></div>`;
  }
  const anchored = notes.filter((n) => n.anchored);
  const annotations = [...new Map(anchored.map((n) => [`${n.side}-${n.line}`, { side: n.side, lineNumber: n.line }])).values()];
  const { prerenderedHTML } = await preloadPatchDiff({ patch: filePatch(file, hunks), options: OPTS(o), annotations });
  const html = o.shared ? tokenClasses(dedupe(prerenderedHTML, o.shared), o.tokens) : prerenderedHTML;
  const slots = annotations.map((a) => `<div slot="annotation-${a.side}-${a.lineNumber}">${anchored.filter((n) => n.side === a.side && n.line === a.lineNumber).map(noteHTML).join('')}</div>`).join('');
  const tag = file.part ? `<span slot="header-prefix" class="part">#${esc(file.part)}</span>` : '';
  const rev = o.reviewable ? `<label slot="header-metadata" class="file-rev"><input type="checkbox" data-file-reviewed="${esc(file.path)}"> Reviewed</label>` : '';
  return `<diffs-container data-file="${esc(file.path)}"><template shadowrootmode="open">${html}</template>${tag}${rev}${slots}</diffs-container>`;
}

// Every shadow root carries the same ~50 KB of core CSS and icon sprite. Keep
// one copy; the client adopts it into each root. Blocks that differ stay inline.
const SHARED = [/<style data-core-css="">[\s\S]*?<\/style>/, /<style data-theme-css="">[\s\S]*?<\/style>/, /<svg data-icon-sprite[\s\S]*?<\/svg>/];
function dedupe(html, shared) {
  return SHARED.reduce((h, re, i) => {
    const m = h.match(re);
    if (!m) return h;
    shared[i] ??= m[0];
    return shared[i] === m[0] ? h.replace(m[0], `<template data-shared="${i}"></template>`) : h;
  }, html);
}

// Syntax spans repeat ~45 distinct inline styles thousands of times (about half
// the file). Swap each for a short class backed by one shared sheet.
function tokenClasses(html, tokens) {
  return html.replace(/<span style="(--diffs-token[^"]*)">/g, (_, css) => {
    if (!tokens.has(css)) tokens.set(css, `k${tokens.size}`);
    return `<span class="${tokens.get(css)}">`;
  });
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
// Images and clips are embedded, so the page stays one file.
function mediaHTML(im) {
  const ext = String(im.src).split('.').pop().toLowerCase();
  const url = /^https?:/.test(im.src) ? im.src : im.abs && fs.existsSync(im.abs) ? `data:${MIME[ext] ?? 'application/octet-stream'};base64,${fs.readFileSync(im.abs).toString('base64')}` : null;
  if (!url) return '';
  const el = /^video/.test(MIME[ext] ?? '') ? `<video src="${url}" controls muted loop playsinline></video>` : `<img src="${url}" alt="${esc(im.alt ?? im.caption ?? '')}" loading="lazy">`;
  return `<figure class="fig">${el}${im.caption ? `<figcaption>${esc(im.caption)}</figcaption>` : ''}</figure>`;
}

function mapHTML(d) {
  if (!d?.nodes?.length) return '';
  const added = d.nodes.filter((x) => x.change === 'new').length;
  return `<div class="map"><div class="map-head"><span>${esc(d.title ?? 'Before / after')}</span><span class="add">${added ? `+${added}` : ''}</span></div>${d.caption ? `<div class="map-cap">${esc(d.caption)}</div>` : ''}${diagramSVG(d)}</div>`;
}

const visualsHTML = (v) => [mapHTML(v.diagram), v.mermaid ? `<div class="map"><pre class="mermaid">${esc(v.mermaid)}</pre></div>` : '', ...(v.images ?? []).map(mediaHTML)].filter(Boolean).join('');

const fileId = (p) => `f-${p.replace(/[^a-zA-Z0-9]+/g, '-')}`;
const counts = (a, d) => `${a ? `<span class="add">+${a}</span>` : ''}${a && d ? ' ' : ''}${d ? `<span class="del">−${d}</span>` : ''}`;
const hunkCounts = (f, hs) => hs.reduce(([a, d], i) => [a + f.hunks[i].additions, d + f.hunks[i].deletions], [0, 0]);
const entryCounts = (e) => hunkCounts(e.file, e.file.hunks.map((_, i) => i).filter((i) => !e.hunks || e.hunks.includes(i)));
const split = (p) => { const i = p.lastIndexOf('/'); return [p.slice(i + 1), i < 0 ? '' : p.slice(0, i + 1)]; };
const fileRow = (label, href, a, d, extra = '') => { const [name, dir] = split(label); return `<li><a href="${href}"><span class="fname">${esc(name)}</span> <span class="fdir">${esc(dir)}</span>${extra}</a><span class="fcount">${counts(a, d)}</span></li>`; };
const n2 = (n) => String(n).padStart(2, '0');

export async function renderHTML(r, opts = {}) {
  const o = { ...opts, shared: [], tokens: new Map() };
  const t = r.tour;
  const s = r.stats;
  const notesFor = (e) => r.notes.filter((n) => n.entry === e);
  const eid = (ci, e) => `${fileId(e.file.path)}-${ci + 1}`;
  const N = r.chapters.length;

  const chapters = [];
  for (const [ci, c] of r.chapters.entries()) {
    const cards = [];
    for (const e of c.entries) {
      const ns = notesFor(e);
      const loose = ns.filter((n) => !n.anchored).map(noteHTML).join('');
      const rest = e.hunks ? `${e.file.hunks.length - e.hunks.length} more hunk(s) of this file are not in review` : e.cut ? 'Only these lines are in review' : '';
      cards.push(`<div class="card" id="${eid(ci, e)}">${loose}${await diffHTML(e.file, e.hunks, ns, o, true)}${rest ? `<div class="rest"><a href="#files" data-tab="files">${rest}</a></div>` : ''}</div>`);
    }
    chapters.push(`<section class="ch" id="ch-${ci + 1}" data-chapter="${ci + 1}">
<div class="ch-text"><h2>${esc(c.title)}</h2>
<div class="ch-meta"><span>${n2(ci + 1)} / ${n2(N)}</span><label><input type="checkbox" data-reviewed="${ci + 1}"> Reviewed</label><button class="link" data-reply-chapter="${ci + 1}">Comment</button></div>
${md(c.body)}
<ul class="flist">${c.entries.map((e) => fileRow(r.label(e.file.path), `#${eid(ci, e)}`, ...entryCounts(e), e.hunks || e.cut ? ' <span class="fdir">(part)</span>' : '')).join('')}</ul></div>
<div class="ch-code">${visualsHTML(c.visual)}${cards.join('')}</div></section>`);
  }

  // Files tab: everything in the PR, guide files first, then what was left out and why.
  const inGuide = r.chapters.flatMap((c, ci) => c.entries.map((e) => fileRow(r.label(e.file.path), `#${eid(ci, e)}`, ...entryCounts(e), ` <span class="fdir">· ${n2(ci + 1)}</span>`)));
  const hidden = [];
  for (const h of r.hidden) {
    const items = [];
    for (const f of h.files) items.push(`<details><summary>${fileRowInline(r.label(f.path), f.additions, f.deletions)}</summary>${await diffHTML(f, null, [], o)}</details>`);
    hidden.push(`<h3>${esc(h.reason)} <span class="muted">${h.files.length}</span></h3>${items.join('')}`);
  }
  if (r.partial.length) {
    const items = [];
    for (const p of r.partial) items.push(`<details><summary>${fileRowInline(r.label(p.file.path), ...hunkCounts(p.file, p.hunks))}</summary>${await diffHTML(p.file, p.hunks, [], o)}</details>`);
    hidden.push(`<h3>The rest of files shown in part <span class="muted">${r.partial.length}</span></h3>${items.join('')}`);
  }
  const hiddenCount = r.hidden.reduce((n, h) => n + h.files.length, 0);

  const top = visualsHTML({ diagram: t.diagram, mermaid: t.mermaid, images: t.images });
  const map = top ? `<div class="intro-vis">${top}</div>` : '';
  const anyMermaid = t.mermaid || r.chapters.some((c) => c.visual.mermaid);
  const meta = [t.number && (t.url ? `<a href="${esc(t.url)}">#${t.number}</a>` : `#${t.number}`), t.author && esc(t.author), counts(s.additions, s.deletions)].filter(Boolean).join('<span class="sep">·</span>');
  const id = `${t.repo ?? ''}#${t.number ?? t.head ?? t.title ?? ''}`;
  const scope = `You'll review ${s.shown.toLocaleString()} of ${s.total.toLocaleString()} changed lines.${hiddenCount ? ` ${hiddenCount} file${hiddenCount > 1 ? 's are' : ' is'} left out.` : ''} <a href="#files" data-tab="files">See all files</a>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.title || 'Guided review')}</title><meta name="prtour-id" content="${esc(id)}">${o.live ? '<meta name="prtour-live" content="1">' : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<style>${CSS}</style></head><body>
<nav class="tabs"><a href="#guide" data-tab="guide" class="on">Guide</a><a href="#files" data-tab="files">Files <span class="muted">${s.files}</span></a><span class="grow"></span><span class="muted small" id="progress"></span></nav>
<main>
<div data-panel="guide">
<header class="head"><h1>${esc(t.title || 'Guided review')}</h1><div class="meta">${meta}</div></header>
<section class="intro${map ? '' : ' solo'}"><div class="intro-text"><h2>Overview</h2>${md(t.summary) || '<p class="muted">No summary yet.</p>'}
${t.steps?.length ? `<ol class="steps">${t.steps.map((x) => `<li>${md(x).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ol>` : ''}
${r.parts.length ? `<ol class="stack">${r.parts.map((p) => `<li><span class="part">#${esc(p.key)}</span>${p.url ? `<a href="${esc(p.url)}">${esc(p.title ?? '')}</a>` : esc(p.title ?? '')} <span class="muted small">${counts(p.additions, p.deletions)}</span></li>`).join('')}</ol>` : ''}
<p class="scope">${scope}</p>${t.skipped ? `<p class="muted small">${md(t.skipped).replace(/^<p>|<\/p>$/g, '')}</p>` : ''}${t.allowLarge ? `<p class="muted small">Longer than usual: ${esc(t.allowLarge)}</p>` : ''}</div>${map}</section>
${chapters.join('\n')}
<footer class="muted small">Made with <a href="https://github.com/2018kguo/prtour">prtour</a> · diffs by <a href="https://diffs.com">@pierre/diffs</a></footer>
</div>
<div data-panel="files" hidden>
<header class="head"><h1>Files</h1><div class="meta">${s.files} files · ${counts(s.additions, s.deletions)}</div></header>
<section class="files-tab"><div><h3>In the guide</h3><ul class="flist">${inGuide.join('')}</ul></div><div class="not">${hidden.length ? `<h2>Not in review</h2><p class="muted small">Still part of the PR. Open any file to read it.</p>${hidden.join('')}` : ''}</div></section>
</div>
</main>
<aside id="fb" hidden><div class="fb-head"><b id="fb-title"></b><button id="fb-x" class="link" aria-label="Close">Close</button></div><textarea id="fb-text" rows="4" placeholder="Comment for the author or agent"></textarea><div class="fb-row"><span class="muted small">⌘↵ to save</span><button id="fb-save">Save</button></div></aside>
<div id="fb-bar" hidden><span id="fb-count"></span><button id="fb-copy">Copy feedback</button><button id="fb-clear" class="link">Clear</button></div>
<template id="pierre-shared">${o.shared.map((x, i) => `<template data-i="${i}">${x}</template>`).join('')}</template>
<style id="pierre-tokens" media="not all">${[...o.tokens].map(([css, k]) => `.${k}{${css}}`).join('')}:host([data-collapsed]) pre{display:none}[data-diffs-header]{cursor:pointer}</style>
<script>${ADOPT}</script><script>${CLIENT}</script>${anyMermaid ? MERMAID : ''}</body></html>`;
}

// Mermaid needs its library: fetched only when a tour uses it. Offline, the source stays readable.
const MERMAID = `<script type="module">try{const{default:m}=await import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs');m.initialize({startOnLoad:false,theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'neutral',fontFamily:'Inter, -apple-system, sans-serif'});await m.run({querySelector:'pre.mermaid'})}catch(e){}</script>`;

const fileRowInline = (label, a, d) => { const [name, dir] = split(label); return `<span class="fname">${esc(name)}</span> <span class="fdir">${esc(dir)}</span> <span class="fcount">${counts(a, d)}</span>`; };

const CSS = `
:root{--bg:#f8f8f7;--fg:#1c1c1e;--muted:#8a8a8e;--soft:#5f5f63;--line:#e7e7e4;--card:#fff;--accent:#0a66ff;--add:#1f883d;--del:#cf222e;--addbg:#ecf7ee;--chg:#b26b00;--chgbg:#fff6e5;--note:#fbfaf7;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0e0e0f;--fg:#ededee;--muted:#8b8b90;--soft:#b4b4b8;--line:#262628;--card:#151517;--accent:#5b9dff;--add:#3fb950;--del:#f85149;--addbg:#12261a;--chg:#d29922;--chgbg:#2a2210;--note:#19191b}}
*{box-sizing:border-box}html{scroll-padding-top:72px}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}a:hover{color:var(--accent)}
code{font:.86em ui-monospace,SFMono-Regular,Menlo,monospace;background:color-mix(in srgb,var(--fg) 6%,transparent);padding:1px 6px;border-radius:5px}
.muted{color:var(--muted)}.small{font-size:13px}.add{color:var(--add)}.del{color:var(--del)}
button{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:7px;padding:3px 10px;cursor:pointer}
button.link{border:0;background:none;padding:0;color:var(--muted)}button.link:hover{color:var(--accent)}
.tabs{position:sticky;top:0;z-index:5;display:flex;gap:6px;align-items:center;padding:14px clamp(16px,6vw,96px);background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px)}
.tabs a{padding:5px 14px;border-radius:8px;color:var(--soft);font-size:15px}.tabs a.on{background:var(--card);color:var(--fg);box-shadow:0 0 0 1px var(--line)}.grow{flex:1}
main{padding:8px clamp(16px,6vw,96px) 140px;max-width:1640px;margin:0 auto}
.head{margin:28px 0 8px}h1{font-size:28px;line-height:1.25;font-weight:600;letter-spacing:-.015em;margin:0 0 8px}
.meta{color:var(--muted);font-size:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sep{opacity:.5}
h2{font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-.01em;margin:0 0 10px}h3{font-size:15px;font-weight:600;margin:28px 0 10px}
p{margin:0 0 14px}
.intro{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:48px;margin:48px 0 96px;align-items:start}.intro.solo{grid-template-columns:minmax(0,720px)}
.intro-text{color:var(--fg)}.steps{padding-left:22px;margin:0 0 16px}.steps li{margin:6px 0}
.scope{color:var(--soft);font-size:14px}.scope a{color:var(--accent)}
.stack{list-style:none;padding:0;margin:0 0 16px}.stack li{margin:6px 0}
.part{font:600 11px ui-monospace,Menlo,monospace;color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);border-radius:5px;padding:0 5px;margin-right:8px}
.intro-vis,.ch-code{display:flex;flex-direction:column;gap:20px}
.fig{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}.fig img,.fig video{display:block;width:100%;height:auto}.fig figcaption{padding:10px 16px;font-size:14px;color:var(--soft);border-top:1px solid var(--line)}
pre.mermaid{margin:0;background:none;font:13px ui-monospace,Menlo,monospace;color:var(--muted);white-space:pre-wrap}pre.mermaid[data-processed]{color:inherit;display:flex;justify-content:center}
.map{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 22px 22px;overflow-x:auto}
.map-head{display:flex;justify-content:space-between;font-weight:500}.map-cap{color:var(--muted);font-size:14px;margin:2px 0 16px}
.dg{width:100%;height:auto;display:block;font:14px ui-monospace,SFMono-Regular,Menlo,monospace}
.dg-box{fill:var(--card);stroke:var(--line)}.dg-new.dg-box{fill:var(--addbg);stroke:color-mix(in srgb,var(--add) 35%,transparent)}.dg-changed.dg-box{fill:var(--chgbg);stroke:color-mix(in srgb,var(--chg) 35%,transparent)}
.dg-bar.dg-new{fill:var(--add)}.dg-bar.dg-changed{fill:var(--chg)}.dg-label{fill:var(--fg)}
.dg-chip{fill:none;stroke:var(--line)}.dg-chiptext{fill:var(--muted);font-size:11px}
.dg-edge{fill:none;stroke:var(--muted);stroke-width:1;opacity:.7}.dg-arrowhead{fill:none;stroke:var(--muted);stroke-width:1.2}.dg-elabel{fill:var(--muted);font:12px Inter,-apple-system,sans-serif}
.dg-link:hover .dg-box{stroke:var(--accent)}
.ch{display:grid;grid-template-columns:minmax(260px,420px) minmax(0,1fr);gap:56px;margin:0 0 120px}
.ch-text{position:sticky;top:72px;align-self:start;max-height:calc(100vh - 96px);overflow:auto}
.ch-meta{display:flex;gap:16px;align-items:center;color:var(--muted);font-size:14px;margin:-2px 0 18px}.ch-meta label{display:flex;gap:6px;align-items:center;cursor:pointer}
.ch.done h2{color:var(--muted)}
.flist{list-style:none;padding:0;margin:20px 0 0;font-size:14px}.flist li{display:flex;justify-content:space-between;gap:12px;padding:5px 0}
.flist a{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fname{color:var(--fg)}.fdir{color:var(--muted)}.fcount{white-space:nowrap;font:13px ui-monospace,Menlo,monospace}
.ch-code{min-width:0;display:flex;flex-direction:column;gap:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
diffs-container{display:block}
.file-rev{display:inline-flex;gap:6px;align-items:center;margin-left:14px;color:var(--muted);font:13px Inter,-apple-system,sans-serif;cursor:pointer}
.rest{border-top:1px solid var(--line);padding:8px 16px;font-size:13px;color:var(--muted)}.rest a:hover{color:var(--accent)}
.nodiff{padding:12px 16px;font:13px ui-monospace,Menlo,monospace}
.note{display:flex;gap:10px;align-items:flex-start;font:14px/1.55 Inter,-apple-system,sans-serif;white-space:normal;color:var(--fg);background:var(--note);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:10px 16px}
.card>.note{border-top:0}.note p{margin:0 0 6px}.note-body{flex:1}
.note-n{flex:none;width:20px;height:20px;border-radius:10px;background:var(--fg);color:var(--bg);font:600 11px/20px Inter,sans-serif;text-align:center;margin-top:1px}
.note .reply{opacity:0;border:0;background:none;color:var(--muted);padding:0}.note:hover .reply{opacity:1}
.note.focus{box-shadow:inset 3px 0 0 var(--accent)}
.files-tab{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:56px;margin-top:32px}
details{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:8px 0;overflow:hidden}details>summary{padding:8px 14px;cursor:pointer;font-size:14px;list-style-position:inside}details>diffs-container{border-top:1px solid var(--line)}
#fb{position:fixed;right:20px;bottom:72px;width:min(420px,calc(100vw - 32px));background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;box-shadow:0 12px 32px rgba(0,0,0,.14);z-index:9}
.fb-head{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-bottom:8px}#fb textarea{width:100%;font:inherit;font-size:14px;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:9px;padding:9px}
.fb-row{display:flex;justify-content:space-between;align-items:center;margin-top:8px}
#fb-bar{position:fixed;right:20px;bottom:20px;display:flex;gap:10px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:7px 12px;font-size:13px;z-index:9;box-shadow:0 6px 20px rgba(0,0,0,.08)}
footer{margin-top:40px}[hidden]{display:none!important}
@media (max-width:960px){.intro,.ch,.files-tab{grid-template-columns:minmax(0,1fr);gap:24px}.ch-text{position:static;max-height:none}.ch{margin-bottom:72px}}
`;

// Put the shared block back into each shadow root: CSS as one adopted sheet, the sprite cloned.
const ADOPT = `(()=>{const src=document.getElementById('pierre-shared').content,parts=[...src.querySelectorAll('template')].map(t=>t.content),sheets={};
const tok=new CSSStyleSheet();tok.replaceSync(document.getElementById('pierre-tokens').textContent);
document.querySelectorAll('diffs-container').forEach(h=>{const root=h.shadowRoot;if(!root)return;root.adoptedStyleSheets=[...root.adoptedStyleSheets,tok];root.querySelectorAll('template[data-shared]').forEach(ph=>{const i=ph.dataset.shared,el=parts[i].firstElementChild;
if(el.tagName==='STYLE'){if(!sheets[i]){sheets[i]=new CSSStyleSheet();sheets[i].replaceSync(el.textContent)}root.adoptedStyleSheets=[...root.adoptedStyleSheets,sheets[i]];ph.remove()}else ph.replaceWith(el.cloneNode(true))})})})();`;

// Client: tabs, reviewed state (chapters and files; reviewed files collapse),
// j/k between notes, comments on lines/notes/chapters. State lives in
// localStorage; under \`prtour open\` comments also POST to feedback.json.
const CLIENT = `
(()=>{const id=document.querySelector('meta[name=prtour-id]').content,K='prtour:'+id,live=!!document.querySelector('meta[name=prtour-live]');
let S;try{S=JSON.parse(localStorage.getItem(K))||{}}catch{S={}}S.reviewed??={};S.files??={};S.comments??=[];
const save=()=>{try{localStorage.setItem(K,JSON.stringify(S))}catch{}};
const $=(q,el=document)=>el.querySelector(q),$$=(q,el=document)=>[...el.querySelectorAll(q)];
function tab(name,hash){$$('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==name);$$('.tabs [data-tab]').forEach(a=>a.classList.toggle('on',a.dataset.tab===name));if(hash)history.replaceState(null,'','#'+hash)}
document.addEventListener('click',e=>{const a=e.target.closest('[data-tab]');if(a){e.preventDefault();tab(a.dataset.tab,a.dataset.tab);scrollTo(0,0);return}
const l=e.target.closest('a[href^="#"]');if(l){const el=document.getElementById(l.getAttribute('href').slice(1));if(el){const p=el.closest('[data-panel]');if(p&&p.hidden)tab(p.dataset.panel)}}});
if(location.hash==='#files')tab('files');else{const el=location.hash&&document.getElementById(location.hash.slice(1));if(el&&el.closest('[data-panel=files]'))tab('files')}
const host=p=>$$('diffs-container').filter(h=>h.dataset.file===p);
function paint(){$$('[data-reviewed]').forEach(b=>{b.checked=!!S.reviewed[b.dataset.reviewed];b.closest('.ch')?.classList.toggle('done',b.checked)});
$$('[data-file-reviewed]').forEach(b=>{const on=!!S.files[b.dataset.fileReviewed];b.checked=on;const h=b.closest('diffs-container');h&&h.toggleAttribute('data-collapsed',on)});
const ch=$$('[data-reviewed]');$('#progress').textContent=ch.length?ch.filter(b=>b.checked).length+' of '+ch.length+' chapters reviewed':''}
document.addEventListener('change',e=>{const r=e.target.dataset.reviewed,f=e.target.dataset.fileReviewed;
if(r){S.reviewed[r]=e.target.checked;$$('[data-file-reviewed]',e.target.closest('.ch')).forEach(b=>S.files[b.dataset.fileReviewed]=e.target.checked)}
if(f){S.files[f]=e.target.checked}if(r||f){save();paint()}});paint();
const notes=$$('[data-panel=guide] .note');let cur=-1;
document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA/.test(document.activeElement.tagName)||e.metaKey||e.ctrlKey||e.altKey)return;if(e.key!=='j'&&e.key!=='k'||!notes.length)return;cur=Math.max(0,Math.min(notes.length-1,cur+(e.key==='j'?1:-1)));notes.forEach(n=>n.classList.remove('focus'));const n=notes[cur];n.classList.add('focus');n.closest('diffs-container')?.removeAttribute('data-collapsed');n.scrollIntoView({block:'center',behavior:'smooth'})});
let target=null;const fb=$('#fb'),txt=$('#fb-text');
function open(t,title){target=t;$('#fb-title').textContent=title;txt.value='';fb.hidden=false;txt.focus()}
$('#fb-x').onclick=()=>fb.hidden=true;
document.addEventListener('click',e=>{const r=e.target.closest('[data-reply]');if(r)open({note:+r.dataset.reply},'Reply to note '+r.dataset.reply);
const c=e.target.closest('[data-reply-chapter]');if(c)open({chapter:+c.dataset.replyChapter},'Comment on chapter '+c.dataset.replyChapter)});
$$('diffs-container').forEach(h=>h.shadowRoot&&h.shadowRoot.addEventListener('click',e=>{const path=e.composedPath();
if(path.find(x=>x.dataset&&'diffsHeader' in x.dataset)&&!path.find(x=>x.tagName==='SLOT'&&x.name==='header-metadata')){h.toggleAttribute('data-collapsed');return}
const el=path.find(x=>x.dataset&&x.dataset.columnNumber&&x.closest&&x.closest('[data-gutter]'));if(!el)return;const side=/deletion/.test(el.dataset.lineType)?'old':'new';open({file:h.dataset.file,line:+el.dataset.columnNumber,side},h.dataset.file+':'+el.dataset.columnNumber+(side==='old'?' (old)':''))}));
function bar(){$('#fb-bar').hidden=!S.comments.length;$('#fb-count').textContent=S.comments.length+' comment'+(S.comments.length>1?'s':'')+(live?', sent to the agent':'')}
$('#fb-save').onclick=()=>{const body=txt.value.trim();if(!body)return;const c={...target,body,at:new Date().toISOString()};S.comments.push(c);save();bar();fb.hidden=true;if(live)fetch('/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(c)})};
txt.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))$('#fb-save').click();if(e.key==='Escape')fb.hidden=true});
const asMd=()=>S.comments.map(c=>'- '+(c.file?'\\\`'+c.file+':'+c.line+'\\\`'+(c.side==='old'?' (old side)':''):c.note?'note '+c.note:'chapter '+c.chapter)+': '+c.body.replace(/\\n/g,'\\n  ')).join('\\n');
$('#fb-copy').onclick=()=>navigator.clipboard.writeText('Review feedback ('+id+'):\\n'+asMd()).then(()=>$('#fb-copy').textContent='Copied');
$('#fb-clear').onclick=()=>{if(confirm('Clear all comments?')){S.comments=[];save();bar();if(live)fetch('/feedback',{method:'DELETE'})}};bar();
if(live){const es=new EventSource('/events');es.onmessage=()=>location.reload()}
})();`;
