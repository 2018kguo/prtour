// Recap: what shipped across many PRs and days, written for humans. Three
// kinds of workstream: problems people had that are now fixed, new things to
// demo, and things that got measurably better. Each leads with what people
// saw, explains why in plain words, shows the result, and keeps the
// engineering detail one click away.
//
// Design rules (from common critiques of generated UI): one type family, no
// labels above headings, no icon tiles, no colored card borders, no identical
// card grids, no hero-metric strips, no nested cards, nothing under 14px.
import fs from 'node:fs';
import { lint, stripCode } from './style.mjs';
import { TOGGLE_CSS, TOGGLE_JS, checkDiagram, diagramMermaid, diagramToggle, diagramTree } from './diagram.mjs';
import { CSS, THEME, counts, esc } from './ui.mjs';
import { md, sharedTail, snippetHTML, snippetState } from './html.mjs';
import { kindOf } from './tour.mjs';
import { ICON_CSS, iconHTML } from './icons.mjs';
import { sliceHunk, splitPatch } from './patch.mjs';
import { dataUrl, isVideo, posterOf } from './media.mjs';

export const RECAP_BUDGET = { workstreams: 12 };
const PALETTE = ['oklch(55% .15 155)', 'oklch(55% .17 255)', 'oklch(66% .15 65)', 'oklch(53% .19 293)', 'oklch(57% .19 22)', 'oklch(58% .11 210)', 'oklch(52% .09 125)', 'oklch(50% .14 330)', 'oklch(62% .13 40)', 'oklch(48% .05 260)', 'oklch(60% .12 180)', 'oklch(55% .12 90)'];
const KINDS = { fix: 'Fixes', feature: 'New features', improvement: 'Improvements' };
const kindOfWs = (w) => (w.kind === 'feature' || w.kind === 'improvement' ? w.kind : 'fix');

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

const spanOf = (items) => {
  const ds = items.map((p) => day(p.mergedAt)).filter(Boolean).sort();
  if (!ds.length) return '';
  const a = fmtDay(ds[0]), b = fmtDay(ds.at(-1));
  return a === b ? a : `${a} to ${b}`;
};

export function scaffoldRecap(prs, meta) {
  return {
    kind: 'recap', ...meta, about: '', summary: '', hero: { stories: [], tldr: [] }, glossary: [], dayNotes: {}, lanes: {},
    workstreams: [{ kind: 'fix', label: 'TODO(agent)', headline: 'Group PRs by outcome', symptom: '', now: '', media: [], prs: prs.map((p) => p.number) }],
    prs: prs.map((p) => ({ number: p.number, title: p.title, url: p.url, author: p.author?.login, createdAt: p.createdAt, mergedAt: p.mergedAt,
      additions: p.additions, deletions: p.deletions, files: p.changedFiles, area: areaOf(p.files), oneLiner: '', description: (p.body ?? '').slice(0, 1500) })),
  };
}

const TEXT_FIELDS = [['title', 90], ['name', 40], ['asked', 260], ['symptom', 200], ['howBad', 240], ['now', 220], ['explain', 700], ['before', 900], ['designCall', 500], ['proof', 900], ['trade', 500], ['triedFirst', 420]];

