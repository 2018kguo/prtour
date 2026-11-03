// Resolved tour -> one self-contained HTML file. Diffs are pre-rendered by
// @pierre/diffs into declarative shadow DOM, so the page needs no bundle and
// works from file://, an artifact host, or `prtour open`.
import { preloadPatchDiff } from '@pierre/diffs/ssr';
import { filePatch } from './patch.mjs';

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

const noteHTML = (n) => `<div class="note" id="note-${n.n}" data-note="${n.n}"><div class="note-head"><span class="badge">${n.label}</span><b>${esc(n.title)}</b><span class="where">${esc(n.where)}</span><button class="reply" data-reply="${n.n}">Reply</button></div>${md(n.body)}</div>`;

async function diffHTML(file, hunks, notes, o) {
  if (file.binary || !file.hunks.length) {
    return `<div class="nodiff"><b>${esc(file.path)}</b> <span class="muted">${file.binary ? 'binary file' : file.status}${file.oldPath && file.oldPath !== file.path ? ` from ${esc(file.oldPath)}` : ''}</span></div>`;
  }
  const anchored = notes.filter((n) => n.anchored);
  const annotations = [...new Map(anchored.map((n) => [`${n.side}-${n.line}`, { side: n.side, lineNumber: n.line }])).values()];
  const { prerenderedHTML } = await preloadPatchDiff({ patch: filePatch(file, hunks), options: OPTS(o), annotations });
  const html = o.shared ? tokenClasses(dedupe(prerenderedHTML, o.shared), o.tokens) : prerenderedHTML;
  const slots = annotations.map((a) => `<div slot="annotation-${a.side}-${a.lineNumber}">${anchored.filter((n) => n.side === a.side && n.line === a.lineNumber).map(noteHTML).join('')}</div>`).join('');
  const tag = file.part ? `<span slot="header-prefix" class="part">#${esc(file.part)}</span>` : '';
  return `<diffs-container data-file="${esc(file.path)}"><template shadowrootmode="open">${html}</template>${tag}${slots}</diffs-container>`;
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

const fileId = (p) => `f-${p.replace(/[^a-zA-Z0-9]+/g, '-')}`;
const counts = (a, d) => `<span class="add">+${a}</span> <span class="del">−${d}</span>`;
const hunkCounts = (f, hs) => hs.reduce(([a, d], i) => [a + f.hunks[i].additions, d + f.hunks[i].deletions], [0, 0]);

export async function renderHTML(r, opts = {}) {
  const o = { ...opts, shared: [], tokens: new Map() };
  const t = r.tour;
  const s = r.stats;
  const pct = s.total ? Math.round((s.shown / s.total) * 100) : 100;
  const notesFor = (e) => r.notes.filter((n) => n.entry === e);
  const eid = (ci, e) => `${fileId(e.file.path)}-${ci + 1}`;

  const chapters = [];
  for (const [ci, c] of r.chapters.entries()) {
    const files = [];
    for (const e of c.entries) {
      const ns = notesFor(e);
      const loose = ns.filter((n) => !n.anchored).map(noteHTML).join('');
      const hiddenHunks = e.hunks ? e.file.hunks.length - e.hunks.length : 0;
      files.push(`<section class="file" id="${eid(ci, e)}">${loose}${await diffHTML(e.file, e.hunks, ns, o)}${hiddenHunks ? `<a class="muted small" href="#hidden">${hiddenHunks} more hunk(s) of this file are hidden</a>` : ''}</section>`);
    }
    chapters.push(`<section class="chapter" id="ch-${ci + 1}" data-chapter="${ci + 1}">
<header class="ch-head"><div class="ch-num">${String(ci + 1).padStart(2, '0')} / ${String(r.chapters.length).padStart(2, '0')} <label class="rev"><input type="checkbox" data-reviewed="${ci + 1}"> Reviewed</label> <button class="reply" data-reply-chapter="${ci + 1}">Comment</button></div>
<h2>${esc(c.title)}</h2>${md(c.body)}
<ul class="files">${c.entries.map((e) => `<li><a href="#${eid(ci, e)}">${esc(r.label(e.file.path))}</a> ${counts(...hunkCounts(e.file, e.hunks ?? e.file.hunks.map((_, i) => i)))}${e.hunks ? ' <span class="muted">(partial)</span>' : ''}</li>`).join('')}</ul></header>${files.join('')}</section>`);
  }

  const hidden = [];
  for (const h of r.hidden) {
    const items = [];
    for (const f of h.files) items.push(`<details><summary>${esc(r.label(f.path))} ${counts(f.additions, f.deletions)}</summary>${await diffHTML(f, null, [], o)}</details>`);
    hidden.push(`<h3>${esc(h.reason)} <span class="muted">· ${h.files.length} file(s)</span></h3>${items.join('')}`);
  }
  if (r.partial.length) {
    const items = [];
    for (const p of r.partial) items.push(`<details><summary>${esc(r.label(p.file.path))} · ${p.hunks.length} hunk(s) ${counts(...hunkCounts(p.file, p.hunks))}</summary>${await diffHTML(p.file, p.hunks, [], o)}</details>`);
    hidden.push(`<h3>Hidden hunks of shown files</h3>${items.join('')}`);
  }

  const meta = [t.number && (t.url ? `<a href="${esc(t.url)}">#${t.number}</a>` : `#${t.number}`), t.author && esc(t.author), (t.base || t.head) && `<code>${esc(t.base ?? '')}</code> ← <code>${esc(t.head ?? '')}</code>`, counts(s.additions, s.deletions)].filter(Boolean).join(' · ');
  const id = `${t.repo ?? ''}#${t.number ?? t.head ?? t.title ?? ''}`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.title || 'Guided review')} · prtour</title><meta name="prtour-id" content="${esc(id)}">${o.live ? '<meta name="prtour-live" content="1">' : ''}
