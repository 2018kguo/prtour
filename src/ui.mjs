// Components come from Basecoat (basecoatui.com): shadcn/ui's design as plain
// HTML + CSS, compiled Tailwind v4, MIT. Its CSS is inlined so pages stay one
// file. Markup follows Basecoat's API: .card > header/section, .badge
// [data-variant], .btn [data-variant][data-size], .tabs > [role=tablist],
// .input[type=checkbox], .textarea, .kbd. This file adds only page layout and
// the three diff colors (Tailwind's green/amber/red), nothing component-like.
import fs from 'node:fs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ponytail: vendored so installs skip the 6 MB basecoat-css package; refresh by copying its dist/basecoat.cdn.min.css.
const BASECOAT = fs.readFileSync(new URL('./vendor/basecoat.min.css', import.meta.url), 'utf8');

const LAYOUT = `
:root{--add:oklch(52.7% .154 150.069);--add-bg:oklch(98.2% .018 155.826);--add-line:oklch(87.1% .15 154.449);
--chg:oklch(55.5% .163 48.998);--chg-bg:oklch(98.7% .022 95.277);--chg-line:oklch(87.9% .169 91.605);--del:oklch(57.7% .245 27.325)}
.dark{--add:oklch(79.2% .209 151.711);--add-bg:oklch(26.6% .065 152.934);--add-line:oklch(39.3% .095 152.535);
--chg:oklch(82.8% .189 84.429);--chg-bg:oklch(27.9% .077 45.635);--chg-line:oklch(41.4% .112 45.904);--del:oklch(70.4% .191 22.216)}
body{background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
a:hover{color:var(--primary)}p{margin:0 0 .75rem}[hidden]{display:none!important}
code{font:.85em/1.4 var(--font-mono);background:var(--muted);padding:.12em .4em;border-radius:calc(var(--radius) - 4px)}
.page{max-width:1600px;margin:0 auto;padding:0 clamp(16px,5vw,80px) 112px}
.stack{display:flex;flex-direction:column;gap:16px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.grow{flex:1}
.split{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:48px;align-items:start}
.rail{display:grid;grid-template-columns:minmax(260px,400px) minmax(0,1fr);gap:48px}
.rail-side{position:sticky;top:76px;align-self:start;max-height:calc(100vh - 100px);overflow:auto}
.rail-main{min-width:0;display:flex;flex-direction:column;gap:20px}
.t-display{font-size:30px;line-height:1.2;font-weight:600;letter-spacing:-.025em;margin:0;text-wrap:balance}
.t-title{font-size:20px;line-height:1.3;font-weight:600;letter-spacing:-.015em;margin:0;text-wrap:balance}
.t-label{font-size:12px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:var(--muted-foreground)}
.t-small{font-size:13px}.t-muted{color:var(--muted-foreground)}.t-mono{font-family:var(--font-mono);font-size:12.5px}
.t-add{color:var(--add)}.t-del{color:var(--del)}.sep{color:var(--border)}
.panel{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-xl);overflow:hidden;box-shadow:0 1px 2px rgb(0 0 0/.04)}
.stat{display:flex;flex-direction:column}.stat b{font-size:24px;line-height:1.15;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.flist{list-style:none;padding:0;margin:0;font-size:13.5px}.flist li{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:6px 0;border-bottom:1px solid var(--border)}.flist li:last-child{border:0}
.flist a{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.f-name{font-weight:500}.f-dir{color:var(--muted-foreground)}.f-count{white-space:nowrap;font:12px var(--font-mono)}
.tabbar{position:sticky;top:0;z-index:20;background:color-mix(in oklab,var(--background) 85%,transparent);backdrop-filter:blur(10px)}
.tabbar>div{max-width:1600px;margin:0 auto;padding:12px clamp(16px,5vw,80px);display:flex;gap:12px;align-items:center}
.meter{height:6px;width:120px;border-radius:3px;background:var(--muted);overflow:hidden}.meter>i{display:block;height:100%;background:var(--add);transition:width .25s}
details.disclosure{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--card);overflow:hidden}
details.disclosure>summary{display:flex;gap:8px;align-items:baseline;padding:8px 14px;cursor:pointer;font-size:13.5px;list-style:none}
details.disclosure>summary::before{content:"›";color:var(--muted-foreground);transition:transform .15s}details.disclosure[open]>summary::before{transform:rotate(90deg)}
.floating{position:fixed;z-index:30;right:20px}
.dg{width:100%;height:auto;display:block;font:13px var(--font-mono)}
.dg-box{fill:var(--card);stroke:var(--border)}.dg-new.dg-box{fill:var(--add-bg);stroke:var(--add-line)}.dg-changed.dg-box{fill:var(--chg-bg);stroke:var(--chg-line)}
.dg-bar.dg-new{fill:var(--add)}.dg-bar.dg-changed{fill:var(--chg)}.dg-label{fill:var(--foreground)}
.dg-chip{fill:var(--card);stroke:var(--border)}.dg-chiptext{fill:var(--muted-foreground);font-size:10.5px}
.dg-edge{fill:none;stroke:var(--muted-foreground);stroke-width:1;opacity:.6}.dg-arrowhead{fill:none;stroke:var(--muted-foreground);stroke-width:1.2;opacity:.6}.dg-elabel{fill:var(--muted-foreground);font:11.5px var(--font-sans)}
.dg-link{cursor:pointer}.dg-link:hover .dg-box{stroke:var(--primary)}
pre.mermaid{margin:0;font:12.5px var(--font-mono);color:var(--muted-foreground);white-space:pre-wrap}pre.mermaid[data-processed]{color:inherit;display:flex;justify-content:center}
.figure{margin:0}.figure img,.figure video{display:block;width:100%;height:auto}.figure figcaption{padding:10px 16px;font-size:13px;color:var(--muted-foreground);border-top:1px solid var(--border)}
@media (max-width:960px){.split,.rail{grid-template-columns:minmax(0,1fr);gap:24px}.rail-side{position:static;max-height:none}}
@media print{.tabbar,.no-print{display:none!important}.card,details.disclosure{break-inside:avoid-page;box-shadow:none}.panel{box-shadow:none}.rail-side{position:static;max-height:none}.page{padding-bottom:0}}
`;