// A headline or label that only names an area ("Chat runtime", "Bug fixes")
// says nothing happened. It is flagged only when its last word is a known
// category noun and nothing else in it (a digit or an outcome word) says what
// changed. Words that could be verbs ("renders", "landed") never count, and
// titles in a non-Latin script are left alone.
const CATEGORY = new Set('performance improvement improvements fix fixes bugfixes update updates refactor refactors refactoring infra infrastructure runtime misc miscellaneous cleanup cleanups chore chores maintenance enterprise platform tooling internals dependencies polish tweaks stuff accessibility billing authentication layout migrations pipeline housekeeping work'.split(' '));
const OUTCOME = /\d|\b(?:faster|slower|smaller|cheaper|fewer|exact(?:ly)?|instant(?:ly)?|now|no longer|never|again|zero|half|twice|fixed|gone|safer)\b/i;
export function categoryOnly(title) {
  const t = stripCode(title).trim();
  if (!t || /[^\p{Script=Latin}\p{N}\p{P}\p{S}\p{Z}\p{M}]/u.test(t.replace(/\s/g, ''))) return false;
  if (OUTCOME.test(t)) return false;
  return CATEGORY.has(t.toLowerCase().match(/[\p{L}']+/gu)?.at(-1) ?? '');
}

// Names a newcomer can't know: anything in backticks, @scope/packages,
// camelCase, SCREAMING_CASE, file names, and kebab-case words with a digit or
// three or more parts ("text-gray-500", "lite-index-v2"). Plain English
// compounds pass ("open-source", "two-factor", "state-of-the-art"), as do URLs,
// domains and email addresses.
const BRANDS = new Set(['iOS', 'iPadOS', 'macOS', 'watchOS', 'tvOS', 'visionOS', 'iPhone', 'iPad', 'iCloud', 'iMac', 'eBay', 'iTunes']);
const LINKING = /-(?:of|to|by|the|and|or|in|on|a|an|for|over|per|vs)-/;
const FILE = /^[\w-]+\.(?:ya?ml|json|toml|[cm]?js|tsx?|jsx|py|go|rs|rb|java|kt|swift|cpp|md|sh|sql|lock|env|ini|cfg|conf|xml|csv)$/;
export function codeTerms(text) {
  const out = new Set();
  const t = String(text ?? '').replace(/https?:\/\/\S+|\S+@\S+\.\w+|\b[\w-]+(?:\.[\w-]+)+\/\S*/g, ' ');
  for (const m of t.matchAll(/`([^`]+)`|(@[a-z0-9][\w.-]*\/[\w.-]*\w)|([\w.@/-]+)/gi)) {
    if (m[1]) { if (/^[@\w./:-]+$/.test(m[1]) && /\p{L}/u.test(m[1])) out.add(m[1]); continue; }
    if (m[2]) { out.add(m[2]); continue; }
    const w = m[3].replace(/^[^\w@]+|[^\w]+$/g, '');
    if (/^[a-z][a-z0-9]*[A-Z]\w*$/.test(w) && !BRANDS.has(w)) out.add(w);
    else if (/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(w)) out.add(w);
    else if (FILE.test(w)) out.add(w);
    else if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(w) && (/\d/.test(w) || (w.split('-').length >= 3 && !LINKING.test(`-${w}-`)))) out.add(w);
  }
  return [...out];
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function resolveRecap(rc) {
  const warnings = [];
  // Release-post advice (titles, glossary, hero, media, share links) never fails `check`.
  const suggestions = [];
  const prs = (rc.prs ?? []).slice().sort((a, b) => String(a.mergedAt).localeCompare(String(b.mergedAt)));
  const byNum = new Map(prs.map((p) => [p.number, p]));
  const wsOf = new Map();
  // `headline`/`label`/`media` are the names to write; `title`/`name`/`images` still work.
  const listed = (rc.workstreams ?? rc.themes ?? []).map((w) => ({ ...w, title: w.headline ?? w.title, name: w.label ?? w.name ?? w.headline ?? w.title, media: [...(w.media ?? []), ...(w.images ?? [])] }));
  const find = (key) => listed.find((w) => [w.name, w.label, w.title].includes(key));
  const top = (rc.hero?.stories ?? []).map((s) => ({ ...s, ws: find(s.workstream) }));
  for (const s of top) if (s.workstream && !s.ws) suggestions.push(`hero story "${s.headline ?? s.workstream}": no workstream labelled "${s.workstream}"`);
  // The lead story's kind goes first, so the biggest story leads even when it's an improvement; `order` overrides.
  const kinds = [...new Set([...(rc.order ?? []), ...(top[0]?.ws ? [kindOfWs(top[0].ws)] : []), 'fix', 'feature', 'improvement'])].filter((k) => KINDS[k]);
  const rank = (w) => { const i = top.findIndex((s) => s.ws === w); return i < 0 ? top.length : i; };
  const ordered = kinds.flatMap((k) => listed.filter((w) => kindOfWs(w) === k).map((w, j) => [w, j]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([w]) => w));
  const ws = ordered.map((w, i) => {
    for (const n of w.prs ?? []) {
      if (!byNum.has(n)) warnings.push(`workstream "${w.name ?? w.title}": #${n} is not in prs`);
      else if (wsOf.has(n)) warnings.push(`#${n} is in two workstreams`);
      else wsOf.set(n, i);
    }
    const items = (w.prs ?? []).map((n) => byNum.get(n)).filter(Boolean);
    return { ...w, kind: kindOfWs(w), name: w.name ?? w.title, i, color: PALETTE[i % PALETTE.length], items, additions: items.reduce((s, p) => s + p.additions, 0), deletions: items.reduce((s, p) => s + p.deletions, 0) };
  });
  const rest = prs.filter((p) => !wsOf.has(p.number));
  // Top stories: headline and why default to their workstream's headline and "now"; media to its first.
  const stories = top.map((s) => { const w = ws.find((x) => x.title === s.ws?.title && x.name === s.ws?.name); return { ...s, ws: w, headline: s.headline ?? w?.title ?? '', why: s.why ?? w?.now, media: s.media ?? (w?.media.length ? [w.media[0]] : []) }; });
  const glossary = (rc.glossary ?? []).filter((g) => g?.term).map((g) => ({ ...g, id: `g-${slug(g.term)}` }));
  if (rest.length && !rc.otherPrs) warnings.push(`${rest.length} PR(s) in no workstream: ${rest.slice(0, 20).map((p) => `#${p.number}`).join(', ')}${rest.length > 20 ? '…' : ''}. Place them, or set "otherPrs": "<one line on what they are>"`);
  if (ws.length > RECAP_BUDGET.workstreams) warnings.push(`${ws.length} workstreams (budget ${RECAP_BUDGET.workstreams}); merge related work`);
  const texts = [['summary', [rc.summary ?? ''].flat().join('\n\n'), 700],
    ...ws.flatMap((w) => [...TEXT_FIELDS.map(([k, max]) => [`"${w.name}" ${k}`, w[k], max]),
      ...(w.wins ?? []).map((x) => [`"${w.name}" win`, typeof x === 'string' ? x : x.text, 170]),
      ...[w.demo ?? []].flat().map((d) => [`"${w.name}" demo`, d, 200]),
      ...(w.details ?? w.sections ?? []).flatMap((x) => [[`"${w.name}" detail title`, x.title, 80], [`"${w.name}" detail "${x.title}"`, x.body, 600]]),
      ...(w.diffs ?? []).map((x) => [`"${w.name}" diff caption`, x.caption, 240]),
      ...[w.timeline, w.chart, w.diagram].filter(Boolean).map((v) => [`"${w.name}" visual caption`, v.caption, 200])]),
    ...prs.map((p) => [`#${p.number} oneLiner`, p.oneLiner, 160]),
    ['about', rc.about, 240],
    ...stories.flatMap((s) => [[`top story "${s.headline}" headline`, s.headline, 90], [`top story "${s.headline}" why`, s.why, 200], ...s.media.map((m) => [`top story "${s.headline}" caption`, m.caption, 200])]),
    ...(rc.hero?.tldr ?? []).map((x) => ['tldr', x, 160]),
    ...glossary.flatMap((g) => [[`glossary "${g.term}" what`, g.what, 200], [`glossary "${g.term}" why`, g.why, 220]]),
    ...ws.flatMap((w) => w.media.map((m) => [`"${w.name}" media caption`, m.caption, 200]))];
  for (const [where, text, max] of texts) {
    for (const hit of lint(text)) warnings.push(`writing, ${where}: ${hit}`);
    if (stripCode(text).length > max) warnings.push(`writing, ${where}: ${stripCode(text).length} chars (max ${max}); say less`);
  }
  // Release-post checks: an opening for newcomers, headlines that say what happened, a short hero, named pieces explained.
  if (rc.url) { try { new URL(rc.url); } catch { suggestions.push(`url "${rc.url}" is not an absolute link (https://…); share tags and the thread skip it`); } }
  else if (stories.length) suggestions.push('no "url": say where the page will be hosted, so share cards get an absolute image and the thread ends with the link');
  if (!rc.about) suggestions.push('no "about": say in one sentence what the product is, for a reader who has never heard of it');
  if (stories.length > 4) suggestions.push(`hero: ${stories.length} top stories; keep the 2 to 4 biggest, or the hero stops being a hero`);
  if (stories.length && !(rc.hero?.tldr ?? []).length) suggestions.push('hero: no "tldr"; give 2 to 4 short bullets that cover the top stories');
  if ((rc.hero?.tldr ?? []).length > 4) suggestions.push(`hero: ${rc.hero.tldr.length} TL;DR bullets; keep it to 4 at most`);
  for (const s of stories) {
    if (!s.why) suggestions.push(`top story "${s.headline}": no "why" (one line on why it matters)`);
    if (!s.media.length && !s.ws?.chart?.points?.length && !s.ws?.timeline?.rows?.length) suggestions.push(`top story "${s.headline}": no visual; add "media" (a screenshot or a short clip) to it or its workstream, or give the workstream a chart or timeline`);
  }
  for (const w of ws) {
    const cat = [['label', w.name], ['headline', w.title]].find(([, x]) => categoryOnly(x));
    if (cat) suggestions.push(`"${w.name}" ${cat[0]} "${cat[1]}" only names an area; say what happened ("PDFs open 5× faster", "Bug fixes" becomes "Crash on upload fixed")`);
    if ((w.name ?? '').split(/\s+/).length > 4) suggestions.push(`"${w.name}" label: ${(w.name ?? '').split(/\s+/).length} words; the nav label is 2 to 4`);
  }
  const known = new Set(glossary.map((g) => g.term.toLowerCase()));
  const named = new Map();
  for (const [where, text] of [['title', rc.title], ['about', rc.about], ['summary', [rc.summary ?? ''].flat().join(' ')], ...stories.flatMap((s) => [[`top story "${s.headline}"`, `${s.headline} ${s.why ?? ''}`]]), ...(rc.hero?.tldr ?? []).map((x) => ['tldr', x]), ...ws.map((w) => [`"${w.name}" headline`, `${w.title ?? ''} ${w.name ?? ''}`])]) {
    for (const t of codeTerms(text)) if (!known.has(t.toLowerCase()) && !named.has(t)) named.set(t, where);
  }
  for (const [t, where] of named) suggestions.push(`${where}: "${t}" looks like a code or package name a newcomer won't know; add it to "glossary" ({"term", "what", "why"}) or say it in plain words`);
  const unnamed = [...new Set(prs.map((p) => p.lane).filter((l) => l && !rc.lanes?.[l]))];
  if (unnamed.length) suggestions.push(`lanes: ${unnamed.length} lane(s) with no readable name in "lanes" (${unnamed.slice(0, 3).map((l) => `"${l}"`).join(', ')}${unnamed.length > 3 ? '…' : ''}); they show as raw ids`);
  for (const w of ws) if (crowded(w.chart)) suggestions.push(`"${w.name}" chart: ${w.chart.points.length} bars with labels up to ${Math.max(...w.chart.points.map((p) => String(p.label ?? p.x).length))} characters overlap, so they are drawn at an angle; shorter labels read better`);
  for (const g of glossary) if (!g.what) suggestions.push(`glossary "${g.term}": no "what" (one plain sentence on what it is)`);
  for (const w of ws) {
    if (!w.items.length) warnings.push(`"${w.name}": no PRs; list them in "prs"`);
    if (w.kind === 'feature' && !w.demo) warnings.push(`"${w.name}": a feature needs "demo": how to show it, in 1 to 4 steps`);
    if (w.kind !== 'feature' && !w.symptom) warnings.push(`"${w.name}": no symptom. Say what a user or engineer actually saw before, in plain words`);
    if (w.kind !== 'feature' && w.title && !/\d/.test(w.title)) warnings.push(`"${w.name}" title: no number. Write it like a newspaper headline: what changed and by how much`);
    const visuals = [w.timeline, w.chart, w.diagram, w.mermaid, w.steps, w.compare, ...w.media].filter(Boolean).length;
    if (visuals > 3) warnings.push(`"${w.name}": ${visuals} visuals; keep the two or three that explain the most`);
    for (const d of w.diffs ?? []) if (d.lines && (d.lines[1] ?? d.lines[0]) - d.lines[0] + 1 > 16) warnings.push(`"${w.name}" diff ${d.file}: ${d.lines[1] - d.lines[0] + 1} lines; show at most 16, the ones that carry the idea`);
    if ((w.diffs ?? []).length > 2) warnings.push(`"${w.name}": ${w.diffs.length} diffs; show at most 2, the ones that carry the idea`);
    warnings.push(...checkDiagram(w.diagram, 0).filter((x) => !x.includes('chapter')).map((x) => `"${w.name}" ${x}`));
  }
  const days = [...new Set(prs.map((p) => day(p.mergedAt)))];
  const stats = { prs: prs.length, additions: prs.reduce((s, p) => s + p.additions, 0), deletions: prs.reduce((s, p) => s + p.deletions, 0), days: days.length };
  return { rc, prs, ws, themes: ws, wsOf, themeOf: wsOf, rest, warnings, suggestions, stats, stories, glossary };
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

// "#123" in prose becomes a quiet link to the PR.
const prUrl = (rc, n) => (rc.repo ? `https://github.com/${esc(rc.repo)}/pull/${n}` : `#pr-${n}`);
// A PR number as a link, or as plain text when the recap is "private" (a public post about a private repo).
const prRef = (rc, n, href = prUrl(rc, n)) => (rc.private ? `<span class="pr">#${n}</span>` : `<a class="pr" href="${href}">#${n}</a>`);
// Short numbers ("#9") link only when they are PRs in this recap, so "#1 cause" stays text.
const prLinks = (html, rc) => html.replace(/(^|[^\w/&])#(\d{1,6})\b/g, (m, pre, n) => (n.length >= 3 || (rc.prs ?? []).some((p) => p.number === Number(n)) ? `${pre}${prRef(rc, n)}` : m));
// Per-render state, keyed by the recap: print mode, and which glossary terms have been linked.
const CTX = new WeakMap();
// The first use of each glossary term links to its entry, with the definition on hover.
// Only text outside tags and links is touched; `term` in code is wrapped whole.
export function linkTerms(html, ctx) {
  for (const g of ctx?.glossary ?? []) {
    if (ctx.seen.has(g.id)) continue;
    const parts = html.split(/(<[^>]+>)/);
    const word = new RegExp(`(^|[^\\w@/-])(${esc(g.term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\w-])`, 'i');
    const a = (x) => `<a class="term" href="#${g.id}" title="${esc(g.what ?? '')}">${x}</a>`;
    let inA = 0;
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i];
      if (t.startsWith('<')) { if (/^<a[\s>]/.test(t)) inA++; else if (t === '</a>') inA--; continue; }
      if (inA || !t) continue;
      if (parts[i - 1] === '<code>' && parts[i + 1] === '</code>') {
        if (t.toLowerCase() !== esc(g.term).toLowerCase()) continue;
        parts[i - 1] = `<a class="term" href="#${g.id}" title="${esc(g.what ?? '')}"><code>`;
        parts[i + 1] = '</code></a>';
      } else {
        const m = t.match(word);
        if (!m) continue;
        parts[i] = t.slice(0, m.index + m[1].length) + a(m[2]) + t.slice(m.index + m[0].length);
      }
      ctx.seen.add(g.id);
      break;
    }
    html = parts.join('');
  }
  return html;
}
const prose = (text, rc) => linkTerms(prLinks(md(text), rc), CTX.get(rc));
const inline = (text, rc) => linkTerms(prLinks(md(text).replace(/^<p>|<\/p>$/g, ''), rc), CTX.get(rc));
// Inline Markdown without PR links, for text that already sits inside a link.
const plain = (text) => md(text ?? '').replace(/^<p>|<\/p>$/g, '');
// Text with Markdown and PR numbers stripped, for meta tags and posts.
const stripMd = (t) => String(t ?? '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s*\((?:#\d+(?:,\s*)?)+\)/g, '').replace(/\s+/g, ' ').trim();
const refs = (rc, prs) => ((prs ?? []).length ? ` <span class="refs">${prs.map((n) => prRef(rc, n)).join(', ')}</span>` : '');

// ---- visuals ---------------------------------------------------------------

// A timeline explainer: rows of activity over a few seconds, Before and After.
// It shows what one thread doing CPU work means for everyone waiting on it.
// `compact` draws it narrower, so its text stays readable inside a top-story card.
function timelineHTML(t, rc, compact = false) {
  if (!t?.rows?.length) return '';
  const len = t.length ?? Math.max(...[...(t.before ?? []), ...(t.after ?? [])].map((b) => b.to), 1);
  const L = 150;
  const W = compact ? 520 : 760;
  const RH = 40;
  const H = t.rows.length * RH + 34;
  const X = (s) => L + (s / len) * (W - L - 16);
  const block = (b) => `<g class="tl-b tl-${esc(b.kind ?? 'busy')}"><rect x="${X(b.from).toFixed(1)}" y="${b.row * RH + 10}" width="${Math.max(2, X(b.to) - X(b.from)).toFixed(1)}" height="${RH - 18}" rx="4"/>${b.label && X(b.to) - X(b.from) > b.label.length * 7 + 10 ? `<text x="${(X(b.from) + 8).toFixed(1)}" y="${b.row * RH + 26}">${esc(b.label)}</text>` : ''}<title>${esc(b.label ?? b.kind ?? '')}: ${b.from}–${b.to} ${esc(t.unit ?? 's')}</title></g>`;
  // Round tick steps (1, 2, 5 × 10^k), about ten across.
  const raw = len / 10;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? mag * 10;
  const ticks = Array.from({ length: Math.floor(len / step) + 1 }, (_, i) => i * step).map((v) => `<text x="${X(v).toFixed(1)}" y="${H - 6}" class="tl-tick" text-anchor="middle">${v}</text>`).join('');
  const rows = t.rows.map((name, i) => `<text x="0" y="${i * RH + 27}" class="tl-row">${esc(name)}</text><line x1="${L}" x2="${W - 16}" y1="${i * RH + RH - 4}" y2="${i * RH + RH - 4}" class="tl-grid"/>`).join('');
  const svg = (view, blocks) => `<div class="tl-view tl-${view}"><p class="tl-label">${view === 'before' ? 'Before' : 'After'}</p><svg class="chart" viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}" role="img" aria-label="${esc(`${t.caption ?? 'Timeline'} (${view})`)}">${rows}${(blocks ?? []).map(block).join('')}${ticks}<text x="0" y="${H - 6}" class="tl-tick">${esc(t.unit ?? 'seconds')}</text><line class="tl-head" x1="${L}" x2="${L}" y1="4" y2="${H - 22}"/></svg></div>`;
  return `<figure class="fig tlx" data-view="before"><div class="fig-bar"><div class="seg" role="tablist"><button type="button" data-tlv="before" aria-selected="true">Before</button><button type="button" data-tlv="after" aria-selected="false">After</button></div><button type="button" class="play" data-play>Play</button></div>
${svg('before', t.before)}${svg('after', t.after)}
${t.caption ? `<figcaption>${inline(t.caption, rc)}</figcaption>` : ''}</figure>`;
}

// x labels collide when the widest one (about 6.2 px a character at 14 px) is wider than its slot.
export function crowded(c, W = 760) {
  const pts = c?.points ?? [];
  if (!pts.length) return false;
  const L = W < 760 ? 64 : 76;
  const every = Math.ceil(pts.length / 8);
  return Math.max(...pts.map((p) => String(p.label ?? p.x).length)) * 6.2 > ((W - L - 10) / pts.length) * every - 6;
}

// Bars (or a line) over time with marks for deploys; hover shows the value.
function chartHTML(c, rc, compact = false) {
  const pts = c?.points ?? [];
  if (!pts.length) return '';
  const W = compact ? 440 : 760;
  const L = compact ? 64 : 76;
  const longest = Math.max(...pts.map((p) => String(p.label ?? p.x).length));
  const B = crowded(c, W) ? Math.min(140, 30 + longest * 6.2 * 0.58) : 34;
  const H = (compact ? 230 : 260) + B - 34;
  const max = c.yMax ?? Math.max(...pts.map((p) => p.y), 1) * 1.1;
  const bw = (W - L - 10) / pts.length;
  const Y = (v) => H - B - (v / max) * (H - B - 16);
  const idx = new Map(pts.map((p, i) => [p.x, i]));
  const bars = pts.map((p, i) => `<g class="ch-pt" tabindex="0"><rect x="${(L + i * bw + bw * 0.15).toFixed(1)}" y="${Y(p.y).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(H - B - Y(p.y)).toFixed(1)}" rx="2" class="${p.hi ? 'ch-hi' : ''}"/><rect x="${(L + i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H - B}" class="ch-hit"/>${pts.length <= 12 ? `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${(Y(p.y) - 7).toFixed(1)}" text-anchor="middle" class="ch-v">${esc(p.y.toLocaleString('en-US'))}${esc(c.unit ?? '')}</text>` : ''}<title>${esc(p.x)}: ${p.y}${esc(c.unit ?? '')}${p.note ? ` · ${esc(p.note)}` : ''}</title></g>`).join('');
  const every = Math.ceil(pts.length / 8);
  // Labels too wide for their slot are drawn at an angle, with room below for them.
  const tilt = crowded(c, W);
  const xl = pts.map((p, i) => (i % every !== 0 ? '' : tilt ? `<text transform="translate(${(L + i * bw + bw / 2).toFixed(1)} ${H - B + 16}) rotate(-35)" text-anchor="end" class="ch-x">${esc(p.label ?? p.x)}</text>` : `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="ch-x">${esc(p.label ?? p.x)}</text>`)).join('');
  const yt = [0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - 10}" y1="${Y(max * f / 1.1).toFixed(1)}" y2="${Y(max * f / 1.1).toFixed(1)}" class="ch-grid"/><text x="${L - 8}" y="${(Y(max * f / 1.1) + 4).toFixed(1)}" text-anchor="end" class="ch-x">${Math.round((max * f) / 1.1)}${esc(c.unit ?? '')}</text>`).join('');
  const marks = (c.marks ?? []).filter((m) => idx.has(m.x)).map((m, k) => { const x = L + idx.get(m.x) * bw + bw / 2; const right = x > W - (compact ? 120 : 170); return `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="10" y2="${H - B}" class="ch-mark"/><text x="${(x + (right ? -5 : 5)).toFixed(1)}" y="${18 + (k % 3) * 17}" text-anchor="${right ? 'end' : 'start'}" class="ch-mark-t">${esc(m.label)}</text>`; }).join('');
  return `<figure class="fig"><div class="ch-read" aria-live="polite">${esc(c.title ?? '')}</div><svg class="chart" viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}" role="img" aria-label="${esc(c.caption ?? c.title ?? 'Chart')}">${yt}${bars}${marks}${xl}</svg>${c.caption ? `<figcaption>${inline(c.caption, rc)}</figcaption>` : ''}</figure>`;
}

// Screenshots and clips, embedded. A clip plays muted and looped while on screen (click
// pauses it); with reduced motion it waits for a click. The PDF shows its poster frame.
// Stills under SHARE_MIN are embedded at every use, so the page shows them with
// scripts off. Clips and large files are embedded once: the first use carries
// the data URI and `data-m-<attr>`, later uses carry `data-same-<attr>`, which
// SAME_JS fills on load (Chrome runs it when printing too), plus a <noscript>
// link to the first copy.
const SHARE_MIN = 500e3;
function embed(rc, attr, abs, src) {
  if (/^https?:/.test(src ?? '')) return { attrs: ` ${attr}="${esc(src)}"` };
  const ctx = CTX.get(rc);
  const shared = ctx && abs && (isVideo(src) || (fs.existsSync(abs) && fs.statSync(abs).size >= SHARE_MIN));
  if (shared && ctx.media.has(abs)) return { attrs: ` data-same-${attr}="${ctx.media.get(abs)}"`, same: ctx.media.get(abs) };
  const url = dataUrl(abs, src);
  if (!url) return null;
  if (!shared) return { attrs: ` ${attr}="${url}"` };
  ctx.media.set(abs, `m${ctx.media.size + 1}`);
  return { attrs: ` ${attr}="${url}" data-m-${attr}="${ctx.media.get(abs)}"`, first: ctx.media.get(abs) };
}
const SAME_JS = `<script>document.querySelectorAll('[data-same-src],[data-same-poster]').forEach(e=>['src','poster'].forEach(a=>{const id=e.getAttribute('data-same-'+a);if(!id)return;const s=document.querySelector('[data-m-src="'+id+'"]'),p=s?null:document.querySelector('[data-m-poster="'+id+'"]');const u=s?s.getAttribute('src'):p&&p.getAttribute('poster');if(u)e.setAttribute(a,u)}))</script>`;

function figure(im, rc, cls = 'fig') {
  const cap = im.caption ? `<figcaption>${inline(im.caption, rc)}</figcaption>` : '';
  const wrap = (el, ...parts) => {
    const first = parts.find((x) => x?.first)?.first;
    const same = parts.find((x) => x?.same)?.same;
    return `<figure class="${cls}"${first ? ` id="media-${first}"` : ''}>${el}${same ? `<noscript><a href="#media-${same}">See it where it first appears</a></noscript>` : ''}${cap}</figure>`;
  };
  if (!isVideo(im.src)) {
    const src = embed(rc, 'src', im.abs, im.src);
    return src ? wrap(`<img class="zoomable"${src.attrs} alt="${esc(im.alt ?? im.caption ?? '')}">`, src) : '';
  }
  const remote = /^https?:/.test(posterOf(im) ?? '') ? posterOf(im) : null;
  const poster = (attr) => (im.posterAbs ? embed(rc, attr, im.posterAbs, im.posterAbs) : remote ? { attrs: ` ${attr}="${esc(remote)}"` } : null);
  if (CTX.get(rc)?.print) { const p = poster('src'); return p ? wrap(`<img${p.attrs} alt="${esc(im.caption ?? '')}">`, p) : ''; }
  const src = embed(rc, 'src', im.abs, im.src);
  const p = poster('poster');
  // autoplay keeps clips playing with scripts off; CLIENT_JS pauses them off screen or under reduced motion.
  return src ? wrap(`<video${src.attrs}${p?.attrs ?? ''} muted autoplay loop playsinline preload="metadata" data-clip aria-label="${esc(im.caption ?? 'Clip')}"></video>`, src, p) : '';
}

function stepsHTML(st, rc) {
  const items = st?.items ?? [];
  if (!items.length) return '';
  return `<figure class="fig"><ol class="steps">${items.map((x) => `<li><b>${esc(x.title)}</b> ${inline(x.body ?? '', rc)}</li>`).join('')}</ol>${st.caption ? `<figcaption>${inline(st.caption, rc)}</figcaption>` : ''}</figure>`;
}

function resultsTable(t, rc) {
  if (!t?.rows?.length) return '';
  const cols = t.columns ?? [];
  const head = cols.length || t.caption ? `<thead><tr>${(cols.length ? cols : t.rows[0].map(() => '')).map((c, i) => `<th${i ? ' class="num"' : ''}>${i === 0 && t.caption ? esc(t.caption) : esc(c)}</th>`).join('')}</tr></thead>` : '';
  return `<div class="results"><table>${head}<tbody>${t.rows.map((row) => `<tr>${row.map((c, i) => `<td${i ? ' class="num"' : ''}>${prLinks(esc(c), rc)}</td>`).join('')}</tr>`).join('')}</tbody></table>${t.note ? `<p class="note">${prLinks(esc(t.note), rc)}</p>` : ''}</div>`;
}

// A targeted diff: one file, a few lines, from the PR that made the change.
async function diffSnippet(d, r, state) {
  const files = r.patches?.get(d.pr);
  if (!files) return '';
  const f = files.find((x) => x.name === d.file) ?? files.find((x) => x.name.endsWith(`/${d.file}`) || x.name.endsWith(d.file));
  if (!f) return '';
  let file = f;
  if (d.lines) {
    const [a, b] = d.lines;
    const cut = f.hunks.flatMap((h) => { const x = sliceHunk(h, a, b ?? a); return x ? [x] : []; });
    if (!cut.length) return '';
    file = { ...f, hunks: cut };
  } else if (d.hunk != null) file = { ...f, hunks: [f.hunks[d.hunk]].filter(Boolean) };
  else file = { ...f, hunks: f.hunks.slice(0, 1) };
  const html = await snippetHTML(file, null, state);
  return `<figure class="fig diff">${d.caption ? `<p class="diff-cap">${inline(d.caption, r.rc)}${refs(r.rc, [d.pr])}</p>` : ''}${html}</figure>`;
}

// ---- page ------------------------------------------------------------------

async function section(w, r, state) {
  const rc = r.rc;
  const ic = w.icon && r.icons?.has(w.icon) ? iconHTML(r.icons, w.icon) : '';
  const wins = (w.wins ?? []).map((x) => (typeof x === 'string' ? { text: x } : x));
  const visuals = [timelineHTML(w.timeline, rc), chartHTML(w.chart, rc),
    w.diagram?.nodes?.length ? `<figure class="fig">${diagramToggle(w.diagram, () => '#', r.icons)}${w.diagram.caption ? `<figcaption>${inline(w.diagram.caption, rc)}</figcaption>` : ''}</figure>` : '',
    w.mermaid ? `<figure class="fig"><pre class="mermaid">${esc(w.mermaid)}</pre></figure>` : '', stepsHTML(w.steps, rc), ...w.media.map((im) => figure(im, rc))].filter(Boolean);
  const diffs = [];
  for (const d of (w.diffs ?? []).slice(0, 2)) diffs.push(await diffSnippet(d, r, state));
  const beforeLabel = w.kind === 'feature' ? 'Before' : w.kind === 'improvement' ? 'Before' : 'What people saw';
  const nowLabel = w.kind === 'feature' ? 'Now you can' : 'Now';
  const detailItems = [...(w.details ?? w.sections ?? []).map((x) => `<div class="dt"><p><b>${esc(x.title)}.</b> ${inline(x.body ?? '', rc)}${refs(rc, x.prs)}</p>${resultsTable(x.results, rc)}</div>`),
    w.before ? `<div class="dt">${prose(w.before, rc)}</div>` : '', resultsTable(w.results, rc), w.proof ? `<div class="dt">${prose(w.proof, rc)}</div>` : '',
    w.trade ? `<div class="dt"><p><b>The trade.</b> ${inline(w.trade, rc)}</p></div>` : ''].filter(Boolean).join('');
  return `<section class="ws" id="ws-${w.i + 1}" style="--ws:${w.color}">
<h2 class="ws-title">${ic}${esc(w.title ?? w.name)}</h2>
${w.items.length ? `<p class="ws-meta">${w.items.length} PR${w.items.length === 1 ? '' : 's'}, merged ${spanOf(w.items)}${w.asked ? `. ${rc.askedBy ? `${esc(rc.askedBy)} asked for` : 'Asked for'}: ${esc(w.asked)}` : ''}</p>` : ''}
<div class="pair"><div><h3>${beforeLabel}</h3><p class="pair-lead">${inline(w.symptom ?? '', rc)}</p>${w.howBad ? `<p>${inline(w.howBad, rc)}</p>` : ''}</div><div><h3 class="now">${nowLabel}</h3><p class="pair-lead">${inline(w.now ?? w.whyItMatters ?? '', rc)}</p></div></div>
${w.explain ? `<h3>${w.kind === 'feature' ? 'How it works' : 'Why it happened'}</h3>${prose(w.explain, rc)}` : ''}
${visuals[0] ?? ''}
${wins.length ? `<h3>${w.kind === 'feature' ? 'What it does' : 'What changed'}</h3><ul class="wins">${wins.map((x) => `<li>${inline(x.text, rc)}${refs(rc, x.prs)}</li>`).join('')}</ul>` : ''}
${w.demo ? `<h3>Show it</h3><ol class="demo">${[w.demo].flat().map((x) => `<li>${inline(x, rc)}</li>`).join('')}</ol>` : ''}
${visuals.slice(1).join('\n')}
${diffs.filter(Boolean).length ? `<h3>The change, in code</h3>${diffs.join('')}` : ''}
${w.designCall ? `<h3>The idea that made it work</h3>${prose(w.designCall, rc)}` : ''}
${w.triedFirst ? `<h3>What we tried first</h3>${prose(w.triedFirst, rc)}` : ''}
${detailItems ? `<details class="more"><summary>Engineering details</summary><div class="more-body">${detailItems}</div></details>` : ''}
${w.items.length ? `<details class="more prs-more"><summary>${w.items.length === 1 ? 'The PR' : `All ${w.items.length} PRs`}</summary><ul class="prlist">${w.items.map((p) => `<li>${prRef(rc, p.number, esc(p.url ?? '#'))} ${esc(p.oneLiner || p.title)}</li>`).join('')}</ul></details>` : ''}
</section>`;
}

// Bars per day, stacked by workstream.
function perDayChart(r) {
  const days = dayKeys(r);
  const per = days.map((d) => r.prs.filter((p) => day(p.mergedAt) === d));
  const max = Math.max(1, ...per.map((x) => x.length));
  const colW = Math.min(110, Math.max(44, 760 / days.length));
  const W = days.length * colW;
  const H = 220;
  const plot = H - 46;
  const bars = per.map((ps, i) => {
    let y = plot;
    const x0 = i * colW + colW * 0.2;
    const bw = (colW * 0.6).toFixed(1);
    const seg = (n, fill, extra = '') => { if (!n) return ''; const h = (n / max) * (plot - 26); y -= h; return `<rect x="${x0}" y="${y.toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" fill="${fill}"${extra}/>`; };
    const segs = r.ws.map((w) => seg(ps.filter((p) => r.wsOf.get(p.number) === w.i).length, w.color)).join('') + seg(ps.filter((p) => !r.wsOf.has(p.number)).length, 'var(--muted-foreground)', ' opacity=".3"');
    return `${segs}${ps.length ? `<text x="${i * colW + colW / 2}" y="${(y - 7).toFixed(1)}" text-anchor="middle" class="ch-v">${ps.length}</text>` : ''}<text x="${i * colW + colW / 2}" y="${H - 22}" text-anchor="middle" class="ch-x">${fmtDay(days[i], { weekday: 'short' })}</text><text x="${i * colW + colW / 2}" y="${H - 5}" text-anchor="middle" class="ch-x">${fmtDay(days[i])}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H};max-width:${W}px"><line x1="0" x2="${W}" y1="${plot}" y2="${plot}" class="ch-grid"/>${bars}</svg>`;
}

// Kinds in page order (the lead story's kind first, or the recap's "order").
const groupsOf = (r) => [...new Set(r.ws.map((w) => w.kind))].map((k) => [k, r.ws.filter((w) => w.kind === k)]);

function overview(r) {
  const groups = groupsOf(r);
  const heads = { fix: 'What got fixed', feature: "What's new", improvement: 'What got better' };
  return groups.map(([k, list]) => `<section class="ov"><h2>${heads[k]}</h2><ol class="ov-list">${list.map((w) => `<li><a href="#ws-${w.i + 1}">${w.icon && r.icons?.has(w.icon) ? iconHTML(r.icons, w.icon) : ''}<span><span class="ov-lead">${plain(k === 'fix' ? w.symptom : (w.title ?? w.name))}</span> <span class="ov-now">${plain(w.now)}</span></span></a></li>`).join('')}</ol></section>`).join('');
}

function tocHTML(r) {
  const groups = groupsOf(r);
  const short = { fix: 'Fixed', feature: 'New', improvement: 'Better' };
  return `<nav class="toc no-print" aria-label="Sections"><a href="#top" data-toc="top">Overview</a>${r.glossary.length ? '<a href="#glossary" data-toc="glossary">New pieces</a>' : ''}${groups.map(([k, l]) => `<p class="toc-h">${short[k]}</p>${l.map((w) => `<a href="#ws-${w.i + 1}" data-toc="ws-${w.i + 1}">${esc(w.name)}</a>`).join('')}`).join('')}${r.prs.length ? '<a href="#all-prs" data-toc="all-prs" class="toc-gap">All PRs</a>' : ''}</nav>`;
}

// A top story's picture: its first media item, or else a compact copy of its section's chart or timeline.
function storyVisual(st, rc) {
  if (st.media.length) return figure(st.media[0], rc, 'fig story-fig');
  const v = st.ws?.chart?.points?.length ? chartHTML(st.ws.chart, rc, true) : timelineHTML(st.ws?.timeline, rc, true);
  return v.replace('<figure class="fig', '<figure class="fig story-fig story-chart');
}

// The top stories: a lead story, then the rest in a grid, then the TL;DR.
function heroHTML(r) {
  const rc = r.rc;
  if (!r.stories.length) return '';
  const story = (st, lead) => {
    const href = st.ws ? `#ws-${st.ws.i + 1}` : null;
    const h = `${href ? `<a href="${href}">` : ''}${esc(st.headline)}${href ? '</a>' : ''}`;
    return `<article class="${lead ? 'story lead' : 'story'}">${lead ? `<h2>${h}</h2>` : `<h3>${h}</h3>`}${st.why ? `<p class="story-why">${inline(st.why, rc)}</p>` : ''}${storyVisual(st, rc)}</article>`;
  };
  const [lead, ...rest] = r.stories;
  const tldr = rc.hero?.tldr ?? [];
  return `<section class="top-stories" aria-label="Top stories">${story(lead, true)}${rest.length ? `<div class="story-grid">${rest.map((x) => story(x, false)).join('')}</div>` : ''}${tldr.length ? `<div class="tldr"><h2>TL;DR</h2><ul>${tldr.map((x) => `<li>${inline(x, rc)}</li>`).join('')}</ul></div>` : ''}</section>`;
}

function glossaryHTML(r) {
  if (!r.glossary.length) return '';
  const def = (t) => md(t ?? '').replace(/^<p>|<\/p>$/g, '');
  return `<section class="ov glossary" id="glossary"><h2>Meet the new pieces</h2><dl>${r.glossary.map((g) => `<div id="${g.id}"><dt>${esc(g.term)}</dt><dd>${def(g.what)}${g.why ? ` <span class="g-why">${def(g.why)}</span>` : ''}</dd></div>`).join('')}</dl></section>`;
}

const absUrl = (u) => { try { return u ? new URL(u).href : null; } catch { return null; } };

// Open Graph and Twitter cards. Crawlers ignore data URIs, so the image is the top
// story's still (or a clip's poster) as a file path, made absolute when "url" is set.
function shareMeta(r) {
  const rc = r.rc;
  const text = (t) => stripMd([t ?? ''].flat().join(' '));
  const desc = [rc.about, r.stories[0]?.why ?? rc.summary].map(text).filter(Boolean).join(' ');
  const cut = desc.length > 200 ? `${desc.slice(0, 197).replace(/\s+\S*$/, '')}…` : desc;
  const m = r.stories.flatMap((x) => x.media).find((x) => !isVideo(x.src) || posterOf(x));
  const src = m ? (isVideo(m.src) ? posterOf(m) : m.src) : null;
  const base = absUrl(rc.url);
  const img = src ? (base ? new URL(src, base).href : src) : null;
  const title = esc(rc.title || 'What shipped');
  return [`<meta name="description" content="${esc(cut)}">`, `<meta property="og:type" content="article">`, `<meta property="og:title" content="${title}">`, `<meta property="og:description" content="${esc(cut)}">`,
    base ? `<meta property="og:url" content="${esc(base)}">` : '', img ? `<meta property="og:image" content="${esc(img)}">` : '',
    `<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">`, `<meta name="twitter:title" content="${title}">`, `<meta name="twitter:description" content="${esc(cut)}">`, img ? `<meta name="twitter:image" content="${esc(img)}">` : ''].filter(Boolean).join('');
}

export async function renderRecapHTML(r, o = {}) {
  const rc = r.rc;
  const s = r.stats;
  const state = snippetState();
  CTX.set(rc, { print: !!o.print, glossary: r.glossary, seen: new Set(), media: new Map() });
  // Built in reading order, so each glossary term links at its first use.
  const head = `${rc.about ? `<p class="about">${inline(rc.about, rc)}</p>` : ''}${rc.summary ? `<div class="lede">${prose(rc.summary, rc)}</div>` : ''}`;
  const hero = heroHTML(r);
  const range = rc.since ? `${fmtDay(rc.since)} – ${fmtDay(rc.until ?? day(r.prs.at(-1)?.mergedAt ?? rc.since), { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
  const byline = [rc.private ? null : rc.repo, rc.byline ?? rc.author, range].filter(Boolean).map(esc).join(' · ');
  const sections = [];
  let last = null;
  for (const w of r.ws) {
    if (w.kind !== last) { sections.push(`<h2 class="part" id="part-${w.kind}">${KINDS[w.kind]}</h2>`); last = w.kind; }
    sections.push(await section(w, r, state));
  }
  const notes = Object.entries(rc.dayNotes ?? {}).filter(([d]) => dayKeys(r).includes(d));
  const lanes = swimlanes(r);
  const all = `<details class="more" id="all-prs"><summary>All ${s.prs} PRs</summary><div class="table-scroll"><table><thead><tr><th>Merged</th><th>PR</th><th>What it did</th><th>Workstream</th></tr></thead><tbody>${r.prs.map((p) => { const w = r.ws[r.wsOf.get(p.number)]; return `<tr id="pr-${p.number}"><td class="nowrap">${fmtDay(day(p.mergedAt))}</td><td>${prRef(rc, p.number, esc(p.url ?? '#'))}</td><td>${esc(p.oneLiner || p.title)}</td><td>${w ? esc(w.name) : ''}</td></tr>`; }).join('')}</tbody></table></div></details>`;
  const anyMermaid = r.ws.some((w) => w.mermaid);
  const otherPrs = r.rest.length && rc.otherPrs ? `<section class="ws"><h2 class="ws-title">Everything else</h2><p>${inline(rc.otherPrs, rc)} (${r.rest.length} PRs)</p></section>` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(rc.title || 'What shipped')}</title>${shareMeta(r)}${o.print ? '<meta name="prtour-print" content="1">' : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>${CSS}${RECAP_CSS}${TOGGLE_CSS}${ICON_CSS}</style>${THEME}</head><body><div class="shell">${tocHTML(r)}<main class="doc" id="top">
<header class="hero"><h1>${esc(rc.title || 'What shipped')}</h1><p class="byline">${byline}</p>${head}</header>
${hero}
${glossaryHTML(r)}
${overview(r)}
${s.prs ? `<section class="ov"><h2>When it shipped</h2><p>${s.prs} PRs over ${s.days} day${s.days === 1 ? '' : 's'}, colored by workstream.</p>${perDayChart(r)}${notes.length ? `<dl class="daynotes">${notes.map(([d, t]) => `<div><dt>${fmtDay(d, { weekday: 'long' })}</dt><dd>${esc(t)}</dd></div>`).join('')}</dl>` : ''}
${lanes ? `<p>Which agent lanes did the work. One row per lane; each dot is a merged PR.</p>${lanes}` : ''}</section>` : ''}
${sections.join('\n')}
${otherPrs}
${s.prs ? `<section class="appendix">${all}</section>` : ''}
<footer class="no-print">Made with <a href="https://github.com/2018kguo/prtour">prtour</a>.</footer>
</main></div>${SAME_JS}<div class="zoom no-print" hidden><img alt=""></div><script>{const z=document.querySelector('.zoom'),zi=z.querySelector('img');document.addEventListener('click',(e)=>{const t=e.target;if(t.classList?.contains('zoomable')){zi.src=t.src;zi.alt=t.alt;z.hidden=false;z.scrollTop=0}else if(!z.hidden)z.hidden=true});document.addEventListener('keydown',(e)=>{if(e.key==='Escape')z.hidden=true})}</script>${sharedTail(state)}${TOGGLE_JS}${CLIENT_JS}${anyMermaid ? `<script type="module">try{const{default:m}=await import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs');m.initialize({startOnLoad:false,theme:document.documentElement.classList.contains('dark')?'dark':'neutral',fontFamily:'IBM Plex Sans, sans-serif'});await m.run({querySelector:'pre.mermaid'})}catch(e){}</script>` : ''}</body></html>`;
  return o.print ? html.replace(/<details class="more"(?! id)/g, '<details class="more" open') : html;
}

// One row per agent lane, PRs as dots on a time axis, colored by workstream.
function swimlanes(r) {
  const byLane = new Map();
  for (const p of r.prs) if (p.lane) byLane.set(p.lane, [...(byLane.get(p.lane) ?? []), p]);
  if (!byLane.size) return '';
  const rows = [...byLane].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
  const t = r.prs.map((p) => Date.parse(p.mergedAt));
  const lo = Math.min(...t);
  const hi = Math.max(...t);
  const L = 230;
  const W = 760;
  const X = (ms) => L + ((ms - lo) / Math.max(1, hi - lo)) * (W - L - 10);
  const RH = 30;
  const H = rows.length * RH + 30;
  const names = r.rc.lanes ?? {};
  const body = rows.map(([k, ps], i) => {
    const y = i * RH + 16;
    return `<text x="0" y="${y + 5}" class="ch-x">${esc(String(names[k] ?? k).slice(0, 30))} (${ps.length})</text><line x1="${L}" x2="${W - 10}" y1="${y}" y2="${y}" class="ch-grid"/>${ps.map((p) => { const w = r.ws[r.wsOf.get(p.number)]; return `<circle cx="${X(Date.parse(p.mergedAt)).toFixed(1)}" cy="${y}" r="5" fill="${w?.color ?? 'var(--muted-foreground)'}"><title>#${p.number} ${esc(p.oneLiner || p.title)}</title></circle>`; }).join('')}`;
  }).join('');
  const ticks = dayKeys(r).map((d) => Date.parse(`${d}T12:00:00Z`)).filter((ms) => ms >= lo && ms <= hi).map((ms) => `<text x="${X(ms).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="ch-x">${fmtDay(day(new Date(ms).toISOString()), { weekday: 'short' })}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}">${body}${ticks}</svg>`;
}

const CLIENT_JS = `<script>(()=>{
document.addEventListener('click',e=>{const v=e.target.closest('[data-tlv]');if(v){const f=v.closest('.tlx');f.dataset.view=v.dataset.tlv;f.querySelectorAll('[data-tlv]').forEach(b=>b.setAttribute('aria-selected',b===v))}
const p=e.target.closest('[data-play]');if(p){const f=p.closest('.tlx');const vw=f.querySelector('.tl-'+f.dataset.view);const h=vw.querySelector('.tl-head');const x0=150,x1=vw.querySelector('svg').viewBox.baseVal.width-16;let t0=null;const dur=4000;cancelAnimationFrame(f._raf);
const step=ts=>{t0??=ts;const k=Math.min(1,(ts-t0)/dur),x=x0+(x1-x0)*k;h.setAttribute('x1',x);h.setAttribute('x2',x);f.style.setProperty('--px',x);vw.querySelectorAll('.tl-b rect').forEach(r=>r.closest('.tl-b').classList.toggle('lit',+r.getAttribute('x')<=x&&+r.getAttribute('x')+ +r.getAttribute('width')>=x));if(k<1)f._raf=requestAnimationFrame(step)};f._raf=requestAnimationFrame(step)}});
document.querySelectorAll('.fig').forEach(f=>{const read=f.querySelector('.ch-read');if(!read)return;const base=read.textContent;f.querySelectorAll('.ch-pt').forEach(g=>{const t=g.querySelector('title').textContent;g.addEventListener('mouseenter',()=>read.textContent=t);g.addEventListener('focus',()=>read.textContent=t);g.addEventListener('mouseleave',()=>read.textContent=base)})});
const clips=[...document.querySelectorAll('video[data-clip]')],still=matchMedia('(prefers-reduced-motion: reduce)').matches;if(still)clips.forEach(v=>{v.autoplay=false;v.pause()});clips.forEach(v=>v.addEventListener('click',()=>{v._user=true;v.paused?v.play():v.pause()}));
if(!still&&clips.length){const vo=new IntersectionObserver(es=>es.forEach(e=>{const v=e.target;if(v._user)return;e.isIntersecting?v.play().catch(()=>{}):v.pause()}),{threshold:.5});clips.forEach(v=>vo.observe(v))}
const ls=[...document.querySelectorAll('[data-toc]')];const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)ls.forEach(l=>l.classList.toggle('on',l.dataset.toc===e.target.id))}),{rootMargin:'-40% 0px -55% 0px'});ls.forEach(l=>{const t=document.getElementById(l.dataset.toc);t&&io.observe(t)})})()</script>`;

const RECAP_CSS = `
:root{--font-sans:"IBM Plex Sans",-apple-system,"Segoe UI",sans-serif;--font-mono:"IBM Plex Mono",ui-monospace,Menlo,monospace}
body{font-family:var(--font-sans);font-size:17px;line-height:1.65;background:var(--background)}
.shell{display:grid;grid-template-columns:1fr minmax(0,760px) 1fr;column-gap:48px}
.doc{grid-column:2;padding:0 0 120px}
.toc{grid-column:1;justify-self:end;position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;padding:64px 0 24px;width:210px;display:flex;flex-direction:column;font-size:15px}
.toc a{padding:4px 10px;border-radius:6px;color:var(--muted-foreground)}.toc a:hover{color:var(--foreground)}.toc a.on{color:var(--foreground);font-weight:600}
.toc-h{margin:18px 10px 2px;font-weight:600;color:var(--foreground);font-size:15px}.toc-gap{margin-top:18px}
@media (max-width:1240px){.shell{display:block}.toc{display:none}.doc{max-width:760px;margin:0 auto;padding:0 20px 96px}}
.hero{padding:64px 0 8px}.hero h1{font-size:40px;line-height:1.15;font-weight:700;letter-spacing:-.02em;margin:0 0 12px;text-wrap:balance}
.byline{color:var(--muted-foreground);font-size:15px;margin:0 0 24px}.lede{font-size:19px;line-height:1.6}.lede p{margin:0 0 12px}
h2{font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-.01em;margin:0 0 14px;text-wrap:balance}
h3{font-size:17px;font-weight:600;margin:28px 0 6px}
p{margin:0 0 14px}a:hover{color:var(--primary)}
code{font-size:.88em;font-family:var(--font-mono);background:var(--muted);padding:.1em .35em;border-radius:4px}
.ov{margin-top:56px}
.ov-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--border)}
.ov-list li{border-bottom:1px solid var(--border)}.ov-list a{display:flex;gap:14px;padding:16px 0;color:inherit}.ov-list a:hover .ov-lead{text-decoration:underline;text-underline-offset:3px}
.ov-list .ic{width:22px;height:22px;margin-top:3px;flex:none;color:var(--muted-foreground)}
.ov-lead{font-weight:600}.ov-now{color:var(--muted-foreground)}
.part{font-size:32px;margin:120px 0 0;padding-top:28px;border-top:2px solid var(--foreground)}
.ws{padding-top:64px}
.ws-title{font-size:28px;display:flex;gap:12px;align-items:flex-start}.ws-title .ic{width:28px;height:28px;margin-top:3px;flex:none;color:var(--ws)}
.ws-meta{color:var(--muted-foreground);font-size:15px;margin:-6px 0 20px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:28px;padding:18px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.pair h3{margin:0 0 6px;color:var(--del)}.pair h3.now{color:var(--add)}.pair p{margin:0 0 8px}.pair-lead{font-weight:600}
.wins,.demo,.steps{margin:0;padding-left:24px}.wins{list-style:disc}.demo,.steps{list-style:decimal}.wins li::marker,.demo li::marker{color:var(--muted-foreground)}
.dg{font:14px var(--font-sans)!important}.dg-bar{display:none}.dg-box{rx:6}.dg-elabel{font-size:13px!important}.wins li,.demo li{margin:6px 0}
.refs{color:var(--muted-foreground);font-size:15px;white-space:nowrap}
a.pr{color:var(--muted-foreground);font-variant-numeric:tabular-nums;text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:3px}a.pr:hover{color:var(--foreground)}
.fig{margin:28px 0}.fig figcaption{margin-top:10px;color:var(--muted-foreground);font-size:15px;line-height:1.5}
.fig img,.fig video{display:block;width:100%;max-height:460px;object-fit:contain;background:var(--muted);border-radius:8px}
.fig-bar{display:flex;gap:10px;align-items:center;margin-bottom:10px}
.seg{display:inline-flex;border:1px solid var(--border);border-radius:8px;padding:2px}.seg button,.play{font:inherit;font-size:15px;border:0;background:none;padding:4px 12px;border-radius:6px;cursor:pointer;color:var(--muted-foreground)}
.seg button[aria-selected=true]{background:var(--foreground);color:var(--background)}.play{border:1px solid var(--border)}.play:hover{color:var(--foreground)}
.chart{width:100%;height:auto;display:block;font:14px var(--font-sans)}
.ch-grid{stroke:var(--border)}.ch-x{fill:var(--muted-foreground);font-size:14px}.ch-v{fill:var(--foreground);font-weight:600;font-size:14px}
.ch-pt rect:first-child{fill:var(--ws,var(--foreground));opacity:.75}.ch-pt rect.ch-hi{fill:var(--del);opacity:.9}.ch-pt:hover rect:first-child,.ch-pt:focus rect:first-child{opacity:1}.ch-hit{fill:transparent}
.ch-mark{stroke:var(--foreground);stroke-dasharray:3 3;opacity:.6}.ch-mark-t{fill:var(--foreground);font-size:14px}
.ch-read{font-size:15px;color:var(--muted-foreground);min-height:1.5em;margin-bottom:6px}
.tl-row{fill:var(--foreground);font-size:14px}.tl-grid{stroke:var(--border)}.tl-tick{fill:var(--muted-foreground);font-size:14px}
.tl-b rect{fill:var(--muted-foreground);opacity:.35}.tl-b text{fill:var(--foreground);font-size:13.5px;pointer-events:none}
.tl-stream rect{fill:var(--add);opacity:.75}.tl-frozen rect{fill:var(--del);opacity:.8}.tl-busy rect{fill:var(--chg);opacity:.8}.tl-wait rect{fill:var(--muted-foreground);opacity:.3}
.tl-frozen text,.tl-busy text,.tl-stream text{fill:#fff}
.tl-b.lit rect{opacity:1}.tl-head{stroke:var(--foreground);stroke-width:1.5}
.tlx[data-view=before] .tl-after,.tlx[data-view=after] .tl-before{display:none}.tl-label{display:none;font-weight:600;margin:8px 0 2px}
.steps{margin:0;padding-left:22px}.steps li{margin:8px 0}
.diff-cap{margin:0 0 10px}
.diff{--diffs-font-family:var(--font-mono)}.diff diffs-container{display:block;border:1px solid var(--border);border-radius:8px;overflow:hidden}
.results table,.more table{width:100%;border-collapse:collapse;font-size:15.5px;margin:12px 0}
.results th,.results td,.more th,.more td{padding:8px 10px 8px 0;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;white-space:normal}
.results th{font-weight:600}.num{text-align:right!important;font-variant-numeric:tabular-nums}.nowrap{white-space:nowrap}
.note{color:var(--muted-foreground);font-size:15px}
.more{margin-top:24px;border-top:1px solid var(--border)}.more>summary{cursor:pointer;padding:14px 0;font-weight:600;list-style:none}.more>summary::after{content:" +";color:var(--muted-foreground)}.more[open]>summary::after{content:" –"}
.more-body .dt{margin:0 0 18px}.more-body .dt p{margin:0 0 8px;display:block;-webkit-line-clamp:unset;overflow:visible}
.prlist{list-style:none;padding:0;margin:0 0 12px}.prlist li{padding:4px 0;font-size:15.5px}
.table-scroll{overflow-x:auto}
.daynotes{display:grid;grid-template-columns:1fr 1fr;gap:10px 28px;margin:18px 0 28px}.daynotes dt{font-weight:600}.daynotes dd{margin:0;color:var(--muted-foreground)}
.appendix{margin-top:80px}footer{margin-top:48px;color:var(--muted-foreground);font-size:15px}
pre.mermaid{margin:0;font:14px var(--font-mono);color:var(--muted-foreground);white-space:pre-wrap}pre.mermaid[data-processed]{color:inherit;display:flex;justify-content:center}
.zoomable{cursor:zoom-in}.zoom{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.82);overflow:auto;padding:24px;cursor:zoom-out}.zoom img{display:block;margin:0 auto;max-width:min(1440px,100%);height:auto;border-radius:8px}
video[data-clip]{cursor:pointer}
.about{font-size:19px;line-height:1.6;color:var(--muted-foreground);margin:0 0 12px}
.top-stories{margin-top:40px;padding-top:28px;border-top:2px solid var(--foreground)}
.story h2{font-size:32px;line-height:1.2;margin:0 0 10px}.story h3{font-size:19px;line-height:1.3;margin:0 0 6px}.story a{color:inherit}.story a:hover{text-decoration:underline;text-underline-offset:4px}
.story-why{font-size:19px;margin:0 0 4px}.story .fig{margin:18px 0 0}.story-grid .story-why{font-size:16px;color:var(--muted-foreground)}
.story-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:28px;margin-top:36px}.story-grid .fig img,.story-grid .fig video{aspect-ratio:16/10;max-height:none;object-fit:cover;object-position:top left}.story-grid .story:only-child .fig img,.story-grid .story:only-child .fig video{aspect-ratio:auto;object-fit:contain}
.tldr{margin-top:36px}.tldr h2{font-size:17px;margin:0 0 6px}.tldr ul{margin:0;padding-left:22px;list-style:disc}.tldr li{margin:4px 0}
.glossary dl{margin:0;border-top:1px solid var(--border)}.glossary dl>div{display:grid;grid-template-columns:180px 1fr;gap:20px;padding:14px 0;border-bottom:1px solid var(--border)}.glossary dt{font-weight:600}.glossary dd{margin:0}.g-why{color:var(--muted-foreground)}
.glossary dl>div:target{background:var(--muted)}
a.term{color:inherit;text-decoration:underline dotted;text-decoration-color:var(--muted-foreground);text-underline-offset:3px;cursor:help}
@media (max-width:700px){.pair,.daynotes{grid-template-columns:1fr}.hero h1{font-size:32px}.glossary dl>div{grid-template-columns:1fr;gap:4px}}
@page{margin:12mm 14mm}
@media print{body{font-size:10pt;line-height:1.45}.doc{max-width:none;padding:0}.ws{padding-top:18px;margin-top:0}.part{break-before:page;margin-top:0}.ws-title{font-size:16pt}h3{font-size:11pt;margin:10px 0 4px}p{margin:4px 0}.fig,.diff-snip{margin:8px 0}h2,h3{break-after:avoid}#all-prs,.prs-more{display:none}.part{break-before:auto!important;margin-top:20px}.dt{margin:4px 0}.fig-bar{display:none}.tlx .tl-before,.tlx .tl-after{display:block!important}.tl-label{display:block!important}.fig,.pair,table,svg.chart,.story,.tldr,.glossary dl>div,.daynotes>div,.diff-cap,diffs-container{break-inside:avoid}.fig img{max-height:95mm;width:auto;max-width:100%;margin:0 auto}
h1,h2,h3,.ws-meta,.diff-cap,.toc-h,.ov>p{break-after:avoid}h2+*,h3+*,.ws-meta+*{break-before:avoid}.top-stories{margin-top:16px;padding-top:12px}.story h2{font-size:18pt}.story h3{font-size:12pt}.story-why{font-size:10.5pt}.about{font-size:11pt}.story-grid{gap:14px;margin-top:14px}.story-grid .fig img{max-height:45mm}.story.lead{break-inside:auto}.story.lead .fig img{max-height:80mm}.story.lead .story-chart svg{max-height:70mm}.glossary dl>div{padding:6px 0}.ov{margin-top:24px}a.term{text-decoration:none}}
`;

// Media in Markdown: a still inline, a clip as its poster linked to the file. Paths stay relative to the recap.
const mdMedia = (m) => `${isVideo(m.src) ? (posterOf(m) ? `[![${m.caption ?? 'Clip'}](${posterOf(m)})](${m.src})` : `[Clip: ${m.caption ?? m.src}](${m.src})`) : `![${m.caption ?? ''}](${m.src})`}${m.caption ? `\n*${m.caption}*` : ''}`;

export function renderRecapMarkdown(r) {
  const rc = r.rc;
  const s = r.stats;
  const out = [`## ${rc.title || 'What shipped'}`, ''];
  if (s.prs) out.push(`${s.prs} PRs over ${s.days} day${s.days === 1 ? '' : 's'}`, '');
  if (rc.about) out.push(rc.about, '');
  if (rc.summary) out.push([rc.summary].flat().join('\n\n'), '');
  for (const st of r.stories) {
    out.push(`### ${st.headline}`, '');
    if (st.why) out.push(st.why, '');
    for (const m of st.media.slice(0, 1)) out.push(mdMedia(m), '');
  }
  if (rc.hero?.tldr?.length) out.push('**TL;DR**', '', ...rc.hero.tldr.map((x) => `- ${x}`), '');
  if (r.glossary.length) out.push('### Meet the new pieces', '', ...r.glossary.map((g) => `- **${g.term}**: ${g.what ?? ''}${g.why ? ` ${g.why}` : ''}`), '');
  for (const [k, list] of groupsOf(r)) {
    out.push(`### ${KINDS[k]}`, '');
    for (const w of list) {
      out.push(`**${w.title ?? w.name}**`, '');
      if (w.symptom) out.push(`- Before: ${w.symptom}`);
      if (w.now) out.push(`- Now: ${w.now}`);
      for (const x of w.wins ?? []) out.push(`- ${typeof x === 'string' ? x : x.text}`);
      if (w.demo) out.push(`- Show it: ${[w.demo].flat().join(' → ')}`);
      for (const m of w.media) out.push('', mdMedia(m));
      if (w.diagram?.nodes?.length) out.push('', diagramMermaid(w.diagram));
      if (w.items.length) out.push('', `<details><summary>${w.items.length} PRs</summary>`, '', ...w.items.map((p) => `- ${rc.private ? `#${p.number}` : `[#${p.number}](${p.url})`} ${p.oneLiner || p.title}`), '', '</details>');
      out.push('');
    }
  }
  return `${out.join('\n').trim()}\n`;
}

// A Twitter/X thread draft: an opener, one post per top story with its media,
// a few more workstreams, and the link. Each post fits 280 characters, with
// links counted as 23 the way X counts them.
export const THREAD_MAX = 280;
// Weighted the way X's twitter-text counts: a link (or bare domain) is 23, an
// emoji is 2, CJK and other characters outside the light ranges are 2 each.
const LIGHT = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
const LINK = /https?:\/\/\S+|\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|app|ai|co|so|sh|gg|me|ly|xyz|edu|gov)(?:\/\S*)?/gi;
const graphemes = (t) => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(t)].map((x) => x.segment);
const weightOf = (g) => (/\p{Extended_Pictographic}/u.test(g) ? 2 : [...g].reduce((n, c) => { const cp = c.codePointAt(0); return n + (LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2); }, 0));
// Pieces of a post: links whole, everything else one grapheme at a time.
const pieces = (t) => String(t).normalize('NFC').split(new RegExp(`(${LINK.source})`, 'gi')).flatMap((x, i) => (i % 2 ? [{ s: x, w: 23 }] : graphemes(x).map((g) => ({ s: g, w: weightOf(g) })))).filter((x) => x.s);
export const postLength = (t) => pieces(t).reduce((n, x) => n + x.w, 0);
function fitPost(t) {
  if (postLength(t) <= THREAD_MAX) return t;
  let n = 0;
  let cut = '';
  for (const x of pieces(t)) { if (n + x.w > THREAD_MAX - 2) break; n += x.w; cut += x.s; }
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('。'));
  return end > cut.length / 2 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}
// A page holding one workstream's chart or timeline, for a screenshot to attach
// to a thread post when the story has no screenshot or clip of its own.
export function chartCardHTML(r, w) {
  const v = w?.chart?.points?.length ? chartHTML(w.chart, r.rc, true) : timelineHTML(w?.timeline, r.rc, true);
  if (!v) return null;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${CSS}${RECAP_CSS}.fig{margin:0}.fig-bar{display:none}.tlx .tl-before,.tlx .tl-after,.tl-label{display:block!important}</style></head><body style="margin:0;padding:24px;width:600px;--ws:${w.color ?? 'var(--foreground)'}">${v}</body></html>`;
}

// Text that can stand alone in a post (not "They open at once", which needs the line before).
const standalone = (t) => t && !/^(?:they|it|its|this|these|that|those|now|here|so|and|but|also|which)\b/i.test(stripMd(t));

// o.attach(item) maps a media item to the path to attach; o.chart(workstream)
// returns a rendered image of its chart, if it can. A post with no picture says so.
export function renderRecapThread(r, o = {}) {
  const rc = r.rc;
  const attachOf = o.attach ?? ((m) => m.src);
  const posts = [];
  const opener = [stripMd(rc.title || 'What shipped'), stripMd(rc.about)].filter(Boolean).join('\n\n');
  const bullets = (rc.hero?.tldr ?? []).map((x) => `- ${stripMd(x)}`);
  // The TL;DR rides in the opener when it fits; otherwise it follows in as many posts as it needs.
  if (bullets.length && postLength(`${opener}\n\n${bullets.join('\n')}`) <= THREAD_MAX) posts.push({ text: `${opener}\n\n${bullets.join('\n')}` });
  else {
    posts.push({ text: opener });
    for (const b of bullets) {
      const last = posts.at(-1);
      if (last.tldr && postLength(`${last.text}\n${b}`) <= THREAD_MAX) last.text += `\n${b}`;
      else posts.push({ text: `TL;DR\n${b}`, tldr: true });
    }
  }
  const picture = (media, w) => { if (media.length) return { attach: [attachOf(media[0])] }; const c = w && o.chart?.(w); return c ? { attach: [c] } : { none: true }; };
  for (const st of r.stories) posts.push({ text: [stripMd(st.headline), stripMd(st.why)].filter(Boolean).join('\n\n'), ...picture(st.media, st.ws) });
  const told = new Set(r.stories.map((x) => x.ws).filter(Boolean));
  for (const w of r.ws.filter((x) => !told.has(x)).slice(0, Math.max(0, 7 - posts.length))) {
    const line = [w.now, ...(w.wins ?? []).map((x) => (typeof x === 'string' ? x : x.text))].find(standalone);
    posts.push({ text: [stripMd(w.title), stripMd(line)].filter(Boolean).join('\n\n'), ...picture(w.media, w) });
  }
  posts.push({ text: `The full write-up, with the numbers behind each change:\n${absUrl(rc.url) ?? '<link to the page>'}` });
  return `${posts.map((p, i) => { const text = fitPost(p.text); return [`${i + 1}/${posts.length} (${postLength(text)} chars)`, text, ...(p.attach ?? []).map((a) => `[attach ${a}]`), ...(p.none ? ['[no picture: add a screenshot to this story, or post it as text]'] : [])].join('\n'); }).join('\n\n')}\n`;
}

export function renderRecapTerminal(r, { color = true, width = 100 } = {}) {
  const c = (code) => (x) => (color ? `\x1b[${code}m${x}\x1b[0m` : String(x));
  const [bold, dim, green, red, yellow] = [c(1), c(2), c(32), c(31), c(33)];
  const rc = r.rc;
  const s = r.stats;
  const wrap = (t, pre = '  ') => String(t ?? '').replace(/\s+/g, ' ').match(new RegExp(`.{1,${width - 4}}(\\s|$)`, 'g'))?.map((l) => `${pre}${l.trim()}`) ?? [];
  const out = [bold(rc.title || 'What shipped'), dim(`${s.prs} PRs · ${s.days} day${s.days === 1 ? '' : 's'}`)];
  if (rc.about) out.push('', ...wrap(rc.about));
  if (rc.summary) out.push('', ...wrap([rc.summary].flat().join(' ')));
  for (const st of r.stories) out.push('', bold(`  ${st.headline}`), ...wrap(st.why ?? '', '    '));
  if (rc.hero?.tldr?.length) out.push('', bold('TL;DR'), ...rc.hero.tldr.flatMap((x) => wrap(`- ${x}`)));
  if (r.glossary.length) out.push('', bold('Meet the new pieces'), ...r.glossary.flatMap((g) => wrap(`${bold(g.term)} ${g.what ?? ''} ${dim(g.why ?? '')}`)));
  for (const w of r.warnings) out.push(yellow(`! ${w}`));
  for (const [k, list] of groupsOf(r)) {
    out.push('', bold(KINDS[k]));
    for (const w of list) {
      out.push('', bold(`  ${w.title ?? w.name}`));
      if (w.symptom) out.push(...wrap(`${red('Before')} ${w.symptom}`, '    '));
      if (w.now) out.push(...wrap(`${green('Now')} ${w.now}`, '    '));
      for (const x of w.wins ?? []) out.push(...wrap(`- ${typeof x === 'string' ? x : x.text}`, '    '));
      if (w.diagram?.nodes?.length) out.push(...diagramTree(w.diagram, { add: green, dim, chg: yellow }).map((l) => `    ${l}`));
    }
  }
  return `${out.join('\n')}\n`;
}
