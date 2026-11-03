// The before/after map: a few components and who calls whom after the change.
// tour.diagram = { title, caption, nodes: [{ id, label, change: "new"|"changed", chapter }], edges: [{ from, to, label }] }
// Laid out left to right by longest path, wrapped into rows when it gets wide.

const CH = 8.6; // px per monospace char at 14px
const H = 40;
const GX = 48;
const LEFT = 18; // room for an edge that wraps to the next row
const GY = 30;
const ROW_MAX = 1200;

export function checkDiagram(d, chapterCount) {
  if (!d) return [];
  const w = [];
  const ids = new Set((d.nodes ?? []).map((n) => n.id));
  if ((d.nodes ?? []).length > 10) w.push(`diagram: ${d.nodes.length} nodes (max 10); it is a map, not a call graph`);
  for (const e of d.edges ?? []) for (const k of ['from', 'to']) if (!ids.has(e[k])) w.push(`diagram: edge ${k} "${e[k]}" is not a node id`);
  for (const n of d.nodes ?? []) if (n.chapter != null && (n.chapter < 1 || n.chapter > chapterCount)) w.push(`diagram: node "${n.id}" points at chapter ${n.chapter}, which doesn't exist`);
  return w;
}

function layout(d) {
  const nodes = (d.nodes ?? []).map((n) => ({ ...n, w: Math.round(28 + n.label.length * CH + (n.change === 'new' ? 16 : 0) + (n.chapter ? 34 : 0) + (n.icon ? 24 : 0)), layer: 0 }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = (d.edges ?? []).filter((e) => byId.has(e.from) && byId.has(e.to));
  // ponytail: longest-path layering, capped at n passes so a cycle can't loop forever
  for (let i = 0; i < nodes.length; i++) for (const e of edges) { const a = byId.get(e.from); const b = byId.get(e.to); if (b.layer < a.layer + 1 && a !== b) b.layer = a.layer + 1; }
  const layers = [];
  for (const n of nodes) (layers[n.layer] ??= []).push(n);
  // Order each column by where its parents sit, so edges don't cross needlessly.
  const pos = new Map();
  for (const col of layers.filter(Boolean)) {
    const score = (n) => { const ps = edges.filter((e) => e.to === n.id && pos.has(e.from)).map((e) => pos.get(e.from)); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : col.indexOf(n); };
    col.sort((a, b) => score(a) - score(b));
    col.forEach((n, i) => pos.set(n.id, i));
  }
  // The gap before a column fits the longest label on edges into it.
  const gapBefore = (col) => Math.max(GX, ...edges.filter((e) => col.some((n) => n.id === e.to) && e.label).map((e) => e.label.length * 6.6 + 40));
  // Columns of nodes, wrapped into rows like a paragraph.
  const rows = [[]];
  let x = LEFT;
  for (const col of layers.filter(Boolean)) {
    const cw = Math.max(...col.map((n) => n.w));
    if (x > LEFT) x += gapBefore(col);
    if (x > LEFT && x + cw > ROW_MAX) { rows.push([]); x = LEFT; }
    rows.at(-1).push({ col, x, cw });
    x += cw;
  }
  let y = 0;
  for (const row of rows) {
    const rh = Math.max(...row.map((c) => c.col.length)) * (H + GY) - GY;
    for (const c of row) c.col.forEach((n, i) => { n.x = c.x; n.y = y + i * (H + GY); });
    y += rh + GY * 1.6;
  }
  const width = Math.max(...nodes.map((n) => n.x + n.w), 0) + 14;
  return { nodes, edges, byId, width, height: y - GY * 1.6 };
}

import { iconSVG } from './icons.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Before/After toggle: "before" hides new nodes and edges and shows changed
// nodes in their old style. Needs TOGGLE_JS on the page.
export function diagramToggle(d, href = (n) => `#ch-${n}`, icons = null) {
  const svg = diagramSVG(d, href, icons);
  if (!svg) return '';
  const has = (d.nodes ?? []).some((n) => n.change);
  return `<div class="dg-wrap" data-view="after">${has ? '<div class="dg-toggle tabs"><nav role="tablist"><button type="button" role="tab" data-dg="before" aria-selected="false">Before</button><button type="button" role="tab" data-dg="after" aria-selected="true">After</button></nav></div>' : ''}${svg}</div>`;
}
export const TOGGLE_CSS = `@media (prefers-reduced-motion: no-preference){.dg-wrap[data-view=after] .dg-e-new .dg-edge{stroke-dasharray:5 4;animation:dgflow 1.1s linear infinite;stroke:var(--add);opacity:.9}}@keyframes dgflow{to{stroke-dashoffset:-18}}
.dg-removed.dg-box{fill:none;stroke:var(--muted-foreground);stroke-dasharray:4 3}.dg-n-removed .dg-label{fill:var(--muted-foreground);text-decoration:line-through}.dg-e-removed .dg-edge{stroke-dasharray:4 3}
.dg-wrap[data-view=after] .dg-n-removed,.dg-wrap[data-view=after] .dg-e-removed{opacity:0}
.dg-wrap{position:relative}.dg-toggle{display:flex;justify-content:flex-end;margin:-6px 0 8px}.dg-toggle nav{transform:scale(.92);transform-origin:top right}
.dg-n,.dg-e,.dg-link{transition:opacity .25s}.dg-wrap[data-view=before] .dg-n-new,.dg-wrap[data-view=before] .dg-e-new{opacity:0}
.dg-wrap[data-view=before] .dg-n-changed .dg-box{fill:var(--card);stroke:var(--border)}.dg-wrap[data-view=before] .dg-n-changed .dg-bar{opacity:0}`;
export const TOGGLE_JS = `<script>document.addEventListener('click',e=>{const b=e.target.closest('[data-dg]');if(!b)return;const w=b.closest('.dg-wrap');w.dataset.view=b.dataset.dg;w.querySelectorAll('[data-dg]').forEach(x=>x.setAttribute('aria-selected',x===b))})</script>`;

export function diagramSVG(d, href = (n) => `#ch-${n}`, icons = null) {
  if (!d?.nodes?.length) return '';
  // Drop icons that didn't resolve, so no node keeps an empty gap.
  d = { ...d, nodes: d.nodes.map((n) => (n.icon && !icons?.has(n.icon) ? { ...n, icon: undefined } : n)) };
  const { nodes, edges, byId, width, height } = layout(d);
  const pad = 2;
  const into = new Map();
  const paths = edges.map((e) => {
    const k = into.get(e.to) ?? 0;
    if (e.label) into.set(e.to, k + 1);
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    const x1 = a.x + a.w;
    const y1 = a.y + H / 2;
    const x2 = b.x;
    const y2 = b.y + H / 2;
    let p;
    if (x2 > x1) { const mx = x1 + 14; p = `M${x1} ${y1}H${mx}V${y2}H${x2 - 2}`; } // bend early: the label gets the long run
    else { const gy = b.y - GY / 2; p = `M${x1} ${y1}H${x1 + 12}V${gy}H${x2 - 12}V${y2}H${x2 - 2}`; } // wraps to the next row
    // Label sits on the last segment, just before the arrow, so labels from one source don't stack.
    const lw = String(e.label ?? '').length * 6.6;
    // A wrapping edge carries its label on the long run back to the left.
    // Labels into the same node stack upward instead of overlapping.
    const [lx, ly] = x2 > x1 ? [Math.max(x1 + 20, x2 - lw - 10), y2 - 6 - k * 13] : [Math.max(4, x1 - lw - 4), b.y - GY / 2 - 5 - k * 13];
    const fresh = e.change === 'removed' || a.change === 'removed' || b.change === 'removed' ? ' dg-e-removed' : e.change === 'new' || a.change === 'new' || b.change === 'new' ? ' dg-e-new' : '';
    return `<g class="dg-e${fresh}"><path d="${p}" class="dg-edge" marker-end="url(#dg-arrow)"/>${e.label ? `<text x="${lx}" y="${ly}" class="dg-elabel">${esc(e.label)}</text>` : ''}</g>`;
  }).join('');
  const boxes = nodes.map((n) => {
    const cls = n.change === 'new' ? 'dg-new' : n.change === 'changed' ? 'dg-changed' : n.change === 'removed' ? 'dg-removed' : 'dg-old';
    const label = `${n.change === 'new' ? '+ ' : ''}${n.label}`;
    const chip = n.chapter ? `<rect x="${n.x + n.w - 34}" y="${n.y + 10}" width="24" height="20" rx="5" class="dg-chip"/><text x="${n.x + n.w - 22}" y="${n.y + 24}" class="dg-chiptext" text-anchor="middle">${String(n.chapter).padStart(2, '0')}</text>` : '';
    const body = `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${H}" rx="8" class="dg-box ${cls}"/>${n.change ? `<rect x="${n.x}" y="${n.y}" width="3" height="${H}" rx="1.5" class="dg-bar ${cls}"/>` : ''}${n.icon ? iconSVG(icons, n.icon, n.x + 12, n.y + 12, 16) : ''}<text x="${n.x + (n.icon ? 36 : 14)}" y="${n.y + 25}" class="dg-label">${esc(label)}</text>${chip}`;
    const nc = n.change ? ` dg-n-${n.change}` : '';
    return n.chapter ? `<a href="${href(n.chapter)}" class="dg-link${nc}">${body}<title>Chapter ${n.chapter}</title></a>` : `<g class="dg-n${nc}">${body}</g>`;
  }).join('');
  return `<svg class="dg" viewBox="${-pad} ${-pad - 14} ${width + pad * 2} ${height + pad * 2 + 14}" style="max-width:${width + pad * 2}px" role="img" aria-label="${esc(d.title ?? 'Before and after')}"><defs><marker id="dg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8" class="dg-arrowhead"/></marker></defs>${paths}${boxes}</svg>`;
}

export function diagramMermaid(d) {
  if (!d?.nodes?.length) return '';
  const id = (s) => `n_${String(s).replace(/\W/g, '_')}`;
  // Mermaid reads # as the start of an entity code, so write it as one.
  const q = (s) => `"${String(s).replace(/"/g, "'").replace(/#/g, '#35;')}"`;
  return ['```mermaid', 'flowchart LR',
    ...d.nodes.map((n) => `  ${id(n.id)}[${q(`${n.change === 'new' ? '+ ' : ''}${n.label}${n.chapter ? ` (${n.chapter})` : ''}`)}]`),
    ...(d.edges ?? []).map((e) => `  ${id(e.from)} -->${e.label ? `|${q(e.label)}|` : ''} ${id(e.to)}`),
    ...d.nodes.filter((n) => n.change === 'new').map((n) => `  style ${id(n.id)} fill:#e9f7ec,stroke:#2da44e`),
    '```'].join('\n');
}

// Terminal: the map as a tree from its entry points. Works in any terminal.
export function diagramTree(d, paint = { add: (x) => x, dim: (x) => x, chg: (x) => x }) {
  if (!d?.nodes?.length) return [];
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const out = new Map(d.nodes.map((n) => [n.id, []]));
  for (const e of d.edges ?? []) if (byId.has(e.from) && byId.has(e.to)) out.get(e.from).push(e);
  const hasIn = new Set((d.edges ?? []).map((e) => e.to));
  const roots = d.nodes.filter((n) => !hasIn.has(n.id));
  const seen = new Set();
  const lines = [];
  const name = (n) => {
    const t = `${n.change === 'new' ? '+ ' : n.change === 'changed' ? '~ ' : ''}${n.label}`;
    return (n.change === 'new' ? paint.add(t) : n.change === 'changed' ? paint.chg(t) : t) + (n.chapter ? paint.dim(` (${String(n.chapter).padStart(2, '0')})`) : '');
  };
  const walk = (n, prefix, last, label, top) => {
    const head = top ? '' : `${prefix}${last ? '└─' : '├─'}▶ `;
    const again = seen.has(n.id);
    lines.push(`${head}${name(n)}${label ? paint.dim(`  ${label}`) : ''}${again && out.get(n.id).length ? paint.dim('  (above)') : ''}`);
    if (again) return;
    seen.add(n.id);
    const kids = out.get(n.id);
    kids.forEach((e, i) => walk(byId.get(e.to), top ? '' : prefix + (last ? '    ' : '│   '), i === kids.length - 1, e.label, false));
  };
  for (const r of roots.length ? roots : [d.nodes[0]]) walk(r, '', true, '', true);
  for (const n of d.nodes) if (!seen.has(n.id)) walk(n, '', true, '', true);
  return lines;
}

// Standalone SVG (colors inlined) for converting to PNG.
export function diagramSVGStandalone(d) {
  const svg = diagramSVG(d);
  if (!svg) return '';
  const css = `.dg{font:14px Menlo,monospace}.dg-box{fill:#fff;stroke:#e7e7e4}.dg-new.dg-box{fill:#ecf7ee;stroke:#a9d9b3}.dg-changed.dg-box{fill:#fff6e5;stroke:#e8c98c}.dg-bar.dg-new{fill:#1f883d}.dg-bar.dg-changed{fill:#b26b00}.dg-label{fill:#1c1c1e}.dg-chip{fill:none;stroke:#e7e7e4}.dg-chiptext{fill:#8a8a8e;font-size:11px}.dg-edge{fill:none;stroke:#8a8a8e}.dg-arrowhead{fill:none;stroke:#8a8a8e;stroke-width:1.2}.dg-elabel{fill:#8a8a8e;font:12px Helvetica,sans-serif}`;
  return svg.replace('<svg class="dg"', '<svg xmlns="http://www.w3.org/2000/svg" class="dg"').replace(/style="max-width:[^"]*"/, '').replace('<defs>', `<style>${css}</style><defs>`)
    .replace(/<a href="[^"]*" class="dg-link">/g, '<g>').replace(/<\/a>/g, '</g>').replace(/<title>[^<]*<\/title>/g, '');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import('node:assert')).strict;
  const d = { nodes: [{ id: 'a', label: 'MainActivity' }, { id: 'b', label: 'OnNewIntent', change: 'new', chapter: 2 }, { id: 'c', label: 'send' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: 'thread' }, { from: 'b', to: 'zz' }] };
  const L = layout(d);
  assert.deepEqual(L.nodes.map((n) => n.layer), [0, 1, 2]);
  assert.ok(L.nodes[1].x > L.nodes[0].x);
  // barycentric order: c's parent is in row 1, so c moves below b
  const X = layout({ nodes: [{ id: 'r', label: 'r' }, { id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'x', label: 'x' }, { id: 'y', label: 'y' }], edges: [{ from: 'r', to: 'a' }, { from: 'r', to: 'b' }, { from: 'b', to: 'x' }, { from: 'a', to: 'y' }] });
  assert.ok(X.byId.get('y').y < X.byId.get('x').y);
  assert.match(diagramSVG(d), /<a href="#ch-2"/);
  assert.match(diagramMermaid(d), /n_a --> n_b/);
  assert.deepEqual(diagramTree(d), ['MainActivity', '└─▶ + OnNewIntent (02)', '    └─▶ send  thread']);
  assert.match(diagramSVGStandalone(d), /^<svg xmlns=/);
  assert.deepEqual(checkDiagram(d, 1), ['diagram: edge to "zz" is not a node id', 'diagram: node "b" points at chapter 2, which doesn\'t exist']);
  console.log('diagram.mjs ok');
}
