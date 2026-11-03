import { lint, stripCode } from './style.mjs';

// tour.json: scaffold it from a diff, then resolve it against the diff into
// exactly what each renderer shows (chapters, numbered notes, hidden files).

const KINDS = [
  ['lockfile', /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|go\.sum|Gemfile\.lock|composer\.lock|flake\.lock|mix\.lock|Package\.resolved)$/],
  ['generated', /(^|\/)(dist|build|generated|__generated__|gen|vendor)\/|\.(min\.(js|css)|map|snap|pb\.go)$|[./](gen|generated)\.[a-z]+$|_pb2\.pyi?$|(^|\/)meta\/([^/]*_snapshot|_journal)\.json$|(^|\/)__snapshots__\//],
  ['test', /(^|\/)(__tests__|tests?|spec|e2e|fixtures?|testdata)\/|[._-](test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rs|rb|exs?)$|(^|\/)test_[^/]*\.py$|Tests?\.(swift|kt|java|cs)$/],
  ['migration', /(^|\/)(migrations?|migrate|drizzle|alembic|db\/schema)\/|\.sql$/],
  ['manifest', /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|Gemfile|requirements[^/]*\.txt|tsconfig[^/]*\.json|\.github\/.*\.ya?ml|Dockerfile|[^/]*\.(toml|ya?ml))$/],
  ['docs', /\.(md|mdx|rst|txt)$/i],
];
export const BUDGET = { notes: 8, chapters: 5, lines: 400 };
const HIDE_BY_DEFAULT = { lockfile: 'Lockfiles', generated: 'Generated files and snapshots', test: 'Tests', manifest: 'Manifests and config (summarize them in `skipped`)' };

export const kindOf = (path) => KINDS.find(([, re]) => re.test(path))?.[0] ?? 'code';

export function scaffold(files, meta, parts = null) {
  const by = (k, part) => files.filter((f) => kindOf(f.name) === k && (part === undefined || f.part === part)).map((f) => f.path);
  const kinds = [['Core change', 'TODO(agent): split by idea, core first; one chapter = one thing to understand.', 'code'], ['Schema and migrations', '', 'migration'], ['Docs', '', 'docs']];
  // A stack reads PR by PR, bottom first; within a PR, core before supporting.
  const chapters = (parts ?? [{ key: undefined }]).flatMap((p) => kinds
    .filter(([, , k]) => by(k, p.key).length)
    .map(([title, body, k]) => ({ title: p.key ? `#${p.key} ${title}` : title, body, files: by(k, p.key) })));
  return {
    ...meta,
    ...(parts ? { parts } : {}),
    summary: '',
    steps: [],
    chapters,
    notes: [],
    hidden: Object.entries(HIDE_BY_DEFAULT).filter(([k]) => by(k).length).map(([k, reason]) => ({ reason, files: by(k) })),
    skipped: '',
  };
}

export function globToRegExp(glob) {
  const re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/|\*\*|\*|\?/g, (m) => ({ '?': '[^/]', '*': '[^/]*', '**': '.*' })[m] ?? '(.*/)?');
  return new RegExp(`^${re}$`);
}

