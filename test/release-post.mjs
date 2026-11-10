// Release-post recaps: headline and label checks, the glossary, top stories,
// embedded media within a budget, share tags, and the thread draft.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { categoryOnly, codeTerms, linkTerms, postLength, renderRecapHTML, resolveRecap } from '../src/recap.mjs';

const bin = path.join(import.meta.dirname, '..', 'bin', 'prtour.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prtour-post-'));
const run = (...args) => execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
const check = () => { try { return run('check', dir); } catch (e) { return e.stdout; } };

// Category-only titles: flagged only when the last word is a category noun. Outcomes pass in any
// wording or language (an independent review's set); non-Latin titles are never flagged.
const OUTCOMES = ['Login works with SSO', 'Dark mode arrives', 'Builds are cached', 'Uploads resume after a dropped connection', 'Users can export to CSV', 'Payments retry automatically',
  'Docs site migrated to Astro', 'Android crash on startup resolved', 'Memory leak plugged', 'Webhooks deliver in order', 'Search understands typos', 'Notifications batch by default',
  'Dropped Python 3.8', 'Rewrote the parser in Rust', 'Sidebar collapses on mobile', 'Onboarding takes half the steps', 'Deploys roll back on failure', 'Editor supports Vim keys',
  'Tests run in parallel', 'Bumped React', 'Shipped the new billing page', 'Removed legacy API', 'Images lazy-load', 'Errors include a request ID', 'Copy button on code blocks',
  'Offline mode', 'Faster cold starts', 'Page renders', 'Ranged reads', 'PDFs 5× faster', 'Restores come back exact',
  "Les PDF s'ouvrent 5 fois plus vite", 'La recherche ne gèle plus', 'Suche friert nicht mehr ein', 'Exportación a CSV disponible', '検索が速くなった', '登录支持单点登录', 'Поиск больше не зависает', '性能'];
for (const t of OUTCOMES) assert.ok(!categoryOnly(t), t);
for (const t of ['Performance', 'Billing', 'Authentication improvements', 'Refactoring', 'Dependency updates', 'Mobile layout', 'Database migrations', 'Accessibility', 'CI pipeline', 'Bug fixes', 'Chat runtime', 'OCR, CI and infra', 'Web and enterprise']) assert.ok(categoryOnly(t), t);

// Code-looking names: backticks, @scope/pkg, camelCase, SCREAMING_CASE, file names, and kebab-case with a digit or 3+ parts.
const TERMS = [
  ['The new error-boundary component catches render crashes.', []], ['We fixed a long-standing bug in the drop-down menu.', []],
  ['A well-designed, user-facing, high-quality release.', []], ['This is a must-have for mid-size teams and small-business owners.', []],
  ['It ships a state-of-the-art, real-time, two-factor login.', []], ['Set the .btn-primary class or use text-gray-500 and flex-col.', ['text-gray-500']],
  ['Read more at https://example.com/blog/new-release-notes or docs.example.com/getting-started.', []], ['See github.com/acme/my-repo for code.', []],
  ['The look-up table is now three-way merged with no hand-off.', []], ['Upgraded from v2 to v3 with zero-downtime deploys.', []],
  ['Our year-over-year growth is twenty-five percent.', []], ['It is a client-server, peer-to-peer, open-source tool.', []], ['Use the `--dry-run` flag.', ['--dry-run']],
  ['Configure via max-age and no-cache headers.', []], ['A top-level, built-in, first-party, third-party integration.', []], ['Email the x-ray team at e-mail@acme.io.', []],
  ['It uses useEffect and getServerSideProps on macOS and iOS.', ['useEffect', 'getServerSideProps']], ['Set ENABLE_FOO=1 in config.yaml.', ['ENABLE_FOO', 'config.yaml']],
  ['We adopted @tanstack/react-query.', ['@tanstack/react-query']], ['The new lite-index-v2 and `recto` engine.', ['lite-index-v2', 'recto']],
];
for (const [text, want] of TERMS) assert.deepEqual(codeTerms(text), want, text);

