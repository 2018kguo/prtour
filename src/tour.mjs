// tour.json: scaffold it from a diff, then resolve it against the diff into
// exactly what each renderer shows (chapters, numbered notes, hidden files).

const KINDS = [
  ['lockfile', /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|go\.sum|Gemfile\.lock|composer\.lock|flake\.lock|mix\.lock|Package\.resolved)$/],
  ['generated', /(^|\/)(dist|build|generated|__generated__|gen|vendor)\/|\.(min\.(js|css)|map|snap|pb\.go)$|_pb2\.pyi?$|(^|\/)meta\/[^/]*_snapshot\.json$|(^|\/)__snapshots__\//],
  ['test', /(^|\/)(__tests__|tests?|spec|e2e|fixtures?|testdata)\/|[._-](test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rs|rb|exs?)$|(^|\/)test_[^/]*\.py$|Tests?\.(swift|kt|java|cs)$/],
  ['migration', /(^|\/)(migrations?|migrate|drizzle|alembic|db\/schema)\/|\.sql$/],
  ['manifest', /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|Gemfile|requirements[^/]*\.txt|tsconfig[^/]*\.json|\.github\/.*\.ya?ml|Dockerfile|[^/]*\.(toml|ya?ml))$/],
  ['docs', /\.(md|mdx|rst|txt)$/i],
];
const HIDE_BY_DEFAULT = { lockfile: 'Lockfiles', generated: 'Generated files and snapshots', test: 'Tests' };

export const kindOf = (path) => KINDS.find(([, re]) => re.test(path))?.[0] ?? 'code';

export function scaffold(files, meta) {
  const by = (k) => files.filter((f) => kindOf(f.path) === k).map((f) => f.path);
  const chapter = (title, body, k) => (by(k).length ? [{ title, body, files: by(k) }] : []);
  return {
    ...meta,
    summary: '',
    steps: [],
    chapters: [
      ...chapter('Core change', 'TODO(agent): split by idea, core first; one chapter = one thing to understand.', 'code'),
      ...chapter('Schema and migrations', '', 'migration'),
      ...chapter('Manifests and config', '', 'manifest'),
      ...chapter('Docs', '', 'docs'),
    ],
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
  const warnings = [];
  const chapters = (tour.chapters ?? []).map((c, ci) => ({
    title: c.title || `Chapter ${ci + 1}`,
    body: c.body ?? c.explanation ?? '',
    entries: (c.files ?? []).flatMap((spec) => {
      const { path, hunks } = typeof spec === 'string' ? { path: spec } : spec;
      const matches = byPath.has(path) ? [path] : files.map((f) => f.path).filter((p) => globToRegExp(path).test(p));
      if (!matches.length) warnings.push(`chapter "${c.title}": ${path} is not in the diff`);
      return matches.filter((p) => !placed.has(p) && placed.add(p)).map((p) => {
        const file = byPath.get(p);
        const shown = hunks ?? file.hunks.map((_, i) => i);
        const bad = shown.filter((i) => !file.hunks[i]);
        if (bad.length) warnings.push(`${p}: hunk index ${bad.join(',')} out of range (file has ${file.hunks.length})`);
        return { file, hunks: hunks ? shown.filter((i) => file.hunks[i]) : null };
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
  const partial = chapters.flatMap((c) => c.entries).filter((e) => e.hunks)
    .map((e) => ({ file: e.file, hunks: e.file.hunks.map((_, i) => i).filter((i) => !e.hunks.includes(i)) }))
    .filter((p) => p.hunks.length);

  // Notes in array order are the reading order: "3/11".
  const entryOf = new Map(chapters.flatMap((c, ci) => c.entries.map((e) => [e.file.path, { e, ci }])));
  const notes = (tour.notes ?? []).map((n, i) => {
    const side = n.side === 'old' || n.side === 'deletions' ? 'deletions' : 'additions';
    const hit = entryOf.get(n.file);
    let anchored = false;
    if (!hit) warnings.push(`note ${i + 1}: ${n.file} is not shown in any chapter`);
    else if (n.line != null) {
      const hs = (hit.e.hunks ?? hit.e.file.hunks.map((_, j) => j)).map((j) => hit.e.file.hunks[j]);
      anchored = hs.some((h) => (side === 'additions' ? h.newLines : h.oldLines).has(n.line));
      if (!anchored) warnings.push(`note ${i + 1}: ${n.file}:${n.line} (${side === 'additions' ? 'new' : 'old'} side) is not in a shown hunk; shown at file top`);
    }
    return { ...n, n: i + 1, side, anchored, chapter: hit?.ci ?? null, title: n.title ?? '', body: n.body ?? '' };
  });
  notes.forEach((n) => { n.label = `${n.n}/${notes.length}`; });

  const count = (f, hs) => (hs ?? f.hunks.map((_, i) => i)).reduce((s, i) => s + (f.hunks[i]?.additions ?? 0) + (f.hunks[i]?.deletions ?? 0), 0);
  const total = files.reduce((s, f) => s + f.additions + f.deletions, 0);
  const shown = chapters.flatMap((c) => c.entries).reduce((s, e) => s + count(e.file, e.hunks), 0);
  return { tour, files, chapters, hidden, partial, notes, warnings, stats: { files: files.length, total, shown, additions: files.reduce((s, f) => s + f.additions, 0), deletions: files.reduce((s, f) => s + f.deletions, 0) } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import('node:assert')).strict;
  const { splitPatch } = await import('./patch.mjs');
  const mk = (p, n = 1) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n${Array.from({ length: n }, (_, i) => `@@ -${i * 10 + 1},1 +${i * 10 + 1},1 @@\n-x\n+y\n`).join('')}`;
  const files = splitPatch(mk('src/a.ts', 2) + mk('src/a.test.ts') + mk('bun.lock') + mk('src/b.ts'));
  assert.deepEqual(files.map((f) => kindOf(f.path)), ['code', 'test', 'lockfile', 'code']);
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
  console.log('tour.mjs ok');
}
