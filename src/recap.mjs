// Recap: what shipped across many PRs and days, for a human reader. Graphics
// first (timeline, areas, theme cards with diagrams and images), one line per
// PR, no diffs. recap.json is scaffolded from `gh`, then the agent writes the
// themes and one-liners.
import fs from 'node:fs';
import { lint, stripCode } from './style.mjs';
import { checkDiagram, diagramMermaid, diagramSVG, diagramTree } from './diagram.mjs';
import { CSS, FONTS, THEME, counts, esc, ui } from './ui.mjs';
import { md } from './html.mjs';
import { kindOf } from './tour.mjs';

export const RECAP_BUDGET = { themes: 6 };
const PALETTE = ['oklch(62.3% .214 259.815)', 'oklch(69.6% .17 162.48)', 'oklch(76.9% .188 70.08)', 'oklch(60.6% .25 292.717)', 'oklch(64.5% .246 16.439)', 'oklch(71.5% .143 215.221)'];

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
    kind: 'recap',
    ...meta,
    summary: '',
    themes: [{ title: 'TODO(agent): group PRs by outcome', body: '', outcome: '', prs: prs.map((p) => p.number) }],
    prs: prs.map((p) => ({
      number: p.number, title: p.title, url: p.url, mergedAt: p.mergedAt, additions: p.additions, deletions: p.deletions,
      files: p.changedFiles, area: areaOf(p.files), oneLiner: '', description: (p.body ?? '').slice(0, 1500),
    })),
  };
}

