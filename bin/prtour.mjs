#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitPatch } from '../src/patch.mjs';
import { kindOf, resolve, scaffold } from '../src/tour.mjs';
import { renderHTML } from '../src/html.mjs';
import { renderMarkdown, renderTerminal } from '../src/text.mjs';
import { detect } from '../src/term-images.mjs';

const rel = (p) => { const r = path.relative(process.cwd(), p); return r.startsWith('..') ? p : r || '.'; };
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HELP = `prtour: guided, agent-annotated reviews of a diff, rendered with @pierre/diffs

  prtour [target]            init + open in the browser (target defaults to this branch)
  prtour init [target…]      fetch the diff, scaffold .prtour/<slug>/tour.json
           --stack           with one PR: find its whole stack (base/head chain)
           --dir <path>      write the tour here instead of .prtour/<slug>
  prtour hunks [file…]       list hunk indices; --lines adds old/new line numbers
  prtour check [dir]         validate tour.json against the diff (exit 1 on warnings)
  prtour render [dir]        write a self-contained HTML file (default <dir>/index.html)
           --format md|term  Markdown (PR comment) or terminal output to stdout
           -o <file>         output path   --split  side-by-side   --wrap  wrap lines
  prtour show [dir]          the tour in the terminal (ANSI, paged)
           --images kitty|iterm|none   inline images; default probes the terminal
  prtour open [dir]          serve with live reload; reviewer comments -> feedback.json
  prtour feedback [dir]      print reviewer comments as Markdown (--clear to reset)
  prtour skill [--install]   print the agent skill (or write .claude/skills/prtour/SKILL.md)

target: 123 | https://github.com/o/r/pull/123 | o/r#123 | main...HEAD | file.patch | -
        several targets = one tour with a part per PR/range (stacked PRs)
dir:    a .prtour/<slug> folder or slug (positional or --dir); defaults to the newest tour.
        init --dir <path> writes the tour somewhere other than .prtour/<slug>.`;

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
const trySh = (...a) => { try { return sh(...a); } catch { return null; } };
const die = (msg) => { console.error(`prtour: ${msg}`); process.exit(1); };

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') flags.out = argv[++i];
    else if (a === '--format' || a === '--port' || a === '--dir' || a === '--images') flags[a.slice(2)] = argv[++i];
    else if (a === '-h') flags.help = true;
    else if (a.startsWith('--')) flags[a.slice(2)] = true;
    else pos.push(a);
  }
  return { flags, pos };
}

const workRoot = () => path.join(trySh('git', ['rev-parse', '--show-toplevel'])?.trim() || process.cwd(), '.prtour');

function findDir(arg) {
  if (arg && fs.existsSync(path.join(arg, 'tour.json'))) return path.resolve(arg);
  const base = workRoot();
  if (arg && fs.existsSync(path.join(base, arg, 'tour.json'))) return path.join(base, arg);
  if (arg) die(`no tour at ${arg} (run \`prtour init\` first)`);
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).map((d) => path.join(base, d)).filter((d) => fs.existsSync(path.join(d, 'tour.json'))) : [];
  if (!dirs.length) die('no tours yet; run `prtour init <pr|range>`');
  return dirs.sort((a, b) => fs.statSync(path.join(b, 'tour.json')).mtimeMs - fs.statSync(path.join(a, 'tour.json')).mtimeMs)[0];
}

function load(dir) {
  let tour;
  try { tour = JSON.parse(fs.readFileSync(path.join(dir, 'tour.json'), 'utf8')); } catch (e) { die(`${dir}/tour.json is not valid JSON: ${e.message}`); }
  const files = tour.parts
    ? tour.parts.flatMap((p) => splitPatch(fs.readFileSync(path.join(dir, 'parts', `${p.key}.patch`), 'utf8'), p.key))
    : splitPatch(fs.readFileSync(path.join(dir, 'diff.patch'), 'utf8'));
  const r = resolve(tour, files);
  // Image paths are relative to the tour folder; check them here, where the folder is known.
  for (const im of [...(tour.images ?? []), ...(tour.chapters ?? []).flatMap((c) => c.images ?? [])]) {
    if (!im?.src) { r.warnings.push('image without src'); continue; }
    if (/^https?:/.test(im.src)) continue;
    im.abs = path.resolve(dir, im.src);
    if (!fs.existsSync(im.abs)) r.warnings.push(`image ${im.src} not found (paths are relative to ${rel(dir)})`);
    else if (fs.statSync(im.abs).size > 8e6) r.warnings.push(`image ${im.src} is ${(fs.statSync(im.abs).size / 1e6).toFixed(1)} MB; it is embedded in the HTML, so keep it under 8 MB`);
  }
  return r;
}

// ---- fetching a diff ------------------------------------------------------

