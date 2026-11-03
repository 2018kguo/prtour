// Split a unified git patch into files and hunks, keeping the raw text so any
// subset of hunks can be re-rendered at its real line numbers.

// `part` namespaces paths for multi-PR tours: path "101:src/x.ts", name "src/x.ts".
export function splitPatch(text, part = null) {
  const files = [];
  const chunks = text.replace(/\r\n/g, '\n').split(/^(?=diff --git )/m).filter((c) => c.startsWith('diff --git '));
  for (const raw of chunks) {
    const lines = raw.split('\n');
    const firstHunk = lines.findIndex((l) => l.startsWith('@@'));
    const head = (firstHunk === -1 ? lines : lines.slice(0, firstHunk)).join('\n');
    const body = firstHunk === -1 ? '' : lines.slice(firstHunk).join('\n');
    const hunks = body ? body.split(/^(?=@@ )/m).map(parseHunk) : [];
    const meta = parseHeader(head);
    files.push({
      ...meta,
      name: meta.path,
      path: part ? `${part}:${meta.path}` : meta.path,
      part,
      head,
      hunks,
      binary: /^Binary files /m.test(head) || /^GIT binary patch/m.test(head),
      additions: hunks.reduce((n, h) => n + h.additions, 0),
      deletions: hunks.reduce((n, h) => n + h.deletions, 0),
    });
  }
  return files;
}

function unquote(p) {
  if (!p.startsWith('"')) return p;
  try { return JSON.parse(p); } catch { return p.slice(1, -1); }
}

function parseHeader(head) {
  const get = (re) => { const m = head.match(re); return m ? unquote(m[1].trim()) : null; };
  const minus = get(/^--- (?:a\/)?(.+)$/m);
  const plus = get(/^\+\+\+ (?:b\/)?(.+)$/m);
  const renameFrom = get(/^rename from (.+)$/m);
  const renameTo = get(/^rename to (.+)$/m);
  let path = renameTo ?? (plus && plus !== '/dev/null' ? plus : null) ?? (minus && minus !== '/dev/null' ? minus : null);
  if (!path) {
    // ponytail: binary/mode-only diffs have no ---/+++; split "a/x b/x" in half (paths match when not renamed)
    const m = head.match(/^diff --git (.+)$/m)[1];
    path = unquote(m.slice(m.length / 2 + 1)).replace(/^b\//, '');
  }
  const status = /^new file mode/m.test(head) ? 'added'
    : /^deleted file mode/m.test(head) ? 'deleted'
    : renameFrom ? 'renamed' : 'modified';
  return { path, oldPath: renameFrom ?? (status === 'added' ? null : path), status };
}

function parseHunk(text) {
  const m = text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/m);
  let oldLine = Number(m[1]);
  let newLine = Number(m[3]);
  const oldLines = new Set();
  const newLines = new Set();
  let additions = 0;
  let deletions = 0;
  for (const l of text.split('\n').slice(1)) {
    if (l.startsWith('+')) { newLines.add(newLine++); additions++; }
    else if (l.startsWith('-')) { oldLines.add(oldLine++); deletions++; }
    else if (l.startsWith(' ')) { oldLines.add(oldLine++); newLines.add(newLine++); }
  }
  return { text: text.endsWith('\n') ? text : `${text}\n`, header: m[0], context: m[5].trim(), oldStart: Number(m[1]), newStart: Number(m[3]), oldLines, newLines, additions, deletions };
}

// The part of a hunk inside new-side lines [from, to], as a hunk of its own at
// its real line numbers (null if it doesn't overlap). Deleted lines are kept
// when they sit inside the range.
export function sliceHunk(h, from, to) {
  let o = h.oldStart;
  let n = h.newStart;
  const kept = [];
  let first = null;
  for (const l of h.text.split('\n').slice(1)) {
    if (!l || l.startsWith('\\')) continue;
    const inside = n >= from && n <= to;
    if (inside) { first ??= { o, n }; kept.push(l); }
    if (l[0] !== '+') o++;
    if (l[0] !== '-') n++;
  }
  if (!first) return null;
  const oc = kept.filter((l) => l[0] !== '+').length;
  const nc = kept.filter((l) => l[0] !== '-').length;
  return parseHunk(`@@ -${oc ? first.o : Math.max(0, first.o - 1)},${oc} +${nc ? first.n : Math.max(0, first.n - 1)},${nc} @@ ${h.context}\n${kept.join('\n')}\n`);
}

export function filePatch(file, hunkIdx) {
  const hunks = hunkIdx ? hunkIdx.map((i) => file.hunks[i]).filter(Boolean) : file.hunks;
  return `${file.head}\n${hunks.map((h) => h.text).join('')}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import('node:assert')).strict;
  const p = `diff --git a/x.ts b/x.ts
index 1..2 100644
--- a/x.ts
+++ b/x.ts
@@ -1,3 +1,4 @@ ctx
 a
-b
+B
+c
 d
@@ -10,2 +11,2 @@
 e
-f
+F
diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
diff --git a/img.png b/img.png
new file mode 100644
Binary files /dev/null and b/img.png differ
`;
  const f = splitPatch(p);
  assert.equal(f.length, 3);
  assert.deepEqual([f[0].path, f[0].additions, f[0].deletions, f[0].hunks.length], ['x.ts', 3, 2, 2]);
  assert.ok(f[0].hunks[0].newLines.has(3) && f[0].hunks[1].newLines.has(12) && f[0].hunks[1].oldLines.has(11));
  assert.deepEqual([f[1].path, f[1].oldPath, f[1].status], ['new.txt', 'old.txt', 'renamed']);
  assert.deepEqual([f[2].path, f[2].status, f[2].binary], ['img.png', 'added', true]);
  assert.ok(filePatch(f[0], [1]).includes('@@ -10,2') && !filePatch(f[0], [1]).includes('@@ -1,3'));
  const sl = sliceHunk(f[0].hunks[0], 2, 3);
  assert.deepEqual([sl.header.split(' @@')[0], sl.additions, sl.deletions, [...sl.newLines]], ['@@ -2,1 +2,2', 2, 1, [2, 3]]);
  assert.equal(sliceHunk(f[0].hunks[0], 50, 60), null);
  const [nf] = splitPatch('diff --git a/n.ts b/n.ts\nnew file mode 100644\n--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,3 @@\n+a\n+b\n+c\n');
  assert.equal(sliceHunk(nf.hunks[0], 2, 3).header, '@@ -0,0 +2,2 @@ ');
  const [pf] = splitPatch(p, '101');
  assert.deepEqual([pf.path, pf.name, pf.part], ['101:x.ts', 'x.ts', '101']);
  console.log('patch.mjs ok');
}
