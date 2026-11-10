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

// Category-only titles: no verb, number or outcome word.
for (const t of ['Page renders', 'Ranged reads', 'Chat runtime', 'OCR, CI and infra', 'Web and enterprise', 'Attached scrolling', 'Live grid and search']) assert.ok(categoryOnly(t), t);
for (const t of ['PDFs 5× faster', 'Pages render in 40 ms', 'Restores come back exact', 'Search finds any session', 'Imports landed', 'Previews fixed']) assert.ok(!categoryOnly(t), t);

// Code-looking names: backticks, scoped packages, kebab-case; English compounds pass.
assert.deepEqual(codeTerms('The new `recto` engine and @acme/pdf-kit power a lite-index, with a follow-up and read-only, note-taking mode.'), ['recto', '@acme/pdf-kit', 'lite-index']);
assert.deepEqual(codeTerms('Opens in 0.4 s at https://example.com/a-b and in v1.2-beta'), []);

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
    { kind: 'improvement', label: 'Notebooks open 6× faster', headline: 'Notebooks open in 0.4 s, down from 2.6 s', symptom: 'Big notebooks showed a spinner.', now: 'They open at once, because the lite-index lists every page.', prs: [1] },
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
assert.match(html, /<video src="data:video\/mp4;base64,[^"]+" data-m-src="m1" poster="data:image\/jpeg;base64,[^"]+" data-m-poster="m2" muted loop playsinline preload="metadata" data-clip/);
// The screenshot shows in a top story and in its section but is embedded once; the second copy points at the first.
assert.equal(html.match(/base64,iVBOR/g).length, 1);
assert.match(html, /<img class="zoomable" src="data:image\/png;base64,iVBOR[^"]+" data-m-src="m3"[\s\S]*<img class="zoomable" data-same-src="m3"/);
assert.match(html, /data-same-'\+a/);
assert.match(html, /<h2>Meet the new pieces<\/h2><dl><div id="g-lite-index"><dt>lite-index<\/dt>/);
assert.equal(html.match(/class="term"/g).length, 1);
assert.match(html, /<meta property="og:image" content="https:\/\/example\.com\/acme\/2\.0\/media\/clip\.poster\.jpg">/);
assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
assert.match(html, /<meta property="og:description" content="Acme is a notes app that keeps notebooks on your own disk\. Big notebooks open before you reach for the mouse\.">/);
// The PDF gets the poster frame in place of the clip.
const print = await renderRecapHTML(resolveRecap(Object.assign(structuredClone(good), { hero: { ...good.hero, stories: [{ ...good.hero.stories[0], media: [{ src: 'media/clip.mp4', caption: 'Opening a notebook.', abs: path.join(dir, 'media/clip.mp4'), posterAbs: path.join(dir, 'media/clip.poster.jpg') }] }] } })), { print: true });
assert.match(print, /<figure class="fig story-fig"><img src="data:image\/jpeg;base64,[^"]+" data-m-src="m1" alt="Opening a notebook\."><figcaption>Opening a notebook\.<\/figcaption>/);
assert.doesNotMatch(print, /<video/);

// A top story with no screenshot or clip shows a compact copy of its section's chart.
const charted = structuredClone(good);
charted.workstreams[1].chart = { title: 'Median open time', unit: ' s', points: [{ x: 'before', y: 2.6 }, { x: 'after', y: 0.4 }] };
charted.hero.stories[0] = { workstream: 'Notebooks open 6× faster' };
const cr = resolveRecap(charted);
assert.ok(!cr.warnings.some((w) => w.includes('no visual')), cr.warnings.join('\n'));
const chtml = await renderRecapHTML(cr);
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
write({ ...good, about: 'x '.repeat(200) });
assert.ok(run('render', dir, '--format', 'thread').match(/^\d+\/\d+ \((\d+) chars\)/gm).every((l) => Number(l.match(/\((\d+)/)[1]) <= 280));

// Checks: category titles, unexplained names, too many top stories, media over budget, clips without posters.
const bad = structuredClone(good);
bad.workstreams[0].label = 'Search';
bad.workstreams[0].headline = 'Search with `ripgrep-lite`';
bad.glossary = [];
bad.hero.stories.push({ workstream: 'Search' }, { headline: 'Four' }, { headline: 'Five' });
bad.mediaBudgetMB = 0.000001;
fs.rmSync(path.join(dir, 'media', 'clip.poster.jpg'));
write(bad);
const out = check();
assert.match(out, /"Search" label only names a category/);
assert.match(out, /: "ripgrep-lite" looks like a code or package name/);
assert.match(out, /tldr: "lite-index" looks like a code or package name/);
assert.match(out, /hero: 5 top stories; keep the 2 to 4 biggest/);
assert.match(out, /media: 0\.0 MB embedded \(budget 0\.000001 MB; largest: shot\.png 0\.0 MB, clip\.mp4/);
assert.match(out, /clip media\/clip\.mp4 has no poster frame/);
delete bad.about;
write(bad);
assert.match(check(), /no "about": say in one sentence what the product is/);

// `prtour media`, when ffmpeg is here: a still at most 1600 px wide, a muted mp4 at most 1280 px wide, and a poster.
let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }
if (ffmpeg) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=2000x1000:rate=1', '-frames:v', '1', path.join(dir, 'big.png')]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=10', '-f', 'lavfi', '-i', 'sine', '-t', '1', '-c:a', 'aac', '-pix_fmt', 'yuv420p', path.join(dir, 'demo.mov')]);
  const log = run('media', 'big.png', 'demo.mov', '-o', 'out');
  assert.match(log, /"src": "out\/demo\.mp4"/);
  const still = fs.readdirSync(path.join(dir, 'out')).find((f) => /^big\.(webp|jpg)$/.test(f));
  const { imageWidth } = await import('../src/media.mjs');
  assert.equal(imageWidth(fs.readFileSync(path.join(dir, 'out', still))), 1600);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width', '-of', 'csv=p=0', path.join(dir, 'out', 'demo.mp4')], { encoding: 'utf8' }).trim();
  assert.equal(probe, 'h264,video,1280');
  assert.ok(fs.existsSync(path.join(dir, 'out', 'demo.poster.jpg')));
}
console.log(`release-post ok${ffmpeg ? '' : ' (no ffmpeg: media compression skipped)'}`);