// Resolve tour.json against the parsed diff. Never drops a file: anything the
// tour forgot lands in an "Unsorted" chapter and in `warnings`.
export function resolve(tour, files) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const placed = new Set();
  const taken = new Map();
  const label = (key) => { const f = byPath.get(key); return f?.part ? `#${f.part} ${f.name}` : key; };
  const warnings = [];
  const chapters = (tour.chapters ?? []).map((c, ci) => ({
    title: c.title || `Chapter ${ci + 1}`,
    body: c.body ?? c.explanation ?? '',
    entries: (c.files ?? []).flatMap((spec) => {
      const { path, hunks } = typeof spec === 'string' ? { path: spec } : spec;
      const matches = byPath.has(path) ? [path] : files.map((f) => f.path).filter((p) => globToRegExp(path).test(p));
      if (!matches.length) warnings.push(`chapter "${c.title}": ${path} is not in the diff`);
      return matches.flatMap((p) => {
        // A file may be split across chapters by hunk; each hunk shows once.
        const file = byPath.get(p);
        const t = taken.get(p) ?? new Set();
        const bad = (hunks ?? []).filter((i) => !file.hunks[i]);
        if (bad.length) warnings.push(`${p}: hunk index ${bad.join(',')} out of range (file has ${file.hunks.length})`);
        const want = hunks ? hunks.filter((i) => file.hunks[i]) : file.hunks.map((_, i) => i);
        const free = want.filter((i) => !t.has(i));
        if (hunks && free.length < want.length) warnings.push(`${p}: hunk(s) ${want.filter((i) => t.has(i)).join(',')} already shown in an earlier chapter`);
        if (file.hunks.length ? !free.length : placed.has(p)) return [];
        free.forEach((i) => t.add(i));
        taken.set(p, t);
        placed.add(p);
        return [{ file, hunks: free.length === file.hunks.length ? null : free }];
      });
    }),
  }));

  const hidden = (tour.hidden ?? []).map((h) => ({
    reason: h.reason ?? 'Hidden',
    files: (h.files ?? []).flatMap((g) => files.map((f) => f.path).filter((p) => p === g || globToRegExp(g).test(p)))
      .filter((p) => !placed.has(p) && placed.add(p)).map((p) => byPath.get(p)),
  })).filter((h) => h.files.length);

  const unsorted = files.filter((f) => !placed.has(f.path));
  if (unsorted.length) {
    warnings.push(`${unsorted.length} file(s) in no chapter and not hidden: ${unsorted.map((f) => f.path).join(', ')}`);
    chapters.push({ title: 'Unsorted', body: 'Files the tour did not place.', entries: unsorted.map((file) => ({ file, hunks: null })) });
  }

  // Partially shown files: the rest of their hunks are hidden, and said so.
  const partial = [...taken].map(([p, t]) => ({ file: byPath.get(p), hunks: byPath.get(p).hunks.map((_, i) => i).filter((i) => !t.has(i)) }))
    .filter((p) => p.hunks.length);

  // Notes in array order are the reading order: "3/11".
  const entriesOf = new Map();
  chapters.forEach((c, ci) => c.entries.forEach((e) => entriesOf.set(e.file.path, [...(entriesOf.get(e.file.path) ?? []), { e, ci }])));
  const shownHunks = (e) => (e.hunks ?? e.file.hunks.map((_, j) => j)).map((j) => e.file.hunks[j]);
  const notes = (tour.notes ?? []).map((n, i) => {
    const side = n.side === 'old' || n.side === 'deletions' ? 'deletions' : 'additions';
    const hits = entriesOf.get(n.file) ?? [];
    const inLine = (x) => n.line != null && shownHunks(x.e).some((h) => (side === 'additions' ? h.newLines : h.oldLines).has(n.line));
    const hit = hits.find(inLine) ?? hits[0];
    const anchored = !!hit && inLine(hit);
    if (!hit) warnings.push(`note ${i + 1}: ${n.file} is not shown in any chapter`);
    else if (n.line != null) {
      if (!anchored) warnings.push(`note ${i + 1}: ${n.file}:${n.line} (${side === 'additions' ? 'new' : 'old'} side) is not in a shown hunk; shown at file top`);
    }
    return { ...n, n: i + 1, side, anchored, chapter: hit?.ci ?? null, entry: hit?.e ?? null, title: n.title ?? '', body: n.body ?? '', where: `${label(n.file)}${n.line != null ? `:${n.line}` : ''}` };
  });
  notes.forEach((n) => { n.label = `${n.n}/${notes.length}`; });
  notes.forEach((n, i) => {
    const prev = notes[i - 1];
    if (prev && n.chapter != null && prev.chapter != null && n.chapter < prev.chapter) warnings.push(`note ${n.n} (chapter ${n.chapter + 1}) comes after note ${prev.n} (chapter ${prev.chapter + 1}); notes are numbered in array order, so put them in reading order`);
  });

  const count = (f, hs) => (hs ?? f.hunks.map((_, i) => i)).reduce((s, i) => s + (f.hunks[i]?.additions ?? 0) + (f.hunks[i]?.deletions ?? 0), 0);
  const total = files.reduce((s, f) => s + f.additions + f.deletions, 0);
  const shown = chapters.flatMap((c) => c.entries).reduce((s, e) => s + count(e.file, e.hunks), 0);
  // The page is for human alignment, not a walkthrough: keep it short and plain.
  const realChapters = chapters.filter((c) => c.title !== 'Unsorted').length;
  const over = [
    notes.length > BUDGET.notes && `${notes.length} notes (budget ${BUDGET.notes})`,
    realChapters > BUDGET.chapters && `${realChapters} chapters (budget ${BUDGET.chapters})`,
    shown > BUDGET.lines && `${shown} lines shown (budget ${BUDGET.lines})`,
  ].filter(Boolean);
  if (over.length && !tour.allowLarge) warnings.push(`too much to review: ${over.join(', ')}. Hide what follows from the decisions, or set "allowLarge": "<why this PR needs it>"`);
  const texts = [
    ['summary', [tour.summary ?? ''].flat().join('\n\n'), 500],
    ...(tour.steps ?? []).map((x, i) => [`step ${i + 1}`, x, 160]),
    ...(tour.chapters ?? []).flatMap((c, i) => [[`chapter ${i + 1} title`, c.title, 80], [`chapter ${i + 1} body`, c.body ?? c.explanation, 280]]),
    ...notes.flatMap((n) => [[`note ${n.n} title`, n.title, 70], [`note ${n.n}`, n.body, 320]]),
    ['skipped', tour.skipped, 300],
  ];
  for (const [where, text, max] of texts) {
    for (const hit of lint(text)) warnings.push(`writing, ${where}: ${hit}`);
    if (stripCode(text).length > max) warnings.push(`writing, ${where}: ${stripCode(text).length} chars (max ${max}); say less`);
  }

  const parts = (tour.parts ?? []).map((p) => {
    const fs = files.filter((f) => f.part === p.key);
    return { ...p, files: fs.length, additions: fs.reduce((n, f) => n + f.additions, 0), deletions: fs.reduce((n, f) => n + f.deletions, 0) };
  });
  return { tour, files, parts, label, chapters, hidden, partial, notes, warnings, stats: { files: files.length, total, shown, additions: files.reduce((s, f) => s + f.additions, 0), deletions: files.reduce((s, f) => s + f.deletions, 0) } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import('node:assert')).strict;
  const { splitPatch } = await import('./patch.mjs');
  const mk = (p, n = 1) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n${Array.from({ length: n }, (_, i) => `@@ -${i * 10 + 1},1 +${i * 10 + 1},1 @@\n-x\n+y\n`).join('')}`;
  const files = splitPatch(mk('src/a.ts', 2) + mk('src/a.test.ts') + mk('bun.lock') + mk('src/b.ts'));
  assert.deepEqual(files.map((f) => kindOf(f.path)), ['code', 'test', 'lockfile', 'code']);
  assert.deepEqual(['src/routeTree.gen.ts', 'x/endpoints.generated.json', 'package.json'].map(kindOf), ['generated', 'generated', 'manifest']);
  assert.ok(globToRegExp('src/**/*.ts').test('src/x/y.ts') && globToRegExp('src/**/*.ts').test('src/y.ts') && !globToRegExp('*.ts').test('src/y.ts') && globToRegExp('a/**').test('a/b/c.ts'));
  const r = resolve({
    chapters: [{ title: 'A', files: [{ path: 'src/a.ts', hunks: [1] }] }],
    hidden: [{ reason: 'Tests', files: ['**/*.test.ts'] }],
    notes: [{ file: 'src/a.ts', line: 11, body: 'ok' }, { file: 'src/a.ts', line: 1, body: 'hidden hunk' }],
  }, files);
  assert.deepEqual(r.chapters.map((c) => c.title), ['A', 'Unsorted']);
  assert.deepEqual(r.chapters[1].entries.map((e) => e.file.path), ['bun.lock', 'src/b.ts']);
  assert.deepEqual(r.partial.map((p) => [p.file.path, p.hunks]), [['src/a.ts', [0]]]);
  assert.deepEqual(r.notes.map((n) => [n.label, n.anchored]), [['1/2', true], ['2/2', false]]);
  assert.equal(r.warnings.length, 2);
  assert.deepEqual([r.stats.total, r.stats.shown], [10, 6]);
  const split = resolve({ chapters: [{ files: [{ path: 'src/a.ts', hunks: [1] }] }, { files: ['src/a.ts', 'src/b.ts'] }], hidden: [{ files: ['**'] }], notes: [{ file: 'src/a.ts', line: 1 }] }, files);
  assert.deepEqual(split.chapters.map((c) => c.entries.map((e) => [e.file.path, e.hunks])), [[['src/a.ts', [1]]], [['src/a.ts', [0]], ['src/b.ts', null]]]);
  assert.deepEqual([split.partial.length, split.notes[0].chapter, split.notes[0].anchored, split.warnings], [0, 1, true, []]);
  console.log('tour.mjs ok');
}
