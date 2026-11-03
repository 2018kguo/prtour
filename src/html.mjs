// Resolved tour -> one self-contained HTML file. Diffs are pre-rendered by
// @pierre/diffs into declarative shadow DOM, so the page needs no bundle and
// works from file://, an artifact host, or `prtour open`.
import { preloadPatchDiff } from '@pierre/diffs/ssr';
import { filePatch } from './patch.mjs';
import fs from 'node:fs';
import { diagramSVG } from './diagram.mjs';

import { CSS, FONTS, THEME, counts, esc, n2, ui } from './ui.mjs';
export { esc };

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

const noteHTML = (n) => `<div class="callout note" id="note-${n.n}" data-note="${n.n}"><span class="num" title="${esc(n.label)}">${n.n}</span><div class="callout-body">${n.title ? `<b>${esc(n.title)}</b> ` : ''}${md(n.body).replace(/^<p>|<\/p>$/g, '')}</div>${ui.btn('Reply', `data-reply="${n.n}"`)}</div>`;

async function diffHTML(file, hunks, notes, o, reviewable = false) {
  o = { ...o, reviewable };
  if (file.binary || !file.hunks.length) {
    return `<div class="nodiff"><b>${esc(file.path)}</b> <span class="t-muted">${file.binary ? 'binary file' : file.status}${file.oldPath && file.oldPath !== file.path ? ` from ${esc(file.oldPath)}` : ''}</span></div>`;
  }
  const anchored = notes.filter((n) => n.anchored);
  const annotations = [...new Map(anchored.map((n) => [`${n.side}-${n.line}`, { side: n.side, lineNumber: n.line }])).values()];
  const { prerenderedHTML } = await preloadPatchDiff({ patch: filePatch(file, hunks), options: OPTS(o), annotations });
  const html = o.shared ? tokenClasses(dedupe(prerenderedHTML, o.shared), o.tokens) : prerenderedHTML;
  const slots = annotations.map((a) => `<div slot="annotation-${a.side}-${a.lineNumber}">${anchored.filter((n) => n.side === a.side && n.line === a.lineNumber).map(noteHTML).join('')}</div>`).join('');
  const tag = file.part ? `<span slot="header-prefix" style="margin-right:6px">${ui.badge(`#${esc(file.part)}`, 'outline')}</span>` : '';
  const rev = o.reviewable ? `<label slot="header-metadata" class="label t-small file-rev"><input type="checkbox" class="input" data-file-reviewed="${esc(file.path)}">Reviewed</label>` : '';
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
  return `<figure class="figure panel">${el}${im.caption ? `<figcaption>${esc(im.caption)}</figcaption>` : ''}</figure>`;
}

function mapHTML(d) {
  if (!d?.nodes?.length) return '';
  const added = d.nodes.filter((x) => x.change === 'new').length;
  return ui.card({ title: esc(d.title ?? 'Before / after'), description: d.caption ? esc(d.caption) : '', action: added ? `<span class="badge" data-variant="outline" style="color:var(--add)">+${added} new</span>` : '', body: diagramSVG(d) });
}

const visualsHTML = (v) => [mapHTML(v.diagram), v.mermaid ? ui.card({ body: `<pre class="mermaid">${esc(v.mermaid)}</pre>` }) : '', ...(v.images ?? []).map(mediaHTML)].filter(Boolean).join('');

