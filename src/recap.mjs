// Recap: what shipped across many PRs and days, written as a workstream report
// for humans. Each workstream tells what was wrong, the design call, the aha,
// how it was proved, the trade, and why it matters, with its own visuals.
// recap.json is scaffolded from `gh` (+ agent-lane context), then an agent
// writes the workstreams. Pages are built from Basecoat components.
import fs from 'node:fs';
import { lint, stripCode } from './style.mjs';
import { TOGGLE_CSS, TOGGLE_JS, checkDiagram, diagramMermaid, diagramToggle, diagramTree } from './diagram.mjs';
import { CSS, THEME, counts, esc, ui } from './ui.mjs';
import { md } from './html.mjs';
import { kindOf } from './tour.mjs';
import { ICON_CSS, iconHTML } from './icons.mjs';

export const RECAP_BUDGET = { workstreams: 10 };
const PALETTE = ['oklch(55% .17 155)', 'oklch(58% .19 259)', 'oklch(70% .17 65)', 'oklch(56% .22 293)', 'oklch(60% .21 18)', 'oklch(62% .12 210)', 'oklch(55% .09 120)', 'oklch(52% .15 330)', 'oklch(64% .14 40)', 'oklch(50% .05 260)'];

// Area = the first two path segments of where most of a PR's lines went, ignoring tests and generated files.
export function areaOf(files) {
  const by = new Map();
  for (const f of files ?? []) {
    if (['test', 'generated', 'lockfile'].includes(kindOf(f.path))) continue;
    const a = f.path.split('/').slice(0, f.path.startsWith('apps/') || f.path.startsWith('packages/') ? 2 : 1).join('/');
    by.set(a, (by.get(a) ?? 0) + f.additions + f.deletions);
  }
  return [...by].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'other';
}

export function scaffoldRecap(prs, meta) {
  return {
    kind: 'recap', ...meta, eyebrow: 'For engineers', summary: '', metrics: [], dayNotes: {}, lanes: {},
    workstreams: [{ name: 'TODO(agent)', title: 'Group PRs by outcome', whoFeelsIt: '', headline: '', before: '', prs: prs.map((p) => p.number) }],
    prs: prs.map((p) => ({ number: p.number, title: p.title, url: p.url, author: p.author?.login, createdAt: p.createdAt, mergedAt: p.mergedAt,
      additions: p.additions, deletions: p.deletions, files: p.changedFiles, area: areaOf(p.files), oneLiner: '', description: (p.body ?? '').slice(0, 1500) })),
  };
}

const TEXT_FIELDS = [['title', 90], ['name', 40], ['headline', 140], ['whoFeelsIt', 40], ['asked', 260], ['symptom', 200], ['howBad', 220], ['now', 200], ['before', 900], ['designCall', 420], ['proof', 900], ['trade', 500], ['whyItMatters', 400]];

