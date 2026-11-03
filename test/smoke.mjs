// End to end: init from a patch file, write a tour, check, render all three formats.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bin = path.join(import.meta.dirname, '..', 'bin', 'prtour.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prtour-'));
const run = (...args) => execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });

fs.writeFileSync(path.join(dir, 'x.patch'), `diff --git a/src/cache.ts b/src/cache.ts
--- a/src/cache.ts
+++ b/src/cache.ts
@@ -1,4 +1,5 @@
 export function get(key: string) {
-  return store[key];
+  const hit = store[key];
+  return hit && !hit.expired() ? hit : null;
 }
@@ -20,2 +21,3 @@ export function put() {
   x();
+  y();
 }
diff --git a/src/cache.test.ts b/src/cache.test.ts
new file mode 100644
--- /dev/null
+++ b/src/cache.test.ts
@@ -0,0 +1,2 @@
+test('expired', () => {});
+test('hit', () => {});
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1 +1 @@
-{"v":1}
+{"v":2}
`);

const t = path.join(dir, 't');
run('init', 'x.patch', '--dir', t);
const scaffolded = JSON.parse(fs.readFileSync(path.join(t, 'tour.json'), 'utf8'));
assert.deepEqual(scaffolded.hidden.map((h) => h.reason), ['Lockfiles', 'Tests']);

fs.writeFileSync(path.join(t, 'tour.json'), JSON.stringify({
  ...scaffolded,
  title: 'Expire cache hits',
  chapters: [{ title: 'Expiry on read', body: 'Reads skip expired entries.', files: [{ path: 'src/cache.ts', hunks: [0] }] }],
  notes: [{ file: 'src/cache.ts', line: 3, title: 'The check', body: 'Expired entries read as misses.' }],
}));
assert.match(run('check', t), /review 3\/8 lines/);

const html = fs.readFileSync(run('render', t).trim(), 'utf8');
assert.match(html, /shadowrootmode="open"/);
assert.match(html, /<div slot="annotation-additions-3"><div class="note" id="note-1"/);
assert.match(html, /1\/1<\/span><b>The check/);
assert.match(html, /Hidden hunks of shown files/);
assert.match(run('render', t, '--format', 'md'), /> \*\*1\/1\*\* `src\/cache.ts:3`/);
const term = run('show', t, '--no-color');
assert.match(term, /\s3 \+  return hit && !hit\.expired\(\) \? hit : null;\n\s+┃ 1\/1 The check/);

// A note on a hidden hunk is a warning, and check fails.
const tour = JSON.parse(fs.readFileSync(path.join(t, 'tour.json'), 'utf8'));
tour.notes.push({ file: 'src/cache.ts', line: 22, body: 'in hunk 1, not shown' });
fs.writeFileSync(path.join(t, 'tour.json'), JSON.stringify(tour));
assert.throws(() => run('check', t), (e) => e.status === 1 && /not in a shown hunk/.test(e.stdout));
// Several targets = one tour with a part per diff; the same path in two parts stays two files.
fs.writeFileSync(path.join(dir, 'y.patch'), fs.readFileSync(path.join(dir, 'x.patch'), 'utf8').split('diff --git a/src/cache.test.ts')[0]);
const st = path.join(dir, 'stack');
run('init', 'x.patch', 'y.patch', '--dir', st);
const stour = JSON.parse(fs.readFileSync(path.join(st, 'tour.json'), 'utf8'));
assert.deepEqual(stour.parts.map((p) => p.key), ['p1', 'p2']);
assert.deepEqual(stour.chapters.map((c) => c.title), ['#p1 Core change', '#p2 Core change']);
stour.notes = [{ file: 'p2:src/cache.ts', line: 3, body: 'second part' }];
fs.writeFileSync(path.join(st, 'tour.json'), JSON.stringify(stour));
assert.match(run('check', st), /0 partial; review 8\/12 lines/);
const shtml = fs.readFileSync(run('render', st).trim(), 'utf8');
assert.match(shtml, /<span slot="header-prefix" class="part">#p2<\/span>/);
assert.match(run('render', st, '--format', 'md'), /`#p2 src\/cache.ts:3`/);
console.log('smoke ok');