// First use of a glossary term links to its entry, never inside a link, and only once.
const ctx = { glossary: [{ term: 'lite-index', id: 'g-lite-index', what: 'A table of pages.' }], seen: new Set() };
assert.equal(linkTerms('<p><a href="#x">lite-index</a> then the lite-index and <code>lite-index</code></p>', ctx), '<p><a href="#x">lite-index</a> then the <a class="term" href="#g-lite-index" title="A table of pages.">lite-index</a> and <code>lite-index</code></p>');
assert.equal(linkTerms('<p>lite-index again</p>', ctx), '<p>lite-index again</p>');
assert.equal(linkTerms('<p>Uses <code>lite-index</code>.</p>', { ...ctx, seen: new Set() }), '<p>Uses <a class="term" href="#g-lite-index" title="A table of pages."><code>lite-index</code></a>.</p>');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
fs.mkdirSync(path.join(dir, 'media'));
fs.writeFileSync(path.join(dir, 'media', 'shot.png'), png);
fs.writeFileSync(path.join(dir, 'media', 'clip.mp4'), Buffer.from('not really a video'));
fs.writeFileSync(path.join(dir, 'media', 'clip.poster.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
fs.writeFileSync(path.join(dir, 'media', 'large.png'), Buffer.concat([png, Buffer.alloc(600e3)]));
const pr = (number, mergedAt) => ({ number, title: `t${number}`, url: `https://example.com/pr/${number}`, mergedAt, additions: 10, deletions: 2, files: 1, oneLiner: `Change ${number}.` });
const good = {
  kind: 'recap', title: 'Acme 2.0', url: 'https://example.com/acme/2.0/', since: '2026-10-01', until: '2026-10-07',
  about: 'Acme is a notes app that keeps notebooks on your own disk.',
  summary: 'Notebooks opened slowly. Now they open at once.',
  hero: { stories: [{ workstream: 'Notebooks open 6× faster', why: 'Big notebooks open before you reach for the mouse.', media: [{ src: 'media/clip.mp4', caption: 'Opening a notebook.' }] }, { workstream: 'See who is typing' }],
    tldr: ['Notebooks open in 0.4 s thanks to the `lite-index`.', 'Live cursors show who is typing.'] },
  glossary: [{ term: 'lite-index', what: 'A small table of where each page starts.', why: 'Opening reads it instead of the whole file.' }],
  workstreams: [
    { kind: 'fix', label: 'Search stops freezing', headline: 'Search no longer freezes on 2 GB notebooks', symptom: 'Typing in search froze the window.', now: 'The window stays responsive.', prs: [3] },
    { kind: 'improvement', label: 'Notebooks open 6× faster', headline: 'Notebooks open in 0.4 s, down from 2.6 s', symptom: 'Big notebooks showed a spinner.', now: 'They open at once, because the lite-index lists every page.', media: [{ src: 'media/clip.mp4', caption: 'The same clip, in its section.' }], prs: [1] },
    { kind: 'feature', label: 'See who is typing', headline: 'Live cursors show who is editing each page', symptom: 'Two people could edit one paragraph unaware.', now: 'Each cursor shows with a name.', demo: ['Open a notebook on two devices.'], media: [{ src: 'media/shot.png', caption: 'Two cursors on one page.' }], prs: [2] },
  ],
  prs: [pr(1, '2026-10-02T10:00:00Z'), pr(2, '2026-10-03T10:00:00Z'), pr(3, '2026-10-04T10:00:00Z')],
};
const write = (rc) => fs.writeFileSync(path.join(dir, 'recap.json'), JSON.stringify(rc));
write(good);
assert.equal(check(), '3 PRs, 3 workstreams, 3 days with merges\n');

// The lead story's kind leads the page, and the lead story leads its group.
const r = resolveRecap(structuredClone(good));
assert.deepEqual(r.ws.map((w) => w.name), ['Notebooks open 6× faster', 'Search stops freezing', 'See who is typing']);
assert.deepEqual(r.stories.map((s) => s.headline), ['Notebooks open in 0.4 s, down from 2.6 s', 'Live cursors show who is editing each page']);
assert.deepEqual(resolveRecap({ ...structuredClone(good), order: ['feature'] }).ws.map((w) => w.kind), ['feature', 'improvement', 'fix']);

const html = fs.readFileSync(run('render', dir).trim(), 'utf8');
assert.match(html, /<section class="top-stories"[^>]*><article class="story lead"><h2><a href="#ws-1">Notebooks open in 0\.4 s, down from 2\.6 s<\/a><\/h2>/);
assert.match(html, /<div class="story-grid"><article class="story"><h3><a href="#ws-3">Live cursors/);
// A clip is embedded once: the second use points at the first, with a <noscript> link to it. It autoplays muted without scripts.
assert.match(html, /<figure class="fig story-fig" id="media-m1"><video src="data:video\/mp4;base64,[^"]+" data-m-src="m1" poster="data:image\/jpeg;base64,[^"]+" muted autoplay loop playsinline preload="metadata" data-clip/);
assert.match(html, /<figure class="fig"><video data-same-src="m1" poster="data:image\/jpeg[^"]+" muted autoplay[^>]*><\/video><noscript><a href="#media-m1">See it where it first appears<\/a><\/noscript>/);
assert.equal(html.match(/base64,bm90IHJlYWxseSBhIHZpZGVv/g).length, 1);
// A small still is embedded at each use, so a page with scripts off still shows every image.
assert.equal(html.match(/base64,iVBOR/g).length, 2);
for (const tag of html.match(/<img class="zoomable"[^>]*>/g)) assert.match(tag, /src="data:image\//, tag);
assert.match(html, /<h2>Meet the new pieces<\/h2><dl><div id="g-lite-index"><dt>lite-index<\/dt>/);
assert.equal(html.match(/class="term"/g).length, 1);
assert.match(html, /<meta property="og:image" content="https:\/\/example\.com\/acme\/2\.0\/media\/clip\.poster\.jpg">/);
assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
assert.match(html, /<meta property="og:description" content="Acme is a notes app that keeps notebooks on your own disk\. Big notebooks open before you reach for the mouse\.">/);
// The PDF gets the poster frame in place of the clip.
const print = await renderRecapHTML(resolveRecap(Object.assign(structuredClone(good), { hero: { ...good.hero, stories: [{ ...good.hero.stories[0], media: [{ src: 'media/clip.mp4', caption: 'Opening a notebook.', abs: path.join(dir, 'media/clip.mp4'), posterAbs: path.join(dir, 'media/clip.poster.jpg') }] }] } })), { print: true });
assert.match(print, /<figure class="fig story-fig"><img src="data:image\/jpeg;base64,[^"]+" alt="Opening a notebook\."><figcaption>Opening a notebook\.<\/figcaption>/);
assert.doesNotMatch(print, /<video/);

// A large still (over 500 KB) used twice is embedded once and shared.
const large = structuredClone(good);
large.workstreams[2].media = [{ src: 'media/large.png', caption: 'Big.', abs: path.join(dir, 'media/large.png') }];
const lhtml = await renderRecapHTML(resolveRecap(large));
assert.equal(lhtml.match(/data:image\/png;base64,/g).length, 1);
assert.match(lhtml, /<img class="zoomable" data-same-src="m\d+"[^>]*><noscript><a href="#media-m\d+">/);

// A top story with no screenshot or clip shows a compact copy of its section's chart.
const charted = structuredClone(good);
charted.workstreams[1].chart = { title: 'Median open time', unit: ' s', points: [{ x: 'before', y: 2.6 }, { x: 'after', y: 0.4 }] };
charted.hero.stories[0] = { workstream: 'Notebooks open 6× faster' };
delete charted.workstreams[1].media;
const cr = resolveRecap(charted);
assert.ok(!cr.warnings.some((w) => w.includes('no visual')), cr.warnings.join('\n'));
const chtml = await renderRecapHTML(cr);
assert.ok(!cr.suggestions.some((w) => w.includes('no visual')), cr.suggestions.join('\n'));
assert.match(chtml, /<article class="story lead">.*?<figure class="fig story-fig story-chart"><div class="ch-read"[^>]*>Median open time<\/div><svg class="chart" viewBox="0 0 440 230"/s);
assert.match(chtml, /<section class="ws" id="ws-1"[\s\S]*<svg class="chart" viewBox="0 0 760 260"/);

// Markdown points at the files.
const md = run('render', dir, '--format', 'md');
assert.match(md, /\[!\[Opening a notebook\.\]\(media\/clip\.poster\.jpg\)\]\(media\/clip\.mp4\)/);
assert.match(md, /!\[Two cursors on one page\.\]\(media\/shot\.png\)/);
assert.match(md, /### Meet the new pieces\n\n- \*\*lite-index\*\*: A small table/);

// Thread: an opener, a post per top story with its media, the rest, then the link; every post fits.
const thread = run('render', dir, '--format', 'thread');
const posts = thread.trim().split(/\n\n(?=\d+\/\d+ \()/);
assert.equal(posts.length, 5);
assert.match(posts[1], /^2\/5 \(\d+ chars\)\nNotebooks open in 0\.4 s, down from 2\.6 s\n\nBig notebooks open before you reach for the mouse\.\n\[attach media\/clip\.mp4\]$/);
assert.match(posts[2], /Live cursors[\s\S]*\[attach media\/shot\.png\]$/);
assert.match(posts[4], /https:\/\/example\.com\/acme\/2\.0\/$/);
for (const p of posts) assert.ok(postLength(p.split('\n').slice(1).filter((l) => !l.startsWith('[attach')).join('\n')) <= 280, p);
// Weighted like X: CJK and emoji count 2, links and bare domains 23; long posts are cut on grapheme boundaries.
assert.deepEqual(['hello', '検索', '👍🏽', '👨‍👩‍👧', 'see example.com/x and https://a.b/c'].map(postLength), [5, 4, 2, 2, 55]);
for (const about of ['x '.repeat(200), '検索が速くなった。'.repeat(40), '👨‍👩‍👧 '.repeat(200)]) {
  write({ ...good, about });
  const t = run('render', dir, '--format', 'thread');
  assert.ok(t.match(/^\d+\/\d+ \((\d+) chars\)/gm).every((l) => Number(l.match(/\((\d+)/)[1]) <= 280), t);
  assert.doesNotMatch(t, /\uFFFD|\u200D\n|\u200D…/);
}

// A url without a scheme doesn't crash render; share tags and the thread skip it, and check says so.
write({ ...good, url: 'example.com/acme' });
const nohtml = fs.readFileSync(run('render', dir).trim(), 'utf8');
assert.doesNotMatch(nohtml, /og:url/);
assert.match(nohtml, /<meta property="og:image" content="media\/clip\.poster\.jpg">/);
assert.match(run('check', dir), /url "example\.com\/acme" is not an absolute link/);
assert.match(run('render', dir, '--format', 'thread'), /<link to the page>/);
write({ ...good, url: undefined });
assert.match(run('check', dir), /no "url": say where the page will be hosted/);

// --format term piped to a file or pipe has no ANSI codes.
assert.doesNotMatch(run('render', dir, '--format', 'term'), /\x1b\[/);

// A recap written for 0.1.3 (title/name/images, no about or hero) still passes check; advice comes as suggestions.
write({ kind: 'recap', title: 'Week', since: '2026-10-01', until: '2026-10-07', summary: 'Two things shipped.', prs: good.prs,
  workstreams: [{ kind: 'fix', name: 'Search', title: 'Search: 3 freezes a day before, none now', symptom: 'Search froze.', now: 'It does not.', prs: [1, 2, 3], images: [{ src: 'media/shot.png', caption: 'Search.' }] }] });
const old = run('check', dir);
assert.match(old, /^3 PRs, 1 workstreams, 3 days with merges\n\nSuggestions:\n- no "about"/);

// Checks: category titles, unexplained names, too many top stories, media over budget, clips without posters.
const bad = structuredClone(good);
bad.workstreams[0].label = 'Search performance';
bad.workstreams[0].headline = 'Search with `ripgrep-lite`: 3 s to 40 ms';
bad.glossary = [];
bad.hero.stories.push({ workstream: 'Search performance' }, { headline: 'Four' }, { headline: 'Five' });
bad.mediaBudgetMB = 0.000001;
fs.rmSync(path.join(dir, 'media', 'clip.poster.jpg'));
write(bad);
const out = run('check', dir);
assert.match(out, /"Search performance" label "Search performance" only names an area/);
assert.match(out, /: "ripgrep-lite" looks like a code or package name/);
assert.match(out, /tldr: "lite-index" looks like a code or package name/);
assert.match(out, /hero: 5 top stories; keep the 2 to 4 biggest/);
assert.match(out, /Suggestions:/);
assert.doesNotMatch(out, /^warning:/m);
assert.match(out, /media: 0\.0 MB embedded \(budget 0\.000001 MB; largest: shot\.png 0\.0 MB, clip\.mp4/);
assert.match(out, /clip media\/clip\.mp4 has no poster frame/);

// `prtour media` names: letters in any script are kept, a taken name gets a suffix, nothing is overwritten.
const { outName } = await import('../src/media.mjs');
const taken = new Set();
const od = path.join(dir, 'names');
assert.equal(path.basename(outName('/x/a.png', od, 'webp', taken).base), 'a');
assert.deepEqual(outName('/y/a.jpg', od, 'webp', taken), { base: path.join(od, 'a-2'), renamed: true });
assert.equal(path.basename(outName('/x/é 日本 (1).png', od, 'webp', taken).base), 'é-日本-1');
assert.equal(path.basename(outName('/x/???.png', od, 'webp', taken).base), 'media');
fs.mkdirSync(od);
fs.writeFileSync(path.join(od, 'b.mp4'), '');
assert.equal(path.basename(outName('/x/b.mov', od, 'mp4', new Set()).base), 'b-2');
assert.equal(path.basename(outName('/x/b.mov', od, 'mp4', new Set(), true).base), 'b');

// `prtour media`, when ffmpeg is here: a still at most 1600 px wide, a muted mp4 at most 1280 px wide, and a poster.
let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }
if (ffmpeg) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=2000x1000:rate=1', '-frames:v', '1', path.join(dir, 'big.png')]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=10', '-f', 'lavfi', '-i', 'sine', '-t', '1', '-c:a', 'aac', '-pix_fmt', 'yuv420p', path.join(dir, 'demo.mov')]);
  const log = run('media', 'big.png', 'demo.mov', '-o', 'out');
  assert.match(log, /"src": "out\/demo\.mp4"/);
  // --dir: written into <recap>/media, with src relative to the recap folder; a second run never overwrites.
  fs.mkdirSync(path.join(dir, 'rc'));
  assert.match(run('media', 'big.png', '--dir', 'rc'), /src is relative to the recap folder rc[\s\S]*"src": "media\/big\.(webp|jpg)"/);
  assert.match(run('media', 'big.png', '--dir', 'rc'), /"src": "media\/big-2\.(webp|jpg)"/);
  const still = fs.readdirSync(path.join(dir, 'out')).find((f) => /^big\.(webp|jpg)$/.test(f));
  const { imageWidth } = await import('../src/media.mjs');
  assert.equal(imageWidth(fs.readFileSync(path.join(dir, 'out', still))), 1600);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width', '-of', 'csv=p=0', path.join(dir, 'out', 'demo.mp4')], { encoding: 'utf8' }).trim();
  assert.equal(probe, 'h264,video,1280');
  assert.ok(fs.existsSync(path.join(dir, 'out', 'demo.poster.jpg')));
}
console.log(`release-post ok${ffmpeg ? '' : ' (no ffmpeg: media compression skipped)'}`);

// ---- feedback from building a real release post ----------------------------
// Print: the lead story may break, and its visual is capped so it fits page 1.
assert.match(print, /\.story\.lead\{break-inside:auto\}\.story\.lead \.fig img\{max-height:80mm\}/);
// The overview lists don't repeat the part headings.
assert.match(html, /<h2>What got better<\/h2>/);
assert.doesNotMatch(html, /<section class="ov"><h2>Improvements<\/h2>/);

// Visual cap is 3 per workstream.
const vis = (n) => resolveRecap({ ...structuredClone(good), workstreams: [{ ...good.workstreams[0], media: Array.from({ length: n }, () => ({ src: 'media/shot.png' })) }], hero: undefined }).warnings.some((w) => /visuals; keep/.test(w));
assert.deepEqual([vis(3), vis(4)], [false, true]);
// ...and all three render: the section used to draw only the first two.
const three = structuredClone(good);
three.hero = undefined;
three.workstreams = [{ ...three.workstreams[0], media: ['one', 'two', 'three'].map((n) => ({ src: 'media/shot.png', abs: path.join(dir, 'media/shot.png'), caption: `Visual ${n}.` })) }];
const threeHtml = await renderRecapHTML(resolveRecap(three));
for (const n of ['one', 'two', 'three']) assert.match(threeHtml, new RegExp(`Visual ${n}\\.`));

// Suggestions: lanes without readable names; chart labels that collide (drawn at an angle).
const lanesRc = { ...structuredClone(good), prs: good.prs.map((p, i) => ({ ...p, lane: i ? 'codex 1a2b3c4d' : 'main' })), lanes: { main: 'Main lane' } };
assert.ok(resolveRecap(lanesRc).suggestions.some((x) => x.startsWith('lanes: 1 lane(s) with no readable name in "lanes" ("codex 1a2b3c4d")')));
const crowdedRc = structuredClone(good);
crowdedRc.workstreams[0].chart = { title: 'Per service', points: Array.from({ length: 12 }, (_, i) => ({ x: `service-number-${i}-long-name`, y: i + 1 })) };
const crr = resolveRecap(crowdedRc);
assert.ok(crr.suggestions.some((x) => /chart: 12 bars with labels up to 27 characters overlap/.test(x)));
assert.match(await renderRecapHTML(crr), /<text transform="translate\([\d.]+ [\d.]+\) rotate\(-35\)" text-anchor="end" class="ch-x">service-number-0-long-name/);

// "private": true (or --no-links) drops the repo name and PR links; numbers stay as text.
const priv = { ...structuredClone(good), repo: 'acme/secret', summary: 'Fixed in #3.', private: true };
const phtml = await renderRecapHTML(resolveRecap(priv));
assert.doesNotMatch(phtml, /acme\/secret|example\.com\/pr\/|github\.com\/acme/);
assert.match(phtml, /Fixed in <span class="pr">#3<\/span>\./);
write({ ...good, repo: 'acme/secret', summary: 'Fixed in #3.' });
assert.doesNotMatch(run('render', dir, '--no-links', '-o', 'p.html') && fs.readFileSync(path.join(dir, 'p.html'), 'utf8'), /github\.com\/acme\/secret/);
assert.doesNotMatch(run('render', dir, '--format', 'md', '--no-links'), /\]\(https:\/\/example\.com\/pr/);

// Posters: <name>-poster.jpg is found too.
fs.writeFileSync(path.join(dir, 'media', 'clip-poster.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
write(good);
assert.doesNotMatch(run('check', dir), /has no poster/);
assert.match(run('render', dir, '--format', 'md'), /\(media\/clip-poster\.jpg\)\]\(media\/clip\.mp4\)/);

// Thread: a TL;DR too long for the opener gets its own post; workstream posts stand alone;
// --media-dir copies what to attach; a chart-only story gets a PNG of its chart (with Chrome) or says it has none.
const th = structuredClone(good);
th.hero.tldr = ['Notebooks open in 0.4 s instead of 2.6 s, even with five thousand pages and a slow disk.', 'Live cursors show who is typing on every page of every shared notebook.', 'Search no longer freezes the window on the very largest notebooks people keep.'];
th.hero.stories = [{ workstream: 'Notebooks open 6× faster', why: 'Big notebooks open at once.' }];
delete th.workstreams[1].media;
th.workstreams[1].chart = { title: 'Median open time', unit: ' s', points: [{ x: 'before', y: 2.6 }, { x: 'after', y: 0.4 }] };
th.workstreams[0].now = 'It stays responsive.';
th.workstreams[0].wins = ['Typing in search on a 2 GB notebook no longer blocks the window'];
write(th);
const tout = run('render', dir, '--format', 'thread', '--media-dir', 'ship');
const tposts = tout.trim().split(/\n\n(?=\d+\/\d+ \()/);
assert.match(tposts[1], /^2\/\d+ \(\d+ chars\)\nTL;DR\n- Notebooks open/);
assert.match(tout, /Search no longer freezes on 2 GB notebooks\n\nTyping in search on a 2 GB notebook no longer blocks the window/);
assert.doesNotMatch(tout, /It stays responsive/);
assert.match(tout, /Live cursors[\s\S]*?\[attach ship\/shot\.png\]/);
assert.ok(fs.existsSync(path.join(dir, 'ship', 'shot.png')));
const { findChrome } = await import('../src/pdf.mjs');
if (findChrome()) {
  assert.match(tout, /Notebooks open in 0\.4 s[\s\S]*?\[attach ship\/notebooks-open-6-faster-chart\.png\]/);
  assert.equal(fs.readFileSync(path.join(dir, 'ship', 'notebooks-open-6-faster-chart.png')).readUInt32BE(0), 0x89504e47);
} else assert.match(tout, /Notebooks open in 0\.4 s[\s\S]*?\[no picture/);
console.log('release-post feedback ok');