function fetchPR(target) {
  const m = target.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  const sel = m ? [m[2], '-R', m[1]] : [target];
  const view = trySh('gh', ['pr', 'view', ...sel, '--json', 'number,title,url,author,baseRefName,headRefName,body,state']);
  if (!view) die(`could not read PR ${target} with gh (is \`gh auth status\` ok?)`);
  const pr = JSON.parse(view);
  const repo = pr.url.match(/github\.com\/([^/]+\/[^/]+)\/pull/)[1];
  let diff = trySh('gh', ['pr', 'diff', ...sel]) ?? trySh('gh', ['api', `repos/${repo}/pulls/${pr.number}`, '-H', 'Accept: application/vnd.github.diff']);
  if (!diff) {
    // ponytail: GitHub refuses diffs over 300 files/20k lines; fall back to the local clone
    if (!trySh('git', ['fetch', '-q', 'origin', `pull/${pr.number}/head`, pr.baseRefName])) die('GitHub would not return the diff and git fetch failed');
    diff = sh('git', ['diff', '--no-color', '--no-ext-diff', `origin/${pr.baseRefName}...FETCH_HEAD`]);
  }
  return { diff, slug: `pr-${pr.number}`, meta: { title: pr.title, url: pr.url, number: pr.number, repo, author: pr.author?.login, base: pr.baseRefName, head: pr.headRefName, state: pr.state, description: pr.body ?? '' } };
}