const fileId = (p) => `f-${p.replace(/[^a-zA-Z0-9]+/g, '-')}`;
const hunkCounts = (f, hs) => hs.reduce(([a, d], i) => [a + f.hunks[i].additions, d + f.hunks[i].deletions], [0, 0]);
const entryCounts = (e) => hunkCounts(e.file, e.file.hunks.map((_, i) => i).filter((i) => !e.hunks || e.hunks.includes(i)));
const unp = (h) => h.replace(/^<p>|<\/p>$/g, '');

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
      const rest = e.hunks ? `${e.file.hunks.length - e.hunks.length} more hunk${e.file.hunks.length - e.hunks.length > 1 ? 's' : ''} of this file are not in review` : e.cut ? 'Only these lines are in review' : '';
      cards.push(ui.panel(`${loose}${await diffHTML(e.file, e.hunks, ns, o, true)}${rest ? `<div class="rest t-small t-muted"><a href="#files" data-tab="files">${rest} →</a></div>` : ''}`, ` id="${eid(ci, e)}"`));
    }
    chapters.push(`<section class="rail chapter" id="ch-${ci + 1}" data-chapter="${ci + 1}">
<div class="rail-side stack"><div class="stack" style="gap:6px"><span class="t-label">Chapter ${n2(ci + 1)} of ${n2(N)}</span><h2 class="t-title">${esc(c.title)}</h2></div>
<div>${md(c.body)}</div>
<div class="row" style="gap:16px">${ui.check(`data-reviewed="${ci + 1}"`)}${ui.btn('Comment', `data-reply-chapter="${ci + 1}"`)}</div>
<ul class="flist">${c.entries.map((e) => ui.fileRow(r.label(e.file.path), `#${eid(ci, e)}`, ...entryCounts(e), e.hunks || e.cut ? ` ${ui.badge('part', 'outline')}` : '')).join('')}</ul></div>
<div class="rail-main">${visualsHTML(c.visual)}${cards.join('')}</div></section>`);
  }

  const inGuide = r.chapters.flatMap((c, ci) => c.entries.map((e) => ui.fileRow(r.label(e.file.path), `#${eid(ci, e)}`, ...entryCounts(e), ` ${ui.badge(n2(ci + 1), 'outline')}`)));
  const hidden = [];
  for (const h of r.hidden) {
    const items = [];
    for (const f of h.files) items.push(`<details class="disclosure"><summary>${ui.fileInline(r.label(f.path), f.additions, f.deletions)}</summary>${await diffHTML(f, null, [], o)}</details>`);
    hidden.push(`<div class="stack" style="gap:8px"><div class="row"><span class="t-label">${esc(h.reason)}</span>${ui.badge(h.files.length)}</div>${items.join('')}</div>`);
  }
  if (r.partial.length) {
    const items = [];
    for (const p of r.partial) items.push(`<details class="disclosure"><summary>${ui.fileInline(r.label(p.file.path), ...hunkCounts(p.file, p.hunks))}</summary>${await diffHTML(p.file, p.hunks, [], o)}</details>`);
    hidden.push(`<div class="stack" style="gap:8px"><div class="row"><span class="t-label">The rest of files shown in part</span>${ui.badge(r.partial.length)}</div>${items.join('')}</div>`);
  }
  const hiddenCount = r.hidden.reduce((n, h) => n + h.files.length, 0);
  const pct = s.total ? Math.max(1, Math.round((s.shown / s.total) * 100)) : 100;

  const top = visualsHTML({ diagram: t.diagram, mermaid: t.mermaid, images: t.images });
  const anyMermaid = t.mermaid || r.chapters.some((c) => c.visual.mermaid);
  const meta = [t.number && (t.url ? `<a href="${esc(t.url)}">#${t.number}</a>` : `#${t.number}`), t.author && esc(t.author), (t.base || t.head) && `<span class="t-mono">${esc(t.head ?? '')}</span>`].filter(Boolean).join('<span class="sep">·</span>');
  const id = `${t.repo ?? ''}#${t.number ?? t.head ?? t.title ?? ''}`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.title || 'Guided review')}</title><meta name="prtour-id" content="${esc(id)}">${o.live ? '<meta name="prtour-live" content="1">' : ''}${o.print ? '<meta name="prtour-print" content="1">' : ''}