export function resolveRecap(rc) {
  const warnings = [];
  const prs = (rc.prs ?? []).slice().sort((a, b) => String(a.mergedAt).localeCompare(String(b.mergedAt)));
  const byNum = new Map(prs.map((p) => [p.number, p]));
  const themeOf = new Map();
  const themes = (rc.themes ?? []).map((t, i) => {
    for (const n of t.prs ?? []) {
      if (!byNum.has(n)) warnings.push(`theme "${t.title}": #${n} is not in prs`);
      else if (themeOf.has(n)) warnings.push(`#${n} is in two themes`);
      else themeOf.set(n, i);
    }
    const ps = (t.prs ?? []).map((n) => byNum.get(n)).filter(Boolean);
    return { ...t, i, color: PALETTE[i % PALETTE.length], items: ps, additions: ps.reduce((s, p) => s + p.additions, 0), deletions: ps.reduce((s, p) => s + p.deletions, 0) };
  });
  const loose = prs.filter((p) => !themeOf.has(p.number));
  if (loose.length) warnings.push(`${loose.length} PR(s) in no theme: ${loose.map((p) => `#${p.number}`).join(', ')}`);
  if (themes.length > RECAP_BUDGET.themes) warnings.push(`${themes.length} themes (budget ${RECAP_BUDGET.themes}); merge related work`);
  const texts = [['summary', [rc.summary ?? ''].flat().join('\n\n'), 600],
    ...themes.flatMap((t) => [[`theme "${t.title}" title`, t.title, 70], [`theme "${t.title}"`, t.body, 360], [`theme "${t.title}" outcome`, t.outcome, 140]]),
    ...prs.map((p) => [`#${p.number} oneLiner`, p.oneLiner, 140])];
  for (const [where, text, max] of texts) {
    for (const hit of lint(text)) warnings.push(`writing, ${where}: ${hit}`);
    if (stripCode(text).length > max) warnings.push(`writing, ${where}: ${stripCode(text).length} chars (max ${max}); say less`);
  }
  for (const t of themes) warnings.push(...checkDiagram(t.diagram, 0).filter((w) => !w.includes('chapter')).map((w) => `theme "${t.title}" ${w}`));
  const days = [...new Set(prs.map((p) => String(p.mergedAt).slice(0, 10)))];
  const stats = { prs: prs.length, additions: prs.reduce((s, p) => s + p.additions, 0), deletions: prs.reduce((s, p) => s + p.deletions, 0), days: days.length };
  return { rc, prs, themes, themeOf, warnings, stats };
}

const day = (iso) => String(iso).slice(0, 10);
const fmtDay = (d, opts = { month: 'short', day: 'numeric' }) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

function dayRange(r) {
  const first = r.rc.since ?? day(r.prs[0]?.mergedAt);
  const last = r.rc.until ?? day(r.prs.at(-1)?.mergedAt);
  const out = [];
  for (let d = new Date(`${first}T12:00:00Z`); day(d.toISOString()) <= last; d.setUTCDate(d.getUTCDate() + 1)) out.push(day(d.toISOString()));
  return out;
}

// A swarm on a time axis: x is when the PR merged, dots stack upward only
// when they would overlap. A busy window under two days gets hour ticks.
function timelineSVG(r) {
  if (!r.prs.length) return '';
  const t = r.prs.map((p) => Date.parse(p.mergedAt));
  const lo0 = Math.min(...t);
  const hi0 = Math.max(...t);
  const short = hi0 - lo0 < 2 * 864e5;
  const pad = short ? 36e5 : 864e5 / 2;
  const lo = short ? lo0 - pad : Math.min(lo0, Date.parse(`${r.rc.since ?? day(r.prs[0].mergedAt)}T00:00:00Z`));
  const hi = short ? hi0 + pad : Math.max(hi0, Date.parse(`${r.rc.until ?? day(r.prs.at(-1).mergedAt)}T23:59:59Z`));
  const W = 720;
  const X = (ms) => 16 + ((ms - lo) / Math.max(1, hi - lo)) * (W - 32);
  const placed = [];
  for (const p of r.prs) {
    const rad = Math.min(10, 4 + Math.log10(1 + p.additions + p.deletions) * 1.5);
    const x = X(Date.parse(p.mergedAt));
    let y = rad;
    // ponytail: O(n^2) collision bump; fine for the few hundred PRs a recap holds
    for (let moved = true; moved;) { moved = false; for (const q of placed) { if (Math.hypot(q.x - x, q.y - y) < q.rad + rad + 1.5) { y = q.y + q.rad + rad + 1.5; moved = true; } } }
    placed.push({ p, x, y, rad });
  }
  const top = Math.max(...placed.map((d) => d.y + d.rad)) + 6;
  const H = top + 30;
  const base = H - 26;
  const ticks = [];
  if (short) { for (let h = Math.ceil(lo / 36e5) * 36e5; h <= hi; h += 36e5 * (hi - lo > 18 * 36e5 ? 3 : 1)) ticks.push([h, new Date(h).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'UTC' })]); }
  else { for (let d = Date.parse(`${day(new Date(lo).toISOString())}T12:00:00Z`); d <= hi; d += 864e5) ticks.push([d, fmtDay(day(new Date(d).toISOString()), (hi - lo) / 864e5 > 10 ? { day: 'numeric' } : { weekday: 'short', day: 'numeric' })]); }
  const dots = placed.map(({ p, x, y, rad }) => { const th = r.themes[r.themeOf.get(p.number)]; return `<a href="#pr-${p.number}"><circle cx="${x.toFixed(1)}" cy="${(base - 4 - y).toFixed(1)}" r="${rad.toFixed(1)}" fill="${th?.color ?? 'var(--muted-foreground)'}" fill-opacity=".85"><title>#${p.number} ${esc(p.oneLiner || p.title)}</title></circle></a>`; }).join('');
  const tickEls = ticks.map(([ms, label]) => `<line x1="${X(ms)}" x2="${X(ms)}" y1="${base}" y2="${base + 4}" class="tl-axis"/><text x="${X(ms)}" y="${H - 6}" text-anchor="middle" class="tl-day">${label}</text>`).join('');
  const note = short ? `<text x="${W - 16}" y="14" text-anchor="end" class="tl-day">${fmtDay(day(new Date(lo0).toISOString()), { weekday: 'long', month: 'short', day: 'numeric' })}, UTC</text>` : '';
  return `<svg class="tl" viewBox="0 0 ${W} ${H}" role="img" aria-label="PRs by merge time">${note}<line x1="16" x2="${W - 16}" y1="${base}" y2="${base}" class="tl-axis"/>${tickEls}${dots}</svg>`;
}

function areaBars(r) {
  const by = new Map();
  for (const p of r.prs) by.set(p.area, (by.get(p.area) ?? 0) + p.additions + p.deletions);
  const rows = [...by].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1, ...rows.map((x) => x[1]));
  return `<ul class="bars">${rows.map(([a, n]) => `<li><span class="bar-l t-mono">${esc(a)}</span><span class="bar"><i style="width:${Math.max(2, (100 * n) / max)}%"></i></span><span class="t-small t-muted bar-n">${n.toLocaleString()}</span></li>`).join('')}</ul>`;
}

function media(im) {
  const ext = String(im.src).split('.').pop().toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm' }[ext];
  const url = /^https?:/.test(im.src) ? im.src : im.abs && fs.existsSync(im.abs) ? `data:${mime};base64,${fs.readFileSync(im.abs).toString('base64')}` : null;
  if (!url) return '';
  return `<figure class="figure panel">${/^video/.test(mime ?? '') ? `<video src="${url}" controls muted loop playsinline></video>` : `<img src="${url}" alt="${esc(im.caption ?? '')}">`}${im.caption ? `<figcaption>${esc(im.caption)}</figcaption>` : ''}</figure>`;
}