function fetchDiff(target) {
  if (target === '-') return { diff: fs.readFileSync(0, 'utf8'), slug: 'stdin', meta: { title: 'Patch from stdin' } };
  if (target && fs.existsSync(target) && fs.statSync(target).isFile()) return { diff: fs.readFileSync(target, 'utf8'), slug: path.basename(target).replace(/\.\w+$/, ''), meta: { title: path.basename(target) } };
  if (target && (/^\d+$/.test(target) || /\/pull\/\d+/.test(target) || /^[\w.-]+\/[\w.-]+#\d+$/.test(target))) return fetchPR(target);
  const git = (args) => sh('git', ['diff', '--no-color', '--no-ext-diff', ...args]);
  if (target) return { diff: git([target]), slug: target.replace(/[^\w-]+/g, '_'), meta: { title: `git diff ${target}`, base: target.split(/\.{2,3}/)[0], head: target.split(/\.{2,3}/)[1] || 'working tree' } };
  // No target: this branch (committed + uncommitted) against the default branch.
  const head = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const def = trySh('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.trim() || (trySh('git', ['rev-parse', '--verify', '-q', 'origin/main']) ? 'origin/main' : 'main');
  const base = sh('git', ['merge-base', def, 'HEAD']).trim();
  const subject = trySh('git', ['log', '-1', '--format=%s'])?.trim();
  return { diff: git([base]), slug: head === 'HEAD' ? `local-${base.slice(0, 7)}` : head.replace(/[^\w.-]+/g, '_'), meta: { title: head === 'HEAD' ? subject : head, base: def, head } };
}

// The whole stack a PR sits in: follow base branches down to the trunk and
// head branches up, using the repo's PR list (open, merged and closed).
function stackOf(target) {
  const first = fetchPR(target).meta;
  const list = JSON.parse(sh('gh', ['pr', 'list', '-R', first.repo, '--state', 'all', '--limit', '500', '--json', 'number,headRefName,baseRefName,state']));
  const pick = (prs) => prs.find((p) => p.state === 'OPEN') ?? prs.find((p) => p.state === 'MERGED') ?? prs[0];
  const chain = [{ number: first.number, headRefName: first.head, baseRefName: first.base }];
  for (let p; (p = pick(list.filter((x) => x.headRefName === chain[0].baseRefName && !chain.some((c) => c.number === x.number)))); ) chain.unshift(p);
  for (let p; (p = pick(list.filter((x) => x.baseRefName === chain.at(-1).headRefName && !chain.some((c) => c.number === x.number)))); ) chain.push(p);
  return chain.map((p) => `${first.repo}#${p.number}`);
}

function init(targets, flags) {
  if (flags.stack) {
    if (targets.length !== 1) die('--stack takes one PR and finds the rest');
    targets = stackOf(targets[0]);
    console.error(`stack: ${targets.join(' → ')}`);
  }
  if (targets.length > 1) return initParts(targets, flags);
  const { diff, slug, meta } = fetchDiff(targets[0]);
  const files = splitPatch(diff);
  if (!files.length) die('the diff is empty');
  const dir = makeDir(slug, flags);
  fs.writeFileSync(path.join(dir, 'diff.patch'), diff);
  return writeTour(dir, files, meta, null, flags);
}

function makeDir(slug, flags) {
  const dir = flags.dir ? path.resolve(flags.dir) : path.join(workRoot(), slug);
  fs.mkdirSync(dir, { recursive: true });
  const root = path.dirname(dir);
  if (path.basename(root) === '.prtour' && !fs.existsSync(path.join(root, '.gitignore'))) fs.writeFileSync(path.join(root, '.gitignore'), '*\n');
  return dir;
}

// Several PRs (a stack, or any set) or ranges as one tour. Each part keeps its
// own diff against its own base; paths become "<key>:<path>".
function initParts(targets, flags) {
  const fetched = targets.map(fetchDiff);
  const parts = fetched.map(({ meta }, i) => ({ key: String(meta.number ?? `p${i + 1}`), title: meta.title, url: meta.url, number: meta.number, author: meta.author, base: meta.base, head: meta.head, state: meta.state, description: meta.description }));
  const dir = makeDir(`stack-${parts.map((p) => p.key).join('-')}`, flags);
  fs.mkdirSync(path.join(dir, 'parts'), { recursive: true });
  fetched.forEach(({ diff }, i) => fs.writeFileSync(path.join(dir, 'parts', `${parts[i].key}.patch`), diff));
  const files = fetched.flatMap(({ diff }, i) => splitPatch(diff, parts[i].key));
  if (!files.length) die('the diffs are empty');
  const m = fetched[0].meta;
  const meta = { title: `Stack: ${parts.map((p) => `#${p.key}`).join(' → ')}`, repo: m.repo, author: m.author, base: m.base, head: fetched.at(-1).meta.head };
  return writeTour(dir, files, meta, parts, flags);
}

function writeTour(dir, files, meta, parts, flags) {
  const tourPath = path.join(dir, 'tour.json');
  if (fs.existsSync(tourPath) && !flags.force) console.error(`kept existing ${tourPath} (--force to re-scaffold); diff refreshed`);
  else fs.writeFileSync(tourPath, `${JSON.stringify(scaffold(files, meta, parts), null, 2)}\n`);
  const tot = files.reduce((s, f) => s + f.additions + f.deletions, 0);
  console.log(`${rel(dir)}: ${files.length} files, ${tot} changed lines`);
  console.log(`  ${'kind'.padEnd(9)} ${'+add'.padEnd(6)} ${'-del'.padEnd(6)} hunks path`);
  for (const f of files) console.log(`  ${kindOf(f.name).padEnd(9)} +${String(f.additions).padEnd(5)} -${String(f.deletions).padEnd(5)} ${String(f.hunks.length).padEnd(5)} ${f.path}`);
  console.log(`\nnext: edit ${rel(tourPath)}, then \`prtour check\` and \`prtour render\` (or \`prtour open\`)`);
  return dir;
}

// ---- outputs --------------------------------------------------------------

async function render(dir, flags) {
  const r = load(dir);
  const fmt = flags.format ?? (flags.out?.endsWith('.md') ? 'md' : 'html');
  const text = fmt === 'md' ? renderMarkdown(r, { link: flags.link }) : fmt === 'term' ? renderTerminal(r, { color: process.stdout.isTTY && !flags['no-color'] }) : await renderHTML(r, flags);
  for (const w of r.warnings) console.error(`warning: ${w}`);
  if (fmt !== 'html' && !flags.out) return process.stdout.write(text);
  const out = path.resolve(flags.out ?? path.join(dir, 'index.html'));
  fs.writeFileSync(out, text);
  console.log(out);
}

async function show(dir, flags) {
  const images = await detect(flags.images ?? (flags['no-images'] ? 'none' : 'auto'));
  const text = renderTerminal(load(dir), { color: !flags['no-color'], width: Math.min(process.stdout.columns || 100, 120), images });
  // A pager would mangle image escapes, so pages with images print straight through.
  if (!process.stdout.isTTY || images) return process.stdout.write(text);
  const less = spawn('less', ['-RFX'], { stdio: ['pipe', 'inherit', 'inherit'] });
  less.on('error', () => process.stdout.write(text));
  less.stdin.end(text);
}

function check(dir) {
  const r = load(dir);
  const s = r.stats;
  const unsorted = r.chapters.at(-1)?.title === 'Unsorted' && r.warnings.some((w) => w.includes('in no chapter'));
  console.log(`${r.chapters.length - unsorted} chapters${unsorted ? ' (+ Unsorted)' : ''}, ${r.notes.length} notes, ${r.hidden.reduce((n, h) => n + h.files.length, 0)} hidden files, ${r.partial.length} partial; review ${s.shown}/${s.total} lines`);
  for (const w of r.warnings) console.log(`warning: ${w}`);
  process.exit(r.warnings.length ? 1 : 0);
}

function hunks(dir, only, flags) {
  for (const f of load(dir).files) {
    if (only.length && !only.some((p) => f.path.includes(p))) continue;
    console.log(`${f.path}  (${f.status}, +${f.additions} -${f.deletions})`);
    f.hunks.forEach((h, i) => {
      console.log(`  [${i}] old ${h.oldStart}-${h.oldStart + Math.max(0, h.oldLines.size - 1)}  new ${h.newStart}-${h.newStart + Math.max(0, h.newLines.size - 1)}  +${h.additions} -${h.deletions}  ${h.context}`);
      if (!flags.lines) return;
      // old/new line numbers, so notes can be anchored without counting by hand
      let o = h.oldStart;
      let n = h.newStart;
      for (const l of h.text.split('\n').slice(1)) {
        if (!l || l.startsWith('\\')) continue;
        console.log(`    ${l[0] === '+' ? '    ' : String(o).padStart(4)} ${l[0] === '-' ? '    ' : String(n).padStart(4)} ${l}`);
        if (l[0] !== '+') o++;
        if (l[0] !== '-') n++;
      }
    });
  }
}

function feedback(dir, flags) {
  const p = path.join(dir, 'feedback.json');
  if (flags.clear) { fs.rmSync(p, { force: true }); return console.log('cleared'); }
  const items = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
  if (!items.length) return console.log('no reviewer feedback yet');
  const notes = load(dir).notes;
  for (const c of items) {
    const where = c.file ? `${c.file}:${c.line}${c.side === 'old' ? ' (old side)' : ''}` : c.note ? `note ${notes[c.note - 1]?.label ?? c.note} (${notes[c.note - 1] ? `${notes[c.note - 1].file}:${notes[c.note - 1].line ?? ''}` : '?'})` : `chapter ${c.chapter}`;
    console.log(`- ${where}: ${c.body.replace(/\n/g, '\n  ')}`);
  }
}

async function serve(dir, flags) {
  const clients = new Set();
  let html = '';
  const build = async () => {
    try { html = await renderHTML(load(dir), { ...flags, live: true }); } catch (e) { html = `<pre>${String(e.stack).replace(/</g, '&lt;')}</pre><script>new EventSource('/events').onmessage=()=>location.reload()</script>`; }
    for (const res of clients) res.write('data: reload\n\n');
  };
  await build();
  let timer;
  fs.watch(dir, (_, name) => { if (name === 'tour.json' || name === 'diff.patch') { clearTimeout(timer); timer = setTimeout(build, 100); } });
  const fbPath = path.join(dir, 'feedback.json');
  const server = http.createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else if (req.url === '/feedback' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        const items = fs.existsSync(fbPath) ? JSON.parse(fs.readFileSync(fbPath, 'utf8')) : [];
        try { items.push(JSON.parse(body)); } catch { res.writeHead(400); return res.end(); }
        fs.writeFileSync(fbPath, `${JSON.stringify(items, null, 2)}\n`);
        console.log(`feedback: ${items.at(-1).body.split('\n')[0]}`);
        res.writeHead(204); res.end();
      });
    } else if (req.url === '/feedback' && req.method === 'DELETE') {
      fs.rmSync(fbPath, { force: true }); res.writeHead(204); res.end();
    } else {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    }
  });
  const port = Number(flags.port ?? 4777);
  server.on('error', (e) => (e.code === 'EADDRINUSE' && !flags.port ? server.listen(0, '127.0.0.1') : die(e.message)));
  server.on('listening', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    console.log(`${url}  (live: edits to ${rel(dir)}/tour.json reload the page; comments -> feedback.json)`);
    if (!flags['no-open']) spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  });
  server.listen(port, '127.0.0.1');
}

function skill(flags) {
  const text = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  if (!flags.install) return process.stdout.write(text);
  const out = typeof flags.install === 'string' ? flags.install : path.join('.claude', 'skills', 'prtour', 'SKILL.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`wrote ${out}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const { flags, pos } = parseArgs(rest);
const COMMANDS = {
  init: () => init(pos, flags),
  render: () => render(findDir(flags.dir ?? pos[0]), flags),
  show: () => show(findDir(flags.dir ?? pos[0]), flags),
  open: () => serve(findDir(flags.dir ?? pos[0]), flags),
  check: () => check(findDir(flags.dir ?? pos[0])),
  hunks: () => hunks(findDir(flags.dir), pos, flags),
  feedback: () => feedback(findDir(flags.dir ?? pos[0]), flags),
  skill: () => skill(flags),
};
if (cmd === '-h' || cmd === '--help' || cmd === 'help' || flags.help || flags.h) console.log(HELP);
else if (COMMANDS[cmd]) await COMMANDS[cmd]();
else {
  // Bare `prtour [target]`: one command from nothing to a review in the browser.
  const all = parseArgs(process.argv.slice(2));
  await serve(init(all.pos, all.flags), all.flags);
}