${FONTS}<style>${CSS}${PAGE_CSS}</style>${THEME}</head><body>
${ui.tabs([['guide', 'Guide', true], ['files', `Files <span class="t-muted">${s.files}</span>`]], `<span class="row t-small t-muted no-print"><span id="progress-text"></span><span class="meter"><i id="progress-bar" style="width:0"></i></span></span>`)}
<main class="page">
<div data-panel="guide">
<header class="hero stack"><h1 class="t-display">${esc(t.title || 'Guided review')}</h1><div class="row t-small t-muted">${meta}</div></header>
<section class="${top ? 'split' : 'solo'} intro"><div class="stack">
<div class="lede">${md(t.summary) || '<p class="t-muted">No summary yet.</p>'}</div>
${t.steps?.length ? `<ol class="steps">${t.steps.map((x) => `<li>${unp(md(x))}</li>`).join('')}</ol>` : ''}
${r.parts.length ? `<div class="stack" style="gap:6px"><span class="t-label">Stack</span><ul class="flist">${r.parts.map((p) => `<li><a href="${esc(p.url ?? '#')}">${ui.badge(`#${esc(p.key)}`, 'outline')} <span class="f-name">${esc(p.title ?? '')}</span></a><span class="f-count">${counts(p.additions, p.deletions)}</span></li>`).join('')}</ul></div>` : ''}
<div class="row stats">${ui.stat(s.shown.toLocaleString(), `lines to review, of ${s.total.toLocaleString()}`)}${ui.stat(`${pct}%`, 'of the diff')}${ui.stat(N, N === 1 ? 'chapter' : 'chapters')}${hiddenCount ? ui.stat(hiddenCount, `files left out · <a href="#files" data-tab="files" class="t-muted" style="text-decoration:underline">see all</a>`) : ''}</div>
${t.skipped ? `<p class="t-small t-muted">${unp(md(t.skipped))}</p>` : ''}${t.allowLarge ? `<p class="t-small t-muted">Longer than usual: ${esc(t.allowLarge)}</p>` : ''}
</div>${top ? `<div class="stack">${top}</div>` : ''}</section>
${chapters.join('\n')}
<footer class="t-small t-muted no-print">Made with <a href="https://github.com/2018kguo/prtour">prtour</a> · diffs by <a href="https://diffs.com">@pierre/diffs</a></footer>
</div>
<div data-panel="files" hidden>
<header class="hero stack"><h1 class="t-display">All files</h1><div class="row t-small t-muted">${s.files} files<span class="sep">·</span>${counts(s.additions, s.deletions)}</div></header>
<section class="split"><div class="stack"><span class="t-label">In the guide</span><ul class="flist">${inGuide.join('')}</ul></div><div class="stack">${hidden.length ? `<p class="t-small t-muted">Left out of the guide, still part of the PR. Open any file to read it.</p>${hidden.join('')}` : ''}</div></section>
</div>
</main>
<aside id="fb" class="card floating no-print" style="bottom:76px;width:min(420px,calc(100vw - 32px));box-shadow:0 12px 32px rgb(0 0 0/.16)" hidden><header><h2 id="fb-title"></h2><div class="card-action">${ui.btn('Close', 'id="fb-x"')}</div></header><section><textarea id="fb-text" class="textarea" rows="4" placeholder="Comment for the author or agent"></textarea></section><footer class="row" style="justify-content:space-between"><span class="t-small t-muted"><kbd class="kbd">⌘</kbd> <kbd class="kbd">↵</kbd> to save</span>${ui.btn('Save', 'id="fb-save"', 'primary')}</footer></aside>
<div id="fb-bar" class="panel floating row no-print" style="bottom:20px;padding:8px 12px;box-shadow:0 6px 20px rgb(0 0 0/.08)" hidden><span id="fb-count" class="t-small"></span>${ui.btn('Copy feedback', 'id="fb-copy"', 'outline')}${ui.btn('Clear', 'id="fb-clear"')}</div>
<template id="pierre-shared">${o.shared.map((x, i) => `<template data-i="${i}">${x}</template>`).join('')}</template>
<style id="pierre-tokens" media="not all">${[...o.tokens].map(([css, k]) => `.${k}{${css}}`).join('')}:host([data-collapsed]) pre{display:none}[data-diffs-header]{cursor:pointer}</style>
<script>${ADOPT}</script><script>${CLIENT}</script>${anyMermaid ? MERMAID : ''}</body></html>`;
}

// Mermaid needs its library: fetched only when a tour uses it. Offline, the source stays readable.
const MERMAID = `<script type="module">try{const{default:m}=await import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs');m.initialize({startOnLoad:false,theme:matchMedia('(prefers-color-scheme: dark)').matches&&!document.querySelector('meta[name=prtour-print]')?'dark':'neutral',fontFamily:'Inter, -apple-system, sans-serif'});await m.run({querySelector:'pre.mermaid'})}catch(e){}window.__prtourReady=true</script>`;

// Only what the guide page adds on top of ui.mjs.
const PAGE_CSS = `
html{scroll-padding-top:76px}
.lede{font-size:16.5px;line-height:1.65}
.callout{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;background:var(--muted);font:14px/1.55 var(--font-sans);color:var(--foreground);white-space:normal}.callout p{margin:0}.callout-body{flex:1}
.num{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:999px;background:var(--primary);color:var(--primary-foreground);font:600 11.5px/1 var(--font-sans)}
.hero{gap:10px;padding:48px 0 24px}
.intro{margin:12px 0 112px}.solo{max-width:720px}
.steps{padding-left:20px;margin:0}.steps li{margin:4px 0}
.stats{gap:32px;padding:16px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.chapter{margin-bottom:112px}
.chapter:has([data-reviewed]:checked) .t-title{color:var(--muted-foreground)}
.rest{padding:8px 16px;border-top:1px solid var(--border)}.rest a:hover{color:var(--primary)}
.nodiff{padding:12px 16px;font:12.5px var(--font-mono)}
diffs-container{display:block}
.file-rev{margin-left:12px;gap:6px;cursor:pointer;font-weight:400}
.note{border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.card>.note:first-child{border-top:0}
.note .btn{opacity:0}.note:hover .btn{opacity:1}.note.focus{box-shadow:inset 3px 0 0 var(--primary)}
main>div>footer{margin-top:48px}
@media print{.chapter{break-before:page;margin:0}.rail{grid-template-columns:1fr}.intro{margin-bottom:0}[data-panel=files]{display:block!important;break-before:page}[data-panel=files] details>diffs-container{display:none}}
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
function tab(name,hash){$$('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==name);$$('[role=tab][data-tab]').forEach(a=>a.setAttribute('aria-selected',a.dataset.tab===name));if(hash)history.replaceState(null,'','#'+hash)}
document.addEventListener('click',e=>{const a=e.target.closest('[data-tab]');if(a){e.preventDefault();tab(a.dataset.tab,a.dataset.tab);scrollTo(0,0);return}
const l=e.target.closest('a[href^="#"]');if(l){const el=document.getElementById(l.getAttribute('href').slice(1));if(el){const p=el.closest('[data-panel]');if(p&&p.hidden)tab(p.dataset.panel)}}});
if(location.hash==='#files')tab('files');else{const el=location.hash&&document.getElementById(location.hash.slice(1));if(el&&el.closest('[data-panel=files]'))tab('files')}
const host=p=>$$('diffs-container').filter(h=>h.dataset.file===p);
function paint(){$$('[data-reviewed]').forEach(b=>{b.checked=!!S.reviewed[b.dataset.reviewed];0});
$$('[data-file-reviewed]').forEach(b=>{const on=!!S.files[b.dataset.fileReviewed];b.checked=on;const h=b.closest('diffs-container');h&&h.toggleAttribute('data-collapsed',on)});
const ch=$$('[data-reviewed]'),k=ch.filter(b=>b.checked).length;$('#progress-text').textContent=ch.length?k+' of '+ch.length+' reviewed':'';$('#progress-bar').style.width=(ch.length?100*k/ch.length:0)+'%'}
document.addEventListener('change',e=>{const r=e.target.dataset.reviewed,f=e.target.dataset.fileReviewed;
if(r){S.reviewed[r]=e.target.checked;$$('[data-file-reviewed]',e.target.closest('.chapter')).forEach(b=>S.files[b.dataset.fileReviewed]=e.target.checked)}
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