export function renderRecapHTML(r, o = {}) {
  const rc = r.rc;
  const s = r.stats;
  const range = rc.since ? `${fmtDay(rc.since)} – ${fmtDay(rc.until ?? day(r.prs.at(-1)?.mergedAt ?? rc.since))}` : '';
  const themeCards = r.themes.map((t) => `<section class="card theme" id="theme-${t.i + 1}" style="--theme:${t.color}">
<header><h2><span class="dot"></span>${esc(t.title)}</h2><p>${t.items.length} PR${t.items.length === 1 ? '' : 's'} · ${counts(t.additions, t.deletions)}</p></header>
<section class="stack">${md(t.body)}${t.outcome ? `<p class="outcome">${esc(t.outcome)}</p>` : ''}${t.diagram?.nodes?.length ? `<div class="theme-vis">${diagramSVG(t.diagram)}</div>` : ''}${t.mermaid ? `<pre class="mermaid">${esc(t.mermaid)}</pre>` : ''}${(t.images ?? []).map(media).join('')}
<ul class="flist">${t.items.map((p) => `<li><a href="${esc(p.url ?? `#pr-${p.number}`)}"><span class="t-muted">#${p.number}</span> <span class="f-name">${esc(p.oneLiner || p.title)}</span></a><span class="f-count">${counts(p.additions, p.deletions)}</span></li>`).join('')}</ul></section></section>`).join('');
  const table = `<div class="table-container"><table class="table"><thead><tr><th>Merged</th><th>PR</th><th>What it did</th><th>Theme</th><th style="text-align:right">Lines</th></tr></thead><tbody>${r.prs.map((p) => {
    const t = r.themes[r.themeOf.get(p.number)];
    return `<tr id="pr-${p.number}"><td class="t-muted t-small" style="white-space:nowrap">${fmtDay(day(p.mergedAt))}</td><td><a href="${esc(p.url ?? '#')}" class="t-mono">#${p.number}</a></td><td><div class="f-name">${esc(p.oneLiner || p.title)}</div>${p.oneLiner ? `<div class="t-small t-muted">${esc(p.title)}</div>` : ''}</td><td>${t ? `<span class="badge" data-variant="outline"><span class="dot" style="--theme:${t.color}"></span>${esc(t.title)}</span>` : ''}</td><td class="t-mono" style="text-align:right;white-space:nowrap">${counts(p.additions, p.deletions)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  const anyMermaid = r.themes.some((t) => t.mermaid);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(rc.title || 'What shipped')}</title>${o.print ? '<meta name="prtour-print" content="1">' : ''}
${FONTS}<style>${CSS}${RECAP_CSS}</style>${THEME}</head><body><main class="page">
<header class="hero stack"><div class="row t-small t-muted">${rc.author ? `<img class="avatar" src="https://github.com/${esc(rc.author)}.png?size=64" alt="" onerror="this.remove()">${esc(rc.author)}<span class="sep">·</span>` : ''}${esc(rc.repo ?? '')}${range ? `<span class="sep">·</span>${range}` : ''}</div><h1 class="t-display">${esc(rc.title || 'What shipped')}</h1>${rc.summary ? `<div class="lede">${md(rc.summary)}</div>` : ''}</header>
<div class="row stats">${ui.stat(s.prs, 'PRs merged')}${ui.stat(r.themes.length, r.themes.length === 1 ? 'theme' : 'themes')}${ui.stat(s.days, 'days with merges')}${ui.stat(`<span class="t-add">+${s.additions.toLocaleString()}</span> <span class="t-del">−${s.deletions.toLocaleString()}</span>`, 'lines')}${(rc.highlights ?? []).map((h) => ui.stat(esc(h.value), esc(h.label))).join('')}</div>
<section class="split viz">${ui.card({ title: 'When it shipped', description: 'Each dot is a PR, sized by lines changed, colored by theme.', body: `${timelineSVG(r)}<div class="legend">${r.themes.map((t) => `<a href="#theme-${t.i + 1}" class="t-small"><span class="dot" style="--theme:${t.color}"></span>${esc(t.title)}</a>`).join('')}</div>` })}${ui.card({ title: 'Where it landed', description: 'Lines changed by area, without tests or generated files.', body: areaBars(r) })}</section>
<section class="themes">${themeCards}</section>
<section class="stack"><h2 class="t-title">Every PR</h2>${table}</section>
<footer class="t-small t-muted no-print" style="margin-top:48px">Made with <a href="https://github.com/2018kguo/prtour">prtour</a></footer>
</main>${anyMermaid ? `<script type="module">try{const{default:m}=await import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs');m.initialize({startOnLoad:false,theme:document.documentElement.classList.contains('dark')?'dark':'neutral'});await m.run({querySelector:'pre.mermaid'})}catch(e){}</script>` : ''}</body></html>`;
}

const RECAP_CSS = `
.hero{gap:14px;padding:56px 0 28px;max-width:860px}.lede{font-size:17px;line-height:1.65}.avatar{width:22px;height:22px;border-radius:999px}
.stats{gap:40px;padding:18px 0;margin-bottom:40px;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.viz{grid-template-columns:minmax(0,7fr) minmax(0,5fr);margin-bottom:56px}
.tl{width:100%;height:auto;display:block;font:11px var(--font-sans)}.tl-axis{stroke:var(--border)}.tl-day{fill:var(--muted-foreground)}.tl-empty{opacity:.45}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:14px}
.dot{display:inline-block;width:9px;height:9px;border-radius:999px;background:var(--theme);margin-right:7px;vertical-align:baseline}
.bars{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:auto 1fr auto;gap:10px 14px;align-items:center}.bars li{display:contents}
.bar{height:10px;border-radius:5px;background:var(--muted);overflow:hidden}.bar>i{display:block;height:100%;background:var(--foreground);opacity:.75;border-radius:5px}.bar-n{text-align:right;font-variant-numeric:tabular-nums}
.themes{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:20px;margin-bottom:64px}
.theme{border-top:3px solid var(--theme)}.theme h2{display:flex;align-items:center}.outcome{font-weight:500;margin:0}
.theme-vis{border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px}
.table td{vertical-align:top}
@media (max-width:960px){.viz{grid-template-columns:minmax(0,1fr)}.themes{grid-template-columns:minmax(0,1fr)}}
@media print{.themes{grid-template-columns:minmax(0,1fr)}.viz{grid-template-columns:minmax(0,1fr)}.theme{break-inside:avoid}}
`;

export function renderRecapMarkdown(r) {
  const rc = r.rc;
  const s = r.stats;
  const out = [`## ${rc.title || 'What shipped'}`, '', `${s.prs} PRs over ${s.days} day${s.days === 1 ? "" : "s"} · +${s.additions} −${s.deletions}`, ''];
  if (rc.summary) out.push([rc.summary].flat().join('\n\n'), '');
  // GitHub renders a mermaid timeline: one section per theme.
  out.push('```mermaid', 'timeline', ...r.themes.flatMap((t) => [`  section ${t.title.replace(/[:#]/g, '')}`, ...t.items.map((p) => `    ${fmtDay(day(p.mergedAt))} : #${p.number} ${(p.oneLiner || p.title).replace(/[:#]/g, '')}`)]), '```', '');
  for (const t of r.themes) {
    out.push(`### ${t.title}`, '');
    if (t.body) out.push(t.body, '');
    if (t.outcome) out.push(`**${t.outcome}**`, '');
    if (t.diagram?.nodes?.length) out.push(diagramMermaid(t.diagram), '');
    out.push(...t.items.map((p) => `- [#${p.number}](${p.url}) ${p.oneLiner || p.title} (+${p.additions} −${p.deletions})`), '');
  }
  return `${out.join('\n').trim()}\n`;
}

export function renderRecapTerminal(r, { color = true, width = 100 } = {}) {
  const c = (code) => (x) => (color ? `\x1b[${code}m${x}\x1b[0m` : String(x));
  const [bold, dim, green, red, yellow] = [c(1), c(2), c(32), c(31), c(33)];
  const tones = [34, 32, 33, 35, 31, 36].map(c);
  const rc = r.rc;
  const s = r.stats;
  const out = [bold(rc.title || 'What shipped'), dim(`${s.prs} PRs · ${s.days} day${s.days === 1 ? "" : "s"} · `) + green(`+${s.additions}`) + ' ' + red(`-${s.deletions}`)];
  if (rc.summary) out.push('', [rc.summary].flat().join('\n\n'));
  for (const w of r.warnings) out.push(yellow(`! ${w}`));
  // Per-day strip: one ● per PR, colored by theme.
  out.push('', bold('When it shipped'));
  for (const d of dayRange(r)) {
    const ps = r.prs.filter((p) => day(p.mergedAt) === d);
    out.push(`  ${dim(fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric' }).padEnd(12))} ${ps.map((p) => tones[(r.themeOf.get(p.number) ?? 5) % 6]('●')).join(' ')}`);
  }
  out.push('  ' + r.themes.map((t, i) => tones[i % 6]('●') + ' ' + t.title).join('   '));
  for (const [i, t] of r.themes.entries()) {
    out.push('', tones[i % 6](bold(`━━ ${t.title} `.padEnd(width, '━'))), dim(`${t.items.length} PRs · +${t.additions} -${t.deletions}`));
    if (t.body) out.push(t.body);
    if (t.outcome) out.push(bold(t.outcome));
    if (t.diagram?.nodes?.length) out.push(...diagramTree(t.diagram, { add: green, dim, chg: yellow }).map((l) => `  ${l}`));
    for (const p of t.items) out.push(`  ${dim(`#${p.number}`)} ${p.oneLiner || p.title} ${dim(`+${p.additions} -${p.deletions}`)}`);
  }
  return `${out.join('\n')}\n`;
}