<style>${CSS}</style></head><body>
<nav class="side"><a class="brand" href="#top">prtour</a>
<a href="#overview">Overview</a>
<div class="side-h">Guide <span class="muted" id="progress"></span></div>
${r.chapters.map((c, i) => `<a href="#ch-${i + 1}" data-nav="${i + 1}"><span class="muted">${String(i + 1).padStart(2, '0')}</span> ${esc(c.title)}</a>`).join('')}
${r.notes.length ? `<div class="side-h">Notes <span class="muted">j / k</span></div>${r.notes.map((n) => `<a href="#note-${n.n}"><span class="muted">${n.label}</span> ${esc(n.title || n.file.split('/').pop())}</a>`).join('')}` : ''}
${hidden.length ? '<div class="side-h">Not in review</div><a href="#hidden">Hidden files</a>' : ''}
</nav>
<main id="top">
<header class="top"><h1>${esc(t.title || 'Guided review')}</h1><div class="meta">${meta}</div>
<div class="stat"><div class="bar"><i style="width:${pct}%"></i></div>Review <b>${s.shown.toLocaleString()}</b> of ${s.total.toLocaleString()} changed lines (${pct}%) · ${r.chapters.reduce((n, c) => n + c.entries.length, 0)} of ${s.files} files · ${r.notes.length} notes</div>
${r.warnings.length && !o.quiet ? `<details class="warn"><summary>${r.warnings.length} tour warning(s)</summary><ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}</header>
<section id="overview" class="overview"><h2>Overview</h2>${md(t.summary) || '<p class="muted">No summary yet.</p>'}
${r.parts.length ? `<h3>Stack</h3><ol class="stack">${r.parts.map((p) => `<li><span class="part">#${esc(p.key)}</span> ${p.url ? `<a href="${esc(p.url)}">${esc(p.title ?? '')}</a>` : esc(p.title ?? '')} <span class="muted">${[p.state && p.state.toLowerCase(), (p.base || p.head) && `${esc(p.base ?? '')} ← ${esc(p.head ?? '')}`, `${p.files} files`].filter(Boolean).join(' · ')}</span> ${counts(p.additions, p.deletions)}</li>`).join('')}</ol>` : ''}
${t.steps?.length ? `<ol class="steps">${t.steps.map((x) => `<li>${md(x).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ol>` : ''}
${r.notes.length ? `<h3>Reading order</h3><ol class="order">${r.notes.map((n) => `<li><a href="#note-${n.n}">${esc(n.title || n.body.slice(0, 80))}</a> <span class="muted">${esc(n.where)}</span></li>`).join('')}</ol>` : ''}
${t.skipped ? `<h3>Left out of review</h3>${md(t.skipped)}` : ''}${t.allowLarge ? `<p class="muted small">Over the review budget: ${esc(t.allowLarge)}</p>` : ''}</section>
${chapters.join('\n')}
${hidden.length ? `<section id="hidden" class="hidden"><h2>Not in review</h2><p class="muted">These are still in the PR. Open any file to read it anyway.</p>${hidden.join('')}</section>` : ''}
<footer class="muted small">Made with <a href="https://github.com/2018kguo/prtour">prtour</a> · diffs by <a href="https://diffs.com">@pierre/diffs</a></footer>
</main>
<aside id="fb" hidden><div class="fb-head"><b id="fb-title"></b><button id="fb-x" aria-label="Close">×</button></div><textarea id="fb-text" rows="4" placeholder="Comment for the author / agent…"></textarea><div class="fb-row"><button id="fb-save">Save comment</button></div></aside>
<div id="fb-bar" hidden><span id="fb-count"></span><button id="fb-copy">Copy feedback</button><button id="fb-clear">Clear</button></div>
<template id="pierre-shared">${o.shared.map((x, i) => `<template data-i="${i}">${x}</template>`).join('')}</template>
<style id="pierre-tokens" media="not all">${[...o.tokens].map(([css, k]) => `.${k}{${css}}`).join('')}</style>
<script>${ADOPT}</script><script>${CLIENT}</script></body></html>`;
}

const CSS = `
:root{--bg:#fbfbfa;--fg:#1d1d1f;--muted:#86868b;--line:#e8e8e6;--card:#fff;--accent:#0a66ff;--add:#1a7f37;--del:#cf222e;--note:#fff8e6;--note-line:#f0c36d;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0f0f10;--fg:#ececec;--muted:#8b8b90;--line:#2a2a2d;--card:#161618;--accent:#5b9dff;--add:#3fb950;--del:#f85149;--note:#2a2414;--note-line:#9a7a2c}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:16px}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;display:grid;grid-template-columns:260px minmax(0,1fr)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:color-mix(in srgb,var(--fg) 7%,transparent);padding:1px 5px;border-radius:5px}
.side{position:sticky;top:0;height:100vh;overflow:auto;padding:20px 14px;border-right:1px solid var(--line);font-size:13px;display:flex;flex-direction:column;gap:2px}
.side a{color:var(--fg);padding:4px 8px;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.side a:hover{background:color-mix(in srgb,var(--fg) 6%,transparent);text-decoration:none}
.side a.done{color:var(--muted);text-decoration:line-through}.side .brand{font-weight:700;margin-bottom:8px}
.side-h{margin:14px 8px 4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
main{padding:28px clamp(16px,4vw,48px) 120px;max-width:1280px;width:100%}
h1{font-size:26px;line-height:1.2;margin:0 0 6px;letter-spacing:-.01em}h2{font-size:20px;margin:6px 0}h3{font-size:15px;margin:22px 0 8px}
.meta,.muted{color:var(--muted)}.small{font-size:13px}.meta{font-size:14px}
.add{color:var(--add)}.del{color:var(--del)}
.stat{margin-top:14px;font-size:14px}.bar{height:6px;border-radius:3px;background:var(--line);margin-bottom:6px;max-width:420px;overflow:hidden}.bar i{display:block;height:100%;background:var(--add)}
.warn{margin-top:12px;font-size:13px;border:1px solid var(--note-line);background:var(--note);border-radius:8px;padding:6px 12px}
.overview,.chapter,.hidden{margin-top:36px;padding-top:24px;border-top:1px solid var(--line)}
.overview{max-width:760px}.steps li,.order li{margin:4px 0}
.ch-head{max-width:760px;margin-bottom:14px}.ch-num{font-size:13px;color:var(--muted);display:flex;gap:14px;align-items:center}
.files{list-style:none;padding:0;margin:10px 0;font:13px ui-monospace,Menlo,monospace}.files li{padding:2px 0}
.file{margin:14px 0 22px}
diffs-container{display:block;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.nodiff{border:1px solid var(--line);border-radius:10px;padding:10px 14px;font:13px ui-monospace,Menlo,monospace;background:var(--card)}
.note{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Inter",sans-serif;background:var(--note);border:1px solid var(--note-line);border-radius:8px;padding:8px 12px;margin:8px 10px;color:var(--fg);white-space:normal}
.file>.note{margin:0 0 8px}.note p{margin:4px 0}.note.focus{outline:2px solid var(--accent)}
.note-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.note .where{font:12px ui-monospace,Menlo,monospace;color:var(--muted)}
.part{font:600 11px ui-monospace,Menlo,monospace;color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);border-radius:5px;padding:0 5px;margin-right:6px}
.stack{padding-left:20px}.stack li{margin:4px 0}
.badge{font:600 12px ui-monospace,Menlo,monospace;background:var(--fg);color:var(--bg);border-radius:5px;padding:1px 6px}
button{font:inherit;font-size:12px;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:2px 8px;cursor:pointer}
.note .reply{margin-left:auto}
details{border:1px solid var(--line);border-radius:8px;margin:6px 0;background:var(--card)}details>summary{padding:6px 12px;cursor:pointer;font:13px ui-monospace,Menlo,monospace}details>diffs-container{border:0;border-top:1px solid var(--line);border-radius:0}
#fb{position:fixed;right:16px;bottom:64px;width:min(420px,calc(100vw - 32px));background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.18);z-index:9}
.fb-head{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-bottom:8px}#fb textarea{width:100%;font:inherit;font-size:14px;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:8px}
.fb-row{display:flex;justify-content:flex-end;margin-top:8px}
#fb-bar{position:fixed;right:16px;bottom:16px;display:flex;gap:8px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:6px 10px;font-size:13px;z-index:9}
footer{margin-top:60px}[hidden]{display:none!important}
@media (max-width:900px){body{display:block}.side{display:none}}
`;

// Put the shared block back into each shadow root: CSS as one adopted sheet, the sprite cloned.
const ADOPT = `(()=>{const src=document.getElementById('pierre-shared').content,parts=[...src.querySelectorAll('template')].map(t=>t.content),sheets={};
const tok=new CSSStyleSheet();tok.replaceSync(document.getElementById('pierre-tokens').textContent);
document.querySelectorAll('diffs-container').forEach(h=>{const root=h.shadowRoot;if(!root)return;root.adoptedStyleSheets=[...root.adoptedStyleSheets,tok];root.querySelectorAll('template[data-shared]').forEach(ph=>{const i=ph.dataset.shared,el=parts[i].firstElementChild;
if(el.tagName==='STYLE'){if(!sheets[i]){sheets[i]=new CSSStyleSheet();sheets[i].replaceSync(el.textContent)}root.adoptedStyleSheets=[...root.adoptedStyleSheets,sheets[i]];ph.remove()}else ph.replaceWith(el.cloneNode(true))})})})();`;

// Client: reviewed checkboxes, j/k note navigation, comments on lines/notes/
// chapters. Comments live in localStorage; under `prtour open` they also POST
// to the server, which writes feedback.json for the agent.
const CLIENT = `
(()=>{const id=document.querySelector('meta[name=prtour-id]').content,K='prtour:'+id,live=!!document.querySelector('meta[name=prtour-live]');
let S;try{S=JSON.parse(localStorage.getItem(K))||{}}catch{S={}}S.reviewed??={};S.comments??=[];
const save=()=>{try{localStorage.setItem(K,JSON.stringify(S))}catch{}};
const $=(q,el=document)=>el.querySelector(q),$$=(q,el=document)=>[...el.querySelectorAll(q)];
function progress(){const boxes=$$('[data-reviewed]');boxes.forEach(b=>{b.checked=!!S.reviewed[b.dataset.reviewed];const a=$('[data-nav="'+b.dataset.reviewed+'"]');a&&a.classList.toggle('done',b.checked)});$('#progress').textContent=boxes.filter(b=>b.checked).length+'/'+boxes.length}
document.addEventListener('change',e=>{const r=e.target.dataset.reviewed;if(r){S.reviewed[r]=e.target.checked;save();progress()}});progress();
const notes=$$('.note');let cur=-1;
document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA/.test(document.activeElement.tagName)||e.metaKey||e.ctrlKey)return;if(e.key!=='j'&&e.key!=='k')return;if(!notes.length)return;cur=Math.max(0,Math.min(notes.length-1,cur+(e.key==='j'?1:-1)));notes.forEach(n=>n.classList.remove('focus'));const n=notes[cur];n.classList.add('focus');n.closest('details')?.setAttribute('open','');n.scrollIntoView({block:'center',behavior:'smooth'})});
let target=null;const fb=$('#fb'),txt=$('#fb-text');
function open(t,title){target=t;$('#fb-title').textContent=title;txt.value='';fb.hidden=false;txt.focus()}
$('#fb-x').onclick=()=>fb.hidden=true;
document.addEventListener('click',e=>{const r=e.target.closest('[data-reply]');if(r){const n=$('#note-'+r.dataset.reply);open({note:+r.dataset.reply},'Reply to note '+n.querySelector('.badge').textContent)}
const c=e.target.closest('[data-reply-chapter]');if(c)open({chapter:+c.dataset.replyChapter},'Comment on chapter '+c.dataset.replyChapter)});
$$('diffs-container').forEach(host=>host.shadowRoot&&host.shadowRoot.addEventListener('click',e=>{const el=e.composedPath().find(x=>x.dataset&&x.dataset.columnNumber&&x.closest&&x.closest('[data-gutter]'));if(!el)return;const side=/deletion/.test(el.dataset.lineType)?'old':'new';open({file:host.dataset.file,line:+el.dataset.columnNumber,side},host.dataset.file+':'+el.dataset.columnNumber+(side==='old'?' (old)':''))}));
function bar(){$('#fb-bar').hidden=!S.comments.length;$('#fb-count').textContent=S.comments.length+' comment(s)'+(live?' · sent to agent':'')}
$('#fb-save').onclick=()=>{const body=txt.value.trim();if(!body)return;const c={...target,body,at:new Date().toISOString()};S.comments.push(c);save();bar();fb.hidden=true;if(live)fetch('/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(c)})};
txt.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))$('#fb-save').click();if(e.key==='Escape')fb.hidden=true});
const asMd=()=>S.comments.map(c=>'- '+(c.file?'\`'+c.file+':'+c.line+'\`'+(c.side==='old'?' (old side)':''):c.note?'note '+c.note:'chapter '+c.chapter)+': '+c.body.replace(/\\n/g,'\\n  ')).join('\\n');
$('#fb-copy').onclick=()=>navigator.clipboard.writeText('Review feedback ('+id+'):\\n'+asMd()).then(()=>$('#fb-copy').textContent='Copied');
$('#fb-clear').onclick=()=>{if(confirm('Clear all comments?')){S.comments=[];save();bar();if(live)fetch('/feedback',{method:'DELETE'})}};bar();
if(live){const es=new EventSource('/events');es.onmessage=()=>location.reload()}
})();`;
