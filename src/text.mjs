// Resolved tour -> Markdown (PR comment, Slack, chat) or ANSI terminal output.

const hunkList = (e) => (e.hunks ?? e.file.hunks.map((_, i) => i)).map((i) => e.file.hunks[i]);
const loc = (n) => n.where;
// "lines 40-62, 90-97" (new side) for a partially shown file
const ranges = (f, hs) => hs.map((i) => { const h = f.hunks[i]; const end = h.newStart + Math.max(0, h.newLines.size - 1); return h.newLines.size ? `${h.newStart}-${end}` : `old ${h.oldStart}`; }).join(', ');

export function renderMarkdown(r, { link } = {}) {
  const t = r.tour;
  const s = r.stats;
  const out = [`## Guided review: ${t.title || 'diff'}`, ''];
  out.push(`Review **${s.shown}** of ${s.total} changed lines across ${r.chapters.reduce((n, c) => n + c.entries.length, 0)} of ${s.files} files · ${r.notes.length} notes${link ? ` · [open the guided review](${link})` : ''}`, '');
  if (t.summary) out.push([t.summary].flat().join('\n\n'), '');
  if (t.steps?.length) out.push(...t.steps.map((x, i) => `${i + 1}. ${x}`), '');
  if (r.parts.length) out.push('**Stack**', '', ...r.parts.map((p) => `- ${p.url ? `[#${p.key}](${p.url})` : `#${p.key}`} ${p.title ?? ''} (+${p.additions} −${p.deletions}, ${p.files} files)`), '');
  r.chapters.forEach((c, ci) => {
    out.push(`### ${ci + 1}. ${c.title}`, '');
    if (c.body) out.push(c.body, '');
    for (const e of c.entries) out.push(`- \`${r.label(e.file.path)}\`${e.hunks ? ` (lines ${ranges(e.file, e.hunks)})` : ''}`);
    const ns = r.notes.filter((n) => n.chapter === ci);
    if (ns.length) out.push('', ...ns.flatMap((n, i) => [...(i ? ['>'] : []), `> **${n.label}** \`${loc(n)}\`${n.title ? ` **${n.title}**` : ''}: ${n.body.replace(/\n+/g, ' ')}`]));
    out.push('');
  });
  if (r.hidden.length || r.partial.length) {
    out.push('<details><summary>Not in review</summary>', '');
    for (const h of r.hidden) out.push(`**${h.reason}**: ${h.files.map((f) => `\`${r.label(f.path)}\``).join(', ')}`, '');
    if (r.partial.length) out.push(`**Hidden hunks**: ${r.partial.map((p) => `\`${r.label(p.file.path)}\` (lines ${ranges(p.file, p.hunks)})`).join(', ')}`, '');
    if (t.skipped) out.push(t.skipped, '');
    out.push('</details>');
  }
  return `${out.join('\n').trim()}\n`;
}

export function renderTerminal(r, { color = true, width = 100 } = {}) {
  const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  const [bold, dim, green, red, cyan, yellow] = [c(1), c(2), c(32), c(31), c(36), c(33)];
  // inline markdown -> ANSI: **bold** and `code`
  const fmt = (x) => String(x ?? '').replace(/\*\*([^*]+)\*\*/g, (_, m) => bold(m)).replace(/`([^`]+)`/g, (_, m) => cyan(m));
  const out = [];
  const t = r.tour;
  const s = r.stats;
  out.push(bold(t.title || 'Guided review'));
  out.push(dim([t.number && `#${t.number}`, t.author, t.url].filter(Boolean).join(' · ')));
  out.push(`Review ${bold(s.shown)} of ${s.total} changed lines · ${r.notes.length} notes · ${green(`+${s.additions}`)} ${red(`-${s.deletions}`)}`);
  if (t.summary) out.push('', fmt([t.summary].flat().join('\n\n')));
  if (t.steps?.length) out.push('', ...t.steps.map((x, i) => `  ${i + 1}. ${fmt(x)}`));
  if (r.parts.length) out.push('', bold('Stack'), ...r.parts.map((p) => `  ${cyan(`#${p.key}`)} ${p.title ?? ''} ${dim(`${p.files} files`)} ${green(`+${p.additions}`)} ${red(`-${p.deletions}`)}`));
  for (const w of r.warnings) out.push(yellow(`! ${w}`));
  const box = (n) => {
    const text = `${n.label} ${n.title ? `${n.title}: ` : ''}${n.body}`.replace(/\s+/g, ' ');
    const lines = text.match(new RegExp(`.{1,${width - 8}}(\\s|$)`, 'g')) ?? [text];
    return lines.map((l, i) => yellow(`      ${i ? '│' : '┃'} `) + fmt(l.trim()));
  };
  r.chapters.forEach((ch, ci) => {
    out.push('', cyan(bold(`━━ ${String(ci + 1).padStart(2, '0')}/${String(r.chapters.length).padStart(2, '0')} ${ch.title} `.padEnd(width, '━'))));
    if (ch.body) out.push(fmt(ch.body));
    for (const e of ch.entries) {
      const ns = r.notes.filter((n) => n.file === e.file.path);
      out.push('', bold(`  ${r.label(e.file.path)}`) + dim(` ${e.file.status}`) + (e.hunks ? dim(` (partial: ${e.hunks.length}/${e.file.hunks.length} hunks)`) : ''));
      for (const n of ns.filter((x) => !x.anchored)) out.push(...box(n));
      if (e.file.binary) { out.push(dim('      (binary)')); continue; }
      for (const h of hunkList(e)) {
        out.push(dim(`  ${h.header}`));
        let o = h.oldStart;
        let nw = h.newStart;
        for (const l of h.text.split('\n').slice(1)) {
          if (!l || l.startsWith('\\')) continue;
          const kind = l[0];
          const num = kind === '-' ? o : nw;
          out.push(`${dim(String(num).padStart(5))} ${kind === '+' ? green(l) : kind === '-' ? red(l) : dim(l)}`);
          for (const n of ns.filter((x) => x.anchored && x.line === num && (x.side === 'deletions' ? kind === '-' : kind !== '-'))) out.push(...box(n));
          if (kind !== '+') o++;
          if (kind !== '-') nw++;
        }
      }
    }
  });
  if (r.hidden.length || r.partial.length) {
    out.push('', dim(bold('━━ Not in review '.padEnd(width, '━'))));
    for (const h of r.hidden) out.push(dim(`  ${h.reason}: ${h.files.map((f) => r.label(f.path)).join(', ')}`));
    for (const p of r.partial) out.push(dim(`  ${r.label(p.file.path)}: hunks ${p.hunks.join(', ')} hidden`));
    if (t.skipped) out.push(dim(`  ${fmt(t.skipped)}`));
  }
  return `${out.join('\n')}\n`;
}