export const CSS = BASECOAT + LAYOUT;

// Follow the system theme with Basecoat's .dark class; print and PDF stay light.
export const THEME = `<script>(()=>{const m=matchMedia('(prefers-color-scheme: dark)'),p=!!document.querySelector('meta[name=prtour-print]'),s=()=>document.documentElement.classList.toggle('dark',m.matches&&!p);s();m.addEventListener('change',s)})()</script>`;
export const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">';

const split = (p) => { const i = p.lastIndexOf('/'); return [p.slice(i + 1), i < 0 ? '' : p.slice(0, i + 1)]; };
export const counts = (a, d) => `${a ? `<span class="t-add">+${a}</span>` : ''}${a && d ? ' ' : ''}${d ? `<span class="t-del">−${d}</span>` : ''}`;
export const n2 = (n) => String(n).padStart(2, '0');

// Thin helpers that emit Basecoat markup.
export const ui = {
  badge: (text, variant = 'secondary') => `<span class="badge" data-variant="${variant}">${text}</span>`,
  btn: (label, attrs = '', variant = 'ghost', size = 'sm') => `<button type="button" class="btn" data-variant="${variant}" data-size="${size}" ${attrs}>${label}</button>`,
  card: ({ title, description, action, body }) => `<div class="card">${title || description ? `<header>${title ? `<h2>${title}</h2>` : ''}${description ? `<p>${description}</p>` : ''}${action ? `<div class="card-action">${action}</div>` : ''}</header>` : ''}<section>${body}</section></div>`,
  panel: (inner, attrs = '') => `<div class="panel"${attrs}>${inner}</div>`,
  check: (attr, label = 'Reviewed') => `<label class="label t-small" style="gap:8px;cursor:pointer"><input type="checkbox" class="input" ${attr}>${label}</label>`,
  stat: (v, label) => `<div class="stat"><b>${v}</b><span class="t-small t-muted">${label}</span></div>`,
  fileRow: (label, href, a, d, extra = '') => { const [name, dir] = split(label); return `<li><a href="${href}"><span class="f-name">${esc(name)}</span> <span class="f-dir">${esc(dir)}</span>${extra}</a><span class="f-count">${counts(a, d)}</span></li>`; },
  fileInline: (label, a, d) => { const [name, dir] = split(label); return `<span class="f-name">${esc(name)}</span> <span class="f-dir">${esc(dir)}</span><span class="grow"></span><span class="f-count">${counts(a, d)}</span>`; },
  tabs: (items, right = '') => `<div class="tabbar"><div><div class="tabs"><nav role="tablist" aria-orientation="horizontal">${items.map(([id, label, on]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${on ? 'true' : 'false'}">${label}</button>`).join('')}</nav></div><span class="grow"></span>${right}</div></div>`,
};