export function resolveRecap(rc) {
  const warnings = [];
  const prs = (rc.prs ?? []).slice().sort((a, b) => String(a.mergedAt).localeCompare(String(b.mergedAt)));
  const byNum = new Map(prs.map((p) => [p.number, p]));
  const wsOf = new Map();
  const listed = rc.workstreams ?? rc.themes ?? [];
  const ordered = [...listed.filter((w) => w.kind !== 'feature'), ...listed.filter((w) => w.kind === 'feature')];
  const ws = ordered.map((w, i) => {
    for (const n of w.prs ?? []) {
      if (!byNum.has(n)) warnings.push(`workstream "${w.name ?? w.title}": #${n} is not in prs`);
      else if (wsOf.has(n)) warnings.push(`#${n} is in two workstreams`);
      else wsOf.set(n, i);
    }
    const items = (w.prs ?? []).map((n) => byNum.get(n)).filter(Boolean);
    return { ...w, name: w.name ?? w.title, i, color: PALETTE[i % PALETTE.length], items, additions: items.reduce((s, p) => s + p.additions, 0), deletions: items.reduce((s, p) => s + p.deletions, 0) };
  });
  const rest = prs.filter((p) => !wsOf.has(p.number));
  if (rest.length && !rc.otherPrs) warnings.push(`${rest.length} PR(s) in no workstream: ${rest.slice(0, 20).map((p) => `#${p.number}`).join(', ')}${rest.length > 20 ? '…' : ''}. Place them, or set "otherPrs": "<one line on what they are>"`);
  if (ws.length > RECAP_BUDGET.workstreams) warnings.push(`${ws.length} workstreams (budget ${RECAP_BUDGET.workstreams}); merge related work`);
  const texts = [['summary', [rc.summary ?? ''].flat().join('\n\n'), 700], ...(rc.metrics ?? []).map((m) => ['metric label', m.label, 110]),
    ...ws.flatMap((w) => [...TEXT_FIELDS.map(([k, max]) => [`"${w.name}" ${k}`, w[k], max]),
      ...[w.aha ?? []].flat().map((a) => [`"${w.name}" aha`, a.body, 600]), ...(w.sections ?? []).map((x) => [`"${w.name}" section "${x.title}"`, x.body, 900])]),
    ...ws.flatMap((w) => (w.wins ?? []).map((x) => [`"${w.name}" win`, typeof x === 'string' ? x : x.text, 170])),
    ...ws.flatMap((w) => [[`"${w.name}" triedFirst`, w.triedFirst, 420], ...(w.steps?.items ?? []).flatMap((x) => [[`"${w.name}" step title`, x.title, 50], [`"${w.name}" step`, x.body, 150]])]),
    ...(rc.problems ?? []).flatMap((x, i) => [[`problem ${i + 1} symptom`, x.symptom, 130], [`problem ${i + 1} howBad`, x.howBad, 200], [`problem ${i + 1} now`, x.now, 150]]),
    ...prs.map((p) => [`#${p.number} oneLiner`, p.oneLiner, 160])];
  for (const w of ws) {
    if (w.kind === 'feature') { if (!w.demo) warnings.push(`"${w.name}": a feature needs "demo": how to show it, in 1 to 4 steps`); }
    else if (!w.symptom) warnings.push(`"${w.name}": no symptom. Say what a user or engineer actually saw before, in plain words`);
    for (const d of [w.demo ?? []].flat()) for (const hit of lint(d)) warnings.push(`writing, "${w.name}" demo: ${hit}`);
  }
  for (const [where, text, max] of texts) {
    for (const hit of lint(text)) warnings.push(`writing, ${where}: ${hit}`);
    if (stripCode(text).length > max) warnings.push(`writing, ${where}: ${stripCode(text).length} chars (max ${max}); say less`);
  }
  for (const w of ws) warnings.push(...checkDiagram(w.diagram, 0).filter((x) => !x.includes('chapter')).map((x) => `"${w.name}" ${x}`));
  const days = [...new Set(prs.map((p) => day(p.mergedAt)))];
  const stats = { prs: prs.length, additions: prs.reduce((s, p) => s + p.additions, 0), deletions: prs.reduce((s, p) => s + p.deletions, 0), days: days.length };
  return { rc, prs, ws, themes: ws, wsOf, themeOf: wsOf, rest, warnings, stats };
}

const day = (iso) => String(iso).slice(0, 10);
const fmtDay = (d, opts = { month: 'short', day: 'numeric' }) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const dayKeys = (r) => {
  const first = r.rc.since ?? day(r.prs[0]?.mergedAt);
  const last = r.rc.until ?? day(r.prs.at(-1)?.mergedAt);
  const out = [];
  for (let d = new Date(`${first}T12:00:00Z`); day(d.toISOString()) <= last; d.setUTCDate(d.getUTCDate() + 1)) out.push(day(d.toISOString()));
  return out;
};

// "#123" in prose links to the PR.
const prLinks = (html, rc) => html.replace(/(^|[^\w/&])#(\d{3,6})\b/g, (_, pre, n) => `${pre}<a class="pr" href="${rc.repo ? `https://github.com/${esc(rc.repo)}/pull/${n}` : `#pr-${n}`}">#${n}</a>`);
const prose = (text, rc) => prLinks(md(text), rc);

// Bars per day, stacked by workstream, value on top; notes to the right.
function perDayChart(r) {
  const days = dayKeys(r);
  const per = days.map((d) => r.prs.filter((p) => day(p.mergedAt) === d));
  const max = Math.max(1, ...per.map((x) => x.length));
  const colW = Math.min(110, Math.max(44, 800 / days.length));
  const W = days.length * colW;
  const H = 240;
  const plot = H - 46;
  const bars = per.map((ps, i) => {
    let y = plot;
    const x0 = i * colW + colW * 0.18;
    const bw = (colW * 0.64).toFixed(1);
    const seg = (n, fill, extra = '') => { if (!n) return ''; const h = (n / max) * (plot - 24); y -= h; return `<rect x="${x0}" y="${y.toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" fill="${fill}"${extra}/>`; };
    const segs = r.ws.map((w) => seg(ps.filter((p) => r.wsOf.get(p.number) === w.i).length, w.color)).join('') + seg(ps.filter((p) => !r.wsOf.has(p.number)).length, 'var(--muted-foreground)', ' opacity=".35"');
    return `${segs}${ps.length ? `<text x="${i * colW + colW / 2}" y="${(y - 6).toFixed(1)}" text-anchor="middle" class="ch-v">${ps.length}</text>` : ''}<text x="${i * colW + colW / 2}" y="${H - 22}" text-anchor="middle" class="ch-l">${fmtDay(days[i], { weekday: 'short' })}</text><text x="${i * colW + colW / 2}" y="${H - 8}" text-anchor="middle" class="ch-l ch-d">${fmtDay(days[i], { month: 'short', day: 'numeric' })}</text>`;
  }).join('');
  const notes = Object.entries(r.rc.dayNotes ?? {}).filter(([d]) => days.includes(d));
  return `<div class="perday"><svg class="chart" viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}"><line x1="0" x2="${W}" y1="${plot}" y2="${plot}" class="ch-axis"/>${bars}</svg>${notes.length ? `<dl class="daynotes">${notes.map(([d, t]) => `<dt>${fmtDay(d, { weekday: 'short' })}</dt><dd>${esc(t)}</dd>`).join('')}</dl>` : ''}</div>`;
}

// One row per agent lane, PRs as dots on a time axis, colored by workstream.
function swimlanes(r) {
  const byLane = new Map();
  for (const p of r.prs) if (p.lane) byLane.set(p.lane, [...(byLane.get(p.lane) ?? []), p]);
  if (!byLane.size) return '';
  const rows = [...byLane].sort((a, b) => b[1].length - a[1].length);
  const top = rows.slice(0, 12);
  const restN = rows.slice(12).reduce((n, x) => n + x[1].length, 0);
  const t = r.prs.map((p) => Date.parse(p.mergedAt));
  const lo = Math.min(...t);
  const hi = Math.max(...t);
  const L = 200;
  const W = 900;
  const X = (ms) => L + ((ms - lo) / Math.max(1, hi - lo)) * (W - L - 16);
  const RH = 26;
  const H = top.length * RH + 30;
  const names = r.rc.lanes ?? {};
  const body = top.map(([k, ps], i) => {
    const y = i * RH + 14;
    return `<text x="0" y="${y + 4}" class="sl-l">${esc(String(names[k] ?? k).slice(0, 30))}</text><text x="${L - 10}" y="${y + 4}" text-anchor="end" class="sl-n">${ps.length}</text><line x1="${L}" x2="${W - 16}" y1="${y}" y2="${y}" class="sl-track"/>${ps.map((p) => { const w = r.ws[r.wsOf.get(p.number)]; return `<a href="#pr-${p.number}"><circle cx="${X(Date.parse(p.mergedAt)).toFixed(1)}" cy="${y}" r="4.5" fill="${w?.color ?? 'var(--muted-foreground)'}" fill-opacity=".9"><title>#${p.number} ${esc(p.oneLiner || p.title)}</title></circle></a>`; }).join('')}`;
  }).join('');
  const ticks = dayKeys(r).map((d) => Date.parse(`${d}T12:00:00Z`)).filter((ms) => ms >= lo && ms <= hi).map((ms) => `<text x="${X(ms).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="sl-n">${fmtDay(day(new Date(ms).toISOString()), { weekday: 'short' })}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}">${body}${ticks}</svg>${restN ? `<p class="t-small t-muted">${rows.length - 12} more lanes opened ${restN} PRs.</p>` : ''}`;
}

function media(im) {
  const ext = String(im.src ?? '').split('.').pop().toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm' }[ext];
  const url = /^https?:/.test(im.src) ? im.src : im.abs && fs.existsSync(im.abs) ? `data:${mime};base64,${fs.readFileSync(im.abs).toString('base64')}` : null;
  return url ? { url, video: /^video/.test(mime ?? '') } : null;
}
const figure = (im) => { const m = media(im); return m ? `<figure class="figure panel">${m.video ? `<video src="${m.url}" controls muted loop playsinline></video>` : `<img src="${m.url}" alt="${esc(im.caption ?? '')}">`}${im.caption ? `<figcaption>${esc(im.caption)}</figcaption>` : ''}</figure>` : ''; };
// Drag to compare two screenshots of the same thing.
const compare = (c) => { const a = media(c.before ?? {}); const b = media(c.after ?? {}); return a && b ? `<figure class="figure panel"><div class="cmp" style="--x:50%"><img src="${a.url}" alt="before"><img src="${b.url}" alt="after" class="cmp-after"><input type="range" min="0" max="100" value="50" aria-label="Before and after" oninput="this.parentNode.style.setProperty('--x',this.value+'%')"><span class="cmp-tag cmp-b">Before</span><span class="cmp-tag cmp-a">After</span></div>${c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : ''}</figure>` : ''; };

function stepsHTML(st, rc) {
  const items = st?.items ?? [];
  if (!items.length) return '';
  return `<figure class="steps" data-steps><div class="steps-row">${items.map((x, i) => `<button type="button" class="step${i === 0 ? ' on' : ''}" data-step="${i}">${x.tag ? `<span class="step-tag">${esc(x.tag)}</span>` : ''}<span class="step-t">${esc(x.title)}</span></button>`).join('<span class="step-arrow" aria-hidden="true">→</span>')}</div><div class="step-bodies">${items.map((x, i) => `<p class="step-b${i === 0 ? ' on' : ''}" data-step-b="${i}"><span class="step-n">${i + 1}/${items.length}</span> ${prLinks(esc(x.body ?? ''), rc)}</p>`).join('')}</div>${st.caption ? `<figcaption>${esc(st.caption)}</figcaption>` : ''}</figure>`;
}
const STEPS_JS = `<script>(()=>{const go=(f,i)=>{f.querySelectorAll('[data-step]').forEach(b=>b.classList.toggle('on',+b.dataset.step===i));f.querySelectorAll('[data-step-b]').forEach(b=>b.classList.toggle('on',+b.dataset.stepB===i));f.dataset.cur=i};
document.addEventListener('click',e=>{const b=e.target.closest('[data-step]');if(!b)return;const f=b.closest('[data-steps]');f.dataset.manual=1;go(f,+b.dataset.step)});
if(matchMedia('(prefers-reduced-motion: reduce)').matches||document.querySelector('meta[name=prtour-print]'))return;
const io=new IntersectionObserver(es=>es.forEach(en=>{const f=en.target;clearInterval(f._t);if(!en.isIntersecting)return;f._t=setInterval(()=>{if(f.dataset.manual)return clearInterval(f._t);const n=f.querySelectorAll('[data-step]').length;go(f,((+f.dataset.cur||0)+1)%n)},2600)}),{threshold:.6});
document.querySelectorAll('[data-steps]').forEach(f=>io.observe(f))})()</script>`;

// Left rail: sticky section nav, current section highlighted.
function tocHTML(r) {
  const fix = r.ws.filter((w) => w.kind !== 'feature');
  const feat = r.ws.filter((w) => w.kind === 'feature');
  const link = (w) => `<a href="#ws-${w.i + 1}" data-toc="ws-${w.i + 1}"><span class="dot" style="--ws:${w.color}"></span>${esc(w.name)}</a>`;
  return `<nav class="toc no-print" aria-label="Sections"><a href="#top" data-toc="top">Overview</a>${fix.length ? `<div class="toc-h">Fixed</div>${fix.map(link).join('')}` : ''}${feat.length ? `<div class="toc-h">New</div>${feat.map(link).join('')}` : ''}<a href="#all-prs" data-toc="all-prs" class="toc-all">All PRs</a></nav>`;
}
const TOC_JS = `<script>(()=>{const ls=[...document.querySelectorAll('[data-toc]')];const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)ls.forEach(l=>l.classList.toggle('on',l.dataset.toc===e.target.id))}),{rootMargin:'-40% 0px -55% 0px'});ls.forEach(l=>{const t=document.getElementById(l.dataset.toc);t&&io.observe(t)})})()</script>`;

function resultsTable(t, rc) {
  if (!t?.rows?.length) return '';
  const cols = t.columns ?? [];
  const head = cols.length || t.caption ? `<thead><tr>${(cols.length ? cols : t.rows[0].map(() => '')).map((c, i) => `<th${i ? ' class="num"' : ''}>${i === 0 && t.caption ? esc(t.caption) : esc(c)}</th>`).join('')}</tr></thead>` : '';
  return `<div class="results"><table class="table">${head}<tbody>${t.rows.map((row, ri) => `<tr${ri === t.rows.length - 1 && t.highlightLast !== false ? ' class="last"' : ''}>${row.map((c, i) => `<td${i ? ' class="num"' : ''}>${prLinks(esc(c), rc)}</td>`).join('')}</tr>`).join('')}</tbody></table>${t.note ? `<p class="t-small t-muted">${prLinks(esc(t.note), rc)}</p>` : ''}</div>`;
}

function section(w, n, rc, icons) {
  const tag = [n, w.tag, w.name].filter(Boolean).join(' · ');
  const callout = (label, body) => (body ? `<aside class="callout-box"><div class="eyebrow">${esc(label)}</div>${prose(body, rc)}</aside>` : '');
  const visuals = [w.diagram?.nodes?.length ? ui.card({ title: esc(w.diagram.title ?? 'Before / after'), description: w.diagram.caption ? esc(w.diagram.caption) : '', body: diagramToggle(w.diagram, () => '#', icons) }) : '',
    w.mermaid ? ui.card({ body: `<pre class="mermaid">${esc(w.mermaid)}</pre>` }) : '', w.compare ? compare(w.compare) : '', ...(w.images ?? []).map(figure)].filter(Boolean).join('');
  const prLink = (p) => `<a class="pr" href="${rc.repo ? `https://github.com/${esc(rc.repo)}/pull/${p}` : `#pr-${p}`}">#${p}</a>`;
  const lanes = new Map();
  for (const p of w.items) if (p.lane) lanes.set(p.lane, (lanes.get(p.lane) ?? 0) + 1);
  const laneChips = [...lanes].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, c]) => `<span class="badge" data-variant="outline">${esc((rc.lanes ?? {})[k] ?? k)} · ${c}</span>`).join('');
  const wins = (w.wins ?? []).map((x) => (typeof x === 'string' ? { text: x } : x));
  const details = [w.before ? `<div class="prose">${prose(w.before, rc)}</div>` : '', resultsTable(w.results, rc), w.proof ? `<div class="prose">${prose(w.proof, rc)}</div>` : '',
    ...(w.sections ?? []).map((x) => `<h3 class="ws-h3">${esc(x.title)} ${(x.prs ?? []).map(prLink).join(' ')}</h3><div class="prose">${prose(x.body, rc)}</div>${resultsTable(x.results, rc)}`),
    w.trade ? `<h3 class="ws-h3">The trade we accepted</h3><div class="prose">${prose(w.trade, rc)}</div>` : ''].filter(Boolean).join('');
  return `<section class="ws" id="ws-${w.i + 1}" style="--ws:${w.color}">
<div class="ws-head">${w.icon && icons?.has(w.icon) ? `<span class="ic-chip">${iconHTML(icons, w.icon)}</span>` : ''}<div class="eyebrow ws-tag">${esc(tag)}</div></div><h2 class="serif ws-title">${esc(w.title ?? w.name)}</h2>
${w.symptom || w.now || w.whyItMatters ? `<div class="pain"><div class="pain-before"><div class="eyebrow">${w.kind === 'feature' ? 'Before, you couldn\'t' : 'What people saw'}</div><p class="pain-s">${prLinks(esc(w.symptom ?? ''), rc)}</p>${w.howBad ? `<p class="pain-d">${prLinks(esc(w.howBad), rc)}</p>` : ''}</div><div class="pain-now"><div class="eyebrow">${w.kind === 'feature' ? 'Now you can' : 'Now'}</div><p class="pain-s">${prLinks(esc(w.now ?? w.whyItMatters ?? ''), rc)}</p></div></div>` : ''}
${w.demo ? `<aside class="demo"><div class="eyebrow">Try it in a demo</div><ol>${[w.demo].flat().map((x) => `<li>${prLinks(md(x).replace(/^<p>|<\/p>$/g, ''), rc)}</li>`).join('')}</ol></aside>` : ''}
${wins.length ? `<ul class="wins">${wins.map((x) => `<li>${prLinks(md(x.text).replace(/^<p>|<\/p>$/g, ''), rc)}${(x.prs ?? []).length ? ` <span class="t-small">${x.prs.map(prLink).join(' ')}</span>` : ''}</li>`).join('')}</ul>` : ''}
${visuals}
${stepsHTML(w.steps, rc)}
${callout('The aha', w.designCall)}
${w.triedFirst ? `<aside class="callout-box tried"><div class="eyebrow">What we tried first</div>${prose(w.triedFirst, rc)}</aside>` : ''}
${[w.aha ?? []].flat().map((a) => callout(a.title ?? 'The aha', a.body)).join('')}
${w.asked || laneChips ? `<div class="ws-meta">${w.asked ? `<p class="asked"><span class="eyebrow">The ask</span> ${esc(w.asked)}</p>` : ''}${laneChips ? `<div class="row lanes"><span class="eyebrow">Agent lanes</span>${laneChips}</div>` : ''}</div>` : ''}
${details ? `<details class="disclosure ws-details"><summary><span>Engineering details</span><span class="grow"></span><span class="t-small t-muted">tables, measurements, trade-offs</span></summary><div class="stack" style="padding:6px 18px 18px">${details}</div></details>` : ''}
<details class="disclosure ws-prs"><summary><span>${w.items.length} PR${w.items.length === 1 ? '' : 's'}</span><span class="grow"></span><span class="f-count">${counts(w.additions, w.deletions)}</span></summary><ul class="flist" style="padding:4px 14px 10px">${w.items.map((p) => `<li><a href="${esc(p.url ?? '#')}"><span class="t-mono t-muted">#${p.number}</span> <span class="f-name">${esc(p.oneLiner || p.title)}</span></a><span class="f-count">${counts(p.additions, p.deletions)}</span></li>`).join('')}</ul></details>
</section>`;
}

// Two grids up top: problems that are now fixed, and new things to demo.
function overviewGrids(r) {
  const card = (w, body) => `<a class="pcard" href="#ws-${w.i + 1}" style="--ws:${w.color}">${w.icon && r.icons?.has(w.icon) ? `<span class="ic-chip">${iconHTML(r.icons, w.icon)}</span>` : ''}${body}</a>`;
  const fixes = r.ws.filter((w) => w.kind !== 'feature' && w.symptom).map((w) => card(w, `<p class="serif pcard-s">${esc(w.symptom)}</p>${w.howBad ? `<p class="pcard-d">${esc(w.howBad)}</p>` : ''}${w.now ? `<p class="pcard-now"><span class="eyebrow">Now</span> ${esc(w.now)}</p>` : ''}`));
  const feats = r.ws.filter((w) => w.kind === 'feature').map((w) => card(w, `<p class="serif pcard-s">${esc(w.title ?? w.name)}</p>${w.now ? `<p class="pcard-d">${esc(w.now)}</p>` : ''}${w.demo ? `<p class="pcard-now"><span class="eyebrow eb-demo">Demo</span> ${esc([w.demo].flat()[0])}</p>` : ''}`));
  return `${fixes.length ? `<section><h2 class="serif sec-h">${esc(r.rc.problemsTitle ?? 'What was broken, now fixed')}</h2><div class="pgrid">${fixes.join('')}</div></section>` : ''}${feats.length ? `<section><h2 class="serif sec-h">New you can demo</h2><div class="pgrid">${feats.join('')}</div></section>` : ''}`;
}

export function renderRecapHTML(r, o = {}) {
  const rc = r.rc;
  const s = r.stats;
  const range = rc.since ? `${fmtDay(rc.since)}–${fmtDay(rc.until ?? day(r.prs.at(-1)?.mergedAt ?? rc.since), { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
  const eyebrow = [rc.repo, rc.author, range, rc.eyebrow].filter(Boolean).map(esc).join(' · ');
  const metrics = (rc.metrics ?? []).map((m) => `<div class="metric">${m.icon ? `<div class="metric-ic">${iconHTML(r.icons, m.icon)}</div>` : ''}<div class="serif metric-v${String(m.before ?? '').length + String(m.after ?? m.value ?? '').length + String(m.unit ?? '').length > 15 ? ' long' : ''}">${m.before != null ? `${esc(m.before)} → ${esc(m.after)}${m.unit ? ` ${esc(m.unit)}` : ''}` : esc(m.value)}</div><div class="metric-l">${esc(m.label)}</div></div>`).join('');
  const table = `<table class="table wstable"><thead><tr><th>Workstream</th><th>Who feels it</th><th class="num">PRs</th><th>Headline result</th></tr></thead><tbody>${r.ws.map((w) => `<tr><td><a href="#ws-${w.i + 1}" class="ws-cell" title="${w.kind === 'feature' ? 'New capability' : 'Problem fixed'}">${w.icon && r.icons?.has(w.icon) ? iconHTML(r.icons, w.icon) : `<span class="dot" style="--ws:${w.color}"></span>`}${esc(w.name)}</a></td><td class="t-muted">${esc(w.whoFeelsIt ?? '')}</td><td class="num">${w.items.length}</td><td>${esc(w.headline ?? '')}</td></tr>`).join('')}${r.rest.length ? `<tr><td class="t-muted">Everything else</td><td class="t-muted">${esc(rc.otherPrs ?? '')}</td><td class="num">${r.rest.length}</td><td></td></tr>` : ''}</tbody></table>`;
  const legend = `<div class="legend">${r.ws.map((w) => `<a href="#ws-${w.i + 1}" class="t-small"><span class="dot" style="--ws:${w.color}"></span>${esc(w.name)}</a>`).join('')}</div>`;
  const lanes = swimlanes(r);
  const all = `<details class="disclosure"><summary><span>All ${s.prs} PRs</span></summary><div class="table-container"><table class="table"><thead><tr><th>Merged</th><th>PR</th><th>What it did</th><th>Workstream</th><th>Lane</th><th class="num">Lines</th></tr></thead><tbody>${r.prs.map((p) => { const w = r.ws[r.wsOf.get(p.number)]; return `<tr id="pr-${p.number}"><td class="t-muted t-small" style="white-space:nowrap">${fmtDay(day(p.mergedAt))}</td><td><a href="${esc(p.url ?? '#')}" class="t-mono">#${p.number}</a></td><td>${esc(p.oneLiner || p.title)}</td><td class="t-small">${w ? `<span class="dot" style="--ws:${w.color}"></span>${esc(w.name)}` : ''}</td><td class="t-small t-muted">${esc((rc.lanes ?? {})[p.lane] ?? p.lane ?? '')}</td><td class="num t-mono" style="white-space:nowrap">${counts(p.additions, p.deletions)}</td></tr>`; }).join('')}</tbody></table></div></details>`;
  const anyMermaid = r.ws.some((w) => w.mermaid);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(rc.title || 'What shipped')}</title>${o.print ? '<meta name="prtour-print" content="1">' : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap">
<style>${CSS}${RECAP_CSS}${TOGGLE_CSS}${ICON_CSS}</style>${THEME}</head><body><div class="shell">${tocHTML(r)}<main class="page doc" id="top">
<header class="hero"><div class="eyebrow">${eyebrow}</div><h1 class="serif doc-title">${esc(rc.title || 'What shipped')}</h1>${rc.summary ? `<div class="lede">${prose(rc.summary, rc)}</div>` : ''}</header>
${overviewGrids(r)}
${metrics ? `<h2 class="serif sec-h">By the numbers</h2><div class="metrics panel">${metrics}</div>` : ''}
<div class="panel chartbox"><div class="chart-h"><b>PRs merged per day</b><span class="t-small t-muted">${s.prs} PRs · <span class="t-add">+${s.additions.toLocaleString()}</span> <span class="t-del">−${s.deletions.toLocaleString()}</span></span></div>${perDayChart(r)}${legend}</div>
${table}
${lanes ? `<div class="panel chartbox"><div class="chart-h"><b>Which agent lanes did the work</b><span class="t-small t-muted">one row per lane, each dot a merged PR</span></div>${lanes}</div>` : ''}
${r.ws.map((w, k) => `${k === 0 && w.kind !== 'feature' ? '<h2 class="serif part-h" id="fixed">Part 1 · What was broken, now fixed</h2>' : ''}${w.kind === 'feature' && r.ws[k - 1]?.kind !== 'feature' ? `<h2 class="serif part-h" id="new">${k ? 'Part 2 · ' : ''}New you can demo</h2>` : ''}${section(w, k + 1, rc, r.icons)}`).join('\n').replace(/<details class="disclosure ws-details">/g, o.print ? '<details class="disclosure ws-details" open>' : '$&')}
<section class="appendix" id="all-prs">${all}</section>
<footer class="t-small t-muted no-print" style="margin-top:48px">Made with <a href="https://github.com/2018kguo/prtour">prtour</a></footer>
</main></div>${TOGGLE_JS}${STEPS_JS}${TOC_JS}${anyMermaid ? `<script type="module">try{const{default:m}=await import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs');m.initialize({startOnLoad:false,theme:document.documentElement.classList.contains('dark')?'dark':'neutral'});await m.run({querySelector:'pre.mermaid'})}catch(e){}</script>` : ''}</body></html>`;
}

const RECAP_CSS = `
.doc{max-width:860px}.serif{font-family:"Source Serif 4",Georgia,serif;letter-spacing:-.01em}
.eyebrow{font:500 11.5px/1.4 var(--font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted-foreground)}
.hero{padding:56px 0 24px;display:flex;flex-direction:column;gap:14px}.doc-title{font-size:38px;line-height:1.12;font-weight:700;margin:0;text-wrap:balance}
.lede{font-size:18px;line-height:1.6;color:var(--muted-foreground)}.lede p{margin:0}
.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px 32px;padding:28px;margin:12px 0 24px;background:var(--muted)}
.metric-v{font-size:28px;line-height:1.12;font-weight:700;text-wrap:balance}.metric-v.long{font-size:22px}.metric-l{font-size:13.5px;line-height:1.45;color:var(--muted-foreground);margin-top:6px}
.chartbox{padding:22px 24px;margin:0 0 24px}.chart-h{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.perday{display:flex;flex-direction:column;gap:18px}.perday .chart{width:100%}
.chart{width:100%;max-width:100%;height:auto;display:block;font:11.5px var(--font-sans)}.ch-axis{stroke:var(--border)}.ch-v{fill:var(--foreground);font-weight:600;font-size:12px}.ch-l{fill:var(--muted-foreground)}.ch-d{font-size:10.5px}
.daynotes{margin:0;font-size:13px;display:grid;grid-template-columns:auto 1fr auto 1fr;gap:8px 12px;border-top:1px solid var(--border);padding-top:14px}.daynotes dt{font-weight:600}.daynotes dd{margin:0;color:var(--muted-foreground)}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:12px}
.dot{display:inline-block;width:9px;height:9px;border-radius:999px;background:var(--ws);margin-right:8px;vertical-align:baseline}
.sl-l{fill:var(--foreground);font-size:12px}.sl-n{fill:var(--muted-foreground);font-size:11px}.sl-track{stroke:var(--border)}
.wstable{margin:8px 0 32px;table-layout:auto;width:100%}.wstable td,.wstable th{vertical-align:top;white-space:normal}.wstable td:first-child{white-space:nowrap;width:30%}.wstable td:nth-child(2){width:20%}.wstable td:nth-child(4){width:44%}.table .num{text-align:right;font-variant-numeric:tabular-nums}
.ws{padding-top:72px;display:flex;flex-direction:column;gap:18px}
.ws-head{display:flex;align-items:center;gap:12px}.ws-head .ic-chip{color:var(--ws)}.ws-cell{display:inline-flex;align-items:center;gap:8px}.ws-cell .ic{color:var(--ws)}.metric-ic{color:var(--muted-foreground);margin-bottom:8px}.metric-ic .ic{width:20px;height:20px}
.ws-tag{color:var(--ws)}.ws-title{font-size:30px;line-height:1.18;font-weight:700;margin:-8px 0 0;text-wrap:balance}
.asked{margin:0;font-size:15px;color:var(--muted-foreground);border-left:2px solid var(--ws);padding-left:12px}.asked .eyebrow{margin-right:6px}
.prose{font-size:15.5px;line-height:1.7}.prose p{margin:0 0 12px}.prose p:last-child{margin:0}
a.pr{font-family:var(--font-mono);font-size:.88em;color:var(--ws,var(--primary));text-decoration:underline;text-underline-offset:2px}
.callout-box{border:1.5px dashed var(--border);border-radius:var(--radius-lg);padding:18px 22px;font-size:14.5px;line-height:1.65}.callout-box .eyebrow{color:var(--ws);margin-bottom:8px}.callout-box p{margin:0}
.results .table td,.results .table th{padding-top:10px;padding-bottom:10px;white-space:normal}.results .table{width:100%}.results tr.last td{font-weight:600}
.ws-h3{font-size:18px;font-weight:600;margin:10px 0 -6px}
.why{background:color-mix(in oklab,var(--ws) 12%,var(--background));border-radius:var(--radius-lg);padding:18px 22px;font-size:15px;line-height:1.65}.why b{color:var(--ws)}
.ws-prs{margin-top:4px}
.cmp{position:relative;display:grid}.cmp>img{grid-area:1/1;width:100%;display:block}.cmp-after{clip-path:inset(0 0 0 var(--x))}
.cmp input{grid-area:1/1;align-self:stretch;width:100%;margin:0;opacity:0;cursor:ew-resize}.cmp::after{content:"";position:absolute;top:0;bottom:0;left:var(--x);width:2px;background:var(--primary);pointer-events:none}
.cmp-tag{position:absolute;top:10px;font:500 11px var(--font-mono);background:var(--background);padding:2px 6px;border-radius:4px;pointer-events:none}.cmp-b{left:10px}.cmp-a{right:10px}
.appendix{padding-top:64px}
.shell{display:grid;grid-template-columns:1fr minmax(0,860px) 1fr;gap:0 40px}.shell>.doc{grid-column:2;max-width:none;padding-left:0;padding-right:0}
.toc{grid-column:1;justify-self:end;position:sticky;top:0;align-self:start;height:100vh;overflow:auto;padding:72px 0 24px;display:flex;flex-direction:column;gap:2px;width:220px;font-size:13.5px}
.toc a{padding:5px 10px;border-radius:7px;color:var(--muted-foreground);display:flex;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.toc a:hover{color:var(--foreground);background:var(--muted)}.toc a.on{color:var(--foreground);background:var(--muted);font-weight:500}
.toc-h{font:500 10.5px var(--font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted-foreground);margin:16px 10px 4px}.toc-all{margin-top:14px}
@media (max-width:1280px){.shell{display:block}.toc{display:none}.shell>.doc{padding-left:clamp(16px,5vw,80px);padding-right:clamp(16px,5vw,80px);max-width:860px}}
.figure figcaption,.steps figcaption{text-align:center}
.steps{margin:0;padding:18px;border:1px solid var(--border);border-radius:var(--radius-xl);background:var(--card)}
.steps-row{display:flex;align-items:stretch;gap:8px;overflow-x:auto;padding-bottom:4px}
.step{flex:1;min-width:120px;text-align:left;border:1.5px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--background);cursor:pointer;display:flex;flex-direction:column;gap:4px;transition:border-color .2s,background .2s,transform .2s}
.step.on{border-color:var(--ws);background:color-mix(in oklab,var(--ws) 10%,var(--background));transform:translateY(-2px)}
.step-tag{font:500 10px var(--font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ws)}.step-t{font:600 13.5px/1.35 var(--font-sans)}
.step-arrow{align-self:center;color:var(--muted-foreground);flex:none}
.step-bodies{position:relative;min-height:3.2em;margin-top:14px}.step-b{margin:0;font-size:15px;line-height:1.55;display:none}.step-b.on{display:block;animation:stepin .3s ease}
.step-n{font:500 11px var(--font-mono);color:var(--ws);margin-right:6px}
@keyframes stepin{from{opacity:0;transform:translateY(4px)}to{opacity:1}}
.tried{border-style:dashed;background:none}.tried .eyebrow{color:var(--muted-foreground)!important}
@media print{.step-b{display:block!important;margin-bottom:6px}.step-arrow{display:none}}
.sec-h{font-size:24px;font-weight:700;margin:40px 0 16px}.part-h{font-size:15px;font-family:var(--font-mono);font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--muted-foreground);margin:96px 0 -40px;padding-top:24px;border-top:2px solid var(--foreground)}
.demo{border-radius:var(--radius-lg);padding:16px 20px;background:color-mix(in oklab,var(--ws) 9%,var(--background));border:1px solid color-mix(in oklab,var(--ws) 25%,var(--background))}.demo .eyebrow{color:var(--ws);margin-bottom:6px}.demo ol{margin:0;padding-left:20px;font-size:15px;line-height:1.6}.eb-demo{color:var(--ws)!important}
.pgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.pcard{display:flex;flex-direction:column;gap:10px;padding:22px;border:1px solid var(--border);border-radius:var(--radius-xl);background:var(--card);border-top:3px solid var(--ws);transition:box-shadow .15s}.pcard:hover{box-shadow:0 8px 24px -12px rgb(0 0 0/.18);color:inherit}
.pcard .ic-chip{color:var(--ws)}.pcard-s{font-size:21px;line-height:1.3;font-weight:700;margin:0;text-wrap:balance}.pcard-d{font-size:14px;line-height:1.55;color:var(--muted-foreground);margin:0}
.pcard-now{margin:auto 0 0;padding-top:12px;border-top:1px solid var(--border);font-size:14.5px;line-height:1.5;font-weight:500}.pcard-now .eyebrow{color:var(--add);margin-right:6px}
.pain{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}
.pain>div{border-radius:var(--radius-lg);padding:18px 20px}.pain .eyebrow{margin-bottom:8px}
.pain-before{background:color-mix(in oklab,var(--del) 8%,var(--background));border:1px solid color-mix(in oklab,var(--del) 22%,var(--background))}.pain-before .eyebrow{color:var(--del)}
.pain-now{background:color-mix(in oklab,var(--add) 8%,var(--background));border:1px solid color-mix(in oklab,var(--add) 22%,var(--background))}.pain-now .eyebrow{color:var(--add)}
.pain-s{font-size:16.5px;line-height:1.5;font-weight:600;margin:0}.pain-d{font-size:14px;line-height:1.55;color:var(--muted-foreground);margin:8px 0 0}
.wins{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px}.wins li{position:relative;padding-left:22px;font-size:15.5px;line-height:1.55}.wins li::before{content:"";position:absolute;left:4px;top:.62em;width:8px;height:8px;border-radius:2px;background:var(--ws)}
.ws-meta{display:flex;flex-direction:column;gap:10px}.lanes{gap:6px}.lanes .eyebrow{margin-right:4px}
.ws-details[open]>summary{border-bottom:1px solid var(--border)}
@media (max-width:760px){.pgrid,.pain{grid-template-columns:minmax(0,1fr)}}
@media print{.pcard{break-inside:avoid}.ws-details{display:block}.ws-details>summary{display:none}.ws-details>div{display:flex!important}}
.ws .figure img{max-height:440px;object-fit:contain;background:var(--muted)}
@media (max-width:760px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.perday{flex-direction:column;align-items:stretch}.doc-title{font-size:30px}}
@media print{.doc{max-width:none}.ws{break-before:page;padding-top:0}.metrics,.chartbox{break-inside:avoid}.dg-toggle,.cmp input,.cmp-tag{display:none}.cmp-after{clip-path:none}.cmp>img:first-child{display:none}details.disclosure:not(.ws-prs){display:none}}
`;

export function renderRecapMarkdown(r) {
  const rc = r.rc;
  const s = r.stats;
  const out = [`## ${rc.title || 'What shipped'}`, '', `${s.prs} PRs over ${s.days} day${s.days === 1 ? '' : 's'} · +${s.additions} −${s.deletions}`, ''];
  if (rc.summary) out.push([rc.summary].flat().join('\n\n'), '');
  if (rc.metrics?.length) out.push(...rc.metrics.map((m) => `- **${m.before != null ? `${m.before} → ${m.after}${m.unit ? ` ${m.unit}` : ''}` : m.value}** ${m.label}`), '');
  out.push('| Workstream | Who feels it | PRs | Headline result |', '|---|---|--:|---|', ...r.ws.map((w) => `| ${w.name} | ${w.whoFeelsIt ?? ''} | ${w.items.length} | ${w.headline ?? ''} |`), '');
  for (const w of r.ws) {
    out.push(`### ${w.title ?? w.name}`, '');
    if (w.before) out.push(w.before, '');
    if (w.designCall) out.push(`> **The design call.** ${w.designCall.replace(/\n+/g, ' ')}`, '');
    if (w.results?.rows?.length) { const cols = w.results.columns ?? w.results.rows[0].map(() => ''); out.push(`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...w.results.rows.map((x) => `| ${x.join(' | ')} |`), ''); }
    if (w.diagram?.nodes?.length) out.push(diagramMermaid(w.diagram), '');
    if (w.whyItMatters) out.push(`**Why it matters.** ${w.whyItMatters}`, '');
    out.push(`<details><summary>${w.items.length} PRs</summary>`, '', ...w.items.map((p) => `- [#${p.number}](${p.url}) ${p.oneLiner || p.title}`), '', '</details>', '');
  }
  return `${out.join('\n').trim()}\n`;
}

export function renderRecapTerminal(r, { color = true, width = 100 } = {}) {
  const c = (code) => (x) => (color ? `\x1b[${code}m${x}\x1b[0m` : String(x));
  const [bold, dim, green, red, yellow] = [c(1), c(2), c(32), c(31), c(33)];
  const tones = [32, 34, 33, 35, 31, 36, 32, 35, 33, 34].map(c);
  const rc = r.rc;
  const s = r.stats;
  const wrap = (t) => String(t ?? '').replace(/\s+/g, ' ').match(new RegExp(`.{1,${width - 4}}(\\s|$)`, 'g'))?.map((l) => `  ${l.trim()}`) ?? [];
  const out = [bold(rc.title || 'What shipped'), dim(`${s.prs} PRs · ${s.days} day${s.days === 1 ? '' : 's'} · `) + green(`+${s.additions}`) + ' ' + red(`-${s.deletions}`)];
  if (rc.summary) out.push('', ...wrap([rc.summary].flat().join(' ')));
  if (rc.metrics?.length) out.push('', ...rc.metrics.map((m) => `  ${bold(m.before != null ? `${m.before} → ${m.after}${m.unit ? ` ${m.unit}` : ''}` : m.value)}  ${dim(m.label)}`));
  for (const w of r.warnings) out.push(yellow(`! ${w}`));
  out.push('', bold('PRs merged per day'));
  const days = dayKeys(r);
  const max = Math.max(1, ...days.map((d) => r.prs.filter((p) => day(p.mergedAt) === d).length));
  for (const d of days) {
    const ps = r.prs.filter((p) => day(p.mergedAt) === d);
    const bar = r.ws.map((w, i) => tones[i % 10]('█'.repeat(Math.round((ps.filter((p) => r.wsOf.get(p.number) === w.i).length / max) * 40)))).join('');
    out.push(`  ${dim(fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric' }).padEnd(12))} ${bar} ${ps.length || ''}  ${dim((rc.dayNotes ?? {})[d] ?? '')}`);
  }
  out.push('', ...r.ws.map((w, i) => `  ${tones[i % 10]('●')} ${bold(String(w.name).padEnd(28))} ${String(w.items.length).padStart(3)}  ${w.headline ?? ''}`));
  for (const [i, w] of r.ws.entries()) {
    out.push('', tones[i % 10](bold(`━━ ${i + 1} · ${w.title ?? w.name} `.padEnd(width, '━'))));
    if (w.before) out.push(...wrap(w.before));
    if (w.designCall) out.push('', `  ${yellow('THE DESIGN CALL')}`, ...wrap(w.designCall));
    if (w.diagram?.nodes?.length) out.push('', ...diagramTree(w.diagram, { add: green, dim, chg: yellow }).map((l) => `  ${l}`));
    if (w.results?.rows?.length) out.push('', ...w.results.rows.map((x) => `  ${x.map((v, j) => (j ? String(v).padStart(16) : String(v).padEnd(36))).join('')}`));
    if (w.whyItMatters) out.push('', ...wrap(`Why it matters. ${w.whyItMatters}`).map(bold));
  }
  return `${out.join('\n')}\n`;
}
