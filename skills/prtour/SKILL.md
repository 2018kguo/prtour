---
name: prtour
description: Turn a PR, branch diff or stack into a guided review (chapters in reading order, numbered notes on the lines that matter, tests and generated noise hidden), or many merged PRs into a recap of what got fixed, what is new and what got better. Renders one self-contained HTML file, PDF, Markdown or terminal output. Use when asked to review or walk someone through a PR, make a big diff reviewable, or write up what shipped over a span of days.
---

# prtour

You write the tour; `prtour` fetches the diff, checks your tour against it, and
renders it. Run it with `npx -y github:2018kguo/prtour <command>` (no install needed).

## Workflow

1. **Fetch and scaffold.** `npx -y github:2018kguo/prtour init <target>`
   - target: PR number, PR URL, `owner/repo#123`, a git range (`main...HEAD`),
     a `.patch` file, `-` for stdin, or nothing (this branch plus uncommitted
     changes against the default branch).
   - It writes `.prtour/<slug>/diff.patch` and `.prtour/<slug>/tour.json`
     (git-ignored), and prints every file with its kind, size and hunk count.
     The scaffold already hides lockfiles, generated files, tests and manifests.
   - **Stacked or related PRs:** `init 101 102 103` (or `init 103 --stack`,
     which follows base and head branches to find the whole stack) makes one
     tour with one part per PR. Each part keeps its own diff against its own
     base. In `tour.json`, file paths are prefixed with the part key
     (`"102:src/x.ts"`). That applies everywhere: chapters, notes, `hidden`,
     and `hunks <substring>` (e.g. `**/*.test.ts` still matches every part).
     Read a stack bottom-up, PR by PR, unless the change reads better as one
     idea across PRs. Chapters may mix parts.
   - `--dir <path>` puts the tour somewhere else. This is useful when you must
     not write into the repo. Every later command takes that folder as its
     first argument or as `--dir`. With no folder given, commands use the
     newest tour under `.prtour/`.
2. **Pick what a human must align on.** The page is not a code walkthrough.
   The reader trusts the tests and the agent for gruntwork. They want to see
   the decisions they might disagree with, and nothing else. Show only:
   - the shape of new data, APIs and contracts (schemas, types other code
     depends on, wire formats);
   - decisions with a real alternative, where a reviewer could say "no, do it
     the other way";
   - behavior that users or other systems will notice;
   - risk: access control, data loss, migrations, concurrency, money, and
     anything you suspect is a bug.

   Hide everything that follows from those decisions, even in core files:
   wiring, plumbing, handlers that call the function you already showed, UI
   that renders what the server decided, client mirrors of server checks,
   validation boilerplate, moved or renamed code, helpers, tests, and
   generated files. Hidden code stays in the PR, and the page lists it as not
   in review.

   **Budget:** at most 8 notes, 5 chapters and 400 shown lines, whatever the
   size of the PR. For most PRs, 3–5 notes and 100–250 lines are right.
   `check` fails over budget. If a PR truly needs more, set
   `"allowLarge": "<one sentence on why>"`.
3. **Write `tour.json`** (schema below). Order chapters by decision, not by
   directory. To show part of a file, list its hunks with
   `{"path": "...", "hunks": [0, 3]}`. One file can be split across chapters
   this way, and each hunk shows only once. When one hunk is too big (a new
   file is a single hunk), show just the lines that matter with
   `{"path": "...", "lines": [[120, 160], [300, 310]]}` (new-file line
   numbers). The rest of a partly shown file goes to "Not in review" on its
   own, so you don't need to list it under `hidden`.
   `npx -y github:2018kguo/prtour hunks <path-substring> --lines` prints each hunk's index and
   line range, and every line with its old and new line numbers. Use it to
   pick hunks and to anchor notes; don't count lines by hand.
4. **Annotate.** Add one note per decision or risk, in reading order (notes
   are numbered `1/N` in array order, so keep them in chapter order). Anchor
   each note to a shown line: `line` is the new-file line number, or the old
   one with `"side": "old"`. A note says what the reviewer should decide or
   check, and why, in one to three sentences. Don't narrate what the code
   does. If you suspect a bug, say so in the note's first words.

## Visuals

A picture of the change is often what a human needs most. Every visual
renders in the HTML and PDF, as Mermaid on GitHub, and as text in the terminal
(inline images in kitty, Ghostty, WezTerm and iTerm2).

- `diagram` (top level or per chapter) is the before/after map: what calls what
  after the change. Mark nodes `"change": "new"`, `"changed"` or `"removed"` (edges can be `"removed"` too; the Before view shows removed parts, After hides them), and give each
  the `chapter` that explains it. Use 3 to 8 nodes; it is a map, not a call
  graph. Edge labels are a word or two.
  `{"title": "Before / after", "caption": "Shared content reaches a thread", "nodes": [{"id": "a", "label": "MainActivity"}, {"id": "b", "label": "OnNewIntent", "change": "new", "chapter": 2}], "edges": [{"from": "a", "to": "b", "label": "intent"}]}`
- `mermaid` (top level or per chapter) is for sequence or state diagrams the
  map can't show: `"mermaid": "sequenceDiagram\n  App->>Pane: capture"`.
- `images` (top level or per chapter) are screenshots or short clips:
  `[{"src": "shots/after.png", "caption": "The record page after"}]`, with
  paths relative to the tour folder. For any UI change, a before/after
  screenshot says more than the diff. Images are embedded in the HTML.

- `icon` (on chapters, diagram nodes, recap workstreams and metric cards):
  a Lucide name for generic things (`"cpu"`, `"mic"`, `"file-text"`,
  `"database"`; see lucide.dev) or an SVGL catalog title for products
  (`"Microsoft Word"`, `"Slack"`, `"GitHub"`, `"PostgreSQL"`). Icons are
  fetched once, cached, and inlined. A name that doesn't resolve is a `check`
  warning.

## Writing

The reviewer is a peer reading fast. Write plainly, in the codebase's own
terms.

- The summary is two or three sentences: what changed and why.
- A chapter body is one or two sentences. A note body is one to three.
  `check` enforces the lengths.
- Use plain sentences of varied length. Don't use bold, em dashes, `->` in
  prose, or lists of fragments.
- Don't signpost ("Where to spend review time:", "The key thing is"). Don't
  write "it's not X, it's Y" or "not just X but Y". Don't answer your own
  question ("The result? A leak."). Don't add a summary or moral at the end.
- Drop trailing "-ing" clauses that claim importance (", ensuring safety").
  Write "is", not "serves as". Cut "additionally", "moreover", "notably",
  "ultimately".
- Don't use delve, pivotal, crucial, robust, leverage, seamless, landscape,
  or the adverbs quietly, deeply and truly.
- Put code identifiers in backticks. Text inside backticks isn't linted.
- End on the last concrete point.

`check` runs a lint for these tells (ported from Sprout) on every text field
and reports each hit with a fix.

5. **Check.** Run `npx -y github:2018kguo/prtour check`. It exits 1 and names the problem when a
   file is unplaced, a path is wrong, a note points at a line that isn't
   shown, the tour is over budget, or the writing trips the lint. Fix it until
   the check is clean. Don't rephrase just to dodge the lint; write the
   sentence plainly.
6. **Deliver**, depending on where you are:
   - Local with a human: `npx -y github:2018kguo/prtour open` serves the page with live reload.
     Every save of `tour.json` refreshes the page. Comments the reviewer leaves
     on lines, notes or chapters go to `feedback.json`; read them with
     `npx -y github:2018kguo/prtour feedback`, then address them.
   - Cloud or headless agent: `npx -y github:2018kguo/prtour render -o review.html` writes one
     self-contained file. It needs no server or network, and it works as an
     artifact, an attachment or a static page. In a PR comment, post
     `npx -y github:2018kguo/prtour render --format md` (add `--link <url>` if the HTML is hosted).
   - Terminal: `npx -y github:2018kguo/prtour show`.
   - PDF: `npx -y github:2018kguo/prtour render --format pdf` (needs Chrome, Chromium or Edge).
   In your reply, list what you hid and why (dependencies and manifest changes
   in one line), and give the reading order as `n/N file:line`.

## Recaps: what shipped across many PRs

A recap tells people what got fixed, what's new, and what got better over a
stretch of work. Write for someone who wasn't there: lead with what people
lived through, explain why it happened in plain words, show the result, and
keep the engineering detail one click away.

1. `npx -y github:2018kguo/prtour recap --author <login>[,<login>…] --since YYYY-MM-DD [--until …] [--repo o/r]`
   writes `recap.json` with every merged PR, plus `context/<number>.md` per PR:
   the description, the largest files, and what the person typed to the agent
   lane that opened it (from local Claude Code / Codex transcripts; lane names
   from ptyd). With hundreds of PRs, distill the context files in parallel
   batches first, then write.
2. Group PRs into workstreams, each one of three kinds (`kind`):
   - `"fix"`: a problem people had, now solved. Leads with `symptom`.
   - `"feature"`: something new worth showing in a demo. Needs `demo` steps.
   - `"improvement"`: something that already worked and got measurably
     faster or better (speed, accuracy, cost). Leads with what was slow or
     weak.
   Internal work that is none of these (CI, refactors, evals) goes in the
   one-line `otherPrs`. Check coverage: every user-visible change should land
   in a workstream.
3. Each workstream, top to bottom (this is the order readers see):
   - `title`: a newspaper headline. Say who or what changed and by how much,
     with the number ("One tracked edit on a 251-page Word document: 12.5 s
     before, under 0.52 s now"). No paired slogans ("X reads Y, and Z stays
     W"), no cleverness, nothing a reader can't check.
   - `symptom` and `howBad`: what people saw, and how often or how badly,
     with a sourced number. `now`: what they get today.
   - `explain`: why it happened, for a smart non-engineer. Name the concept
     once and say what it means ("Node runs every chat on one thread; a long
     CPU task on that thread stops every chat on it until it finishes").
   - One or two visuals, never more:
     - `timeline`: the clearest way to show contention or waiting. Rows over
       a few seconds, Before and After, with a play button:
       `{"caption", "length": 10, "unit": "seconds", "rows": ["Main thread",
       "Your chat", "PDF thread"], "before": [{"row": 0, "from": 0, "to": 9.4,
       "kind": "busy", "label": "Parse another chat's PDF"}, {"row": 1, "from":
       0, "to": 9.4, "kind": "frozen", "label": "No words"}], "after": […]}`.
       Kinds: busy, stream, frozen, wait.
     - `chart`: real measurements over time, with hover readouts and marks
       for deploys: `{"title", "caption", "unit": "%", "points": [{"x":
       "2026-11-03T08", "label": "8am", "y": 13.8, "note": "max freeze 2.3 s",
       "hi": true}], "marks": [{"x": "2026-11-03T18", "label": "#11256
       deployed"}]}`.
     - `diagram` (Before/After map), `mermaid`, `steps`, `images`.
   - `wins`: 3 to 5 one-line results that lead with the number, each with
     its `prs`.
   - `diffs`: at most two targeted snippets of the code that carries the
     idea, each `{"pr", "file", "lines": [from, to], "caption"}` (new-file line
     numbers; a few lines, not a whole file). The caption says what to look at.
   - `designCall`: the idea that made it work, in two or three sentences.
     `triedFirst` when the context says what was tried and dropped.
   - `details`: the engineering notes, folded by default:
     `[{"title", "body", "prs", "results"}]`. One readable item per change.
     Don't put PR lists in titles; cite PRs in `prs` or inline as `#12345`.
   - `asked`: what the person set out to do, paraphrased from the lane context.
4. Top of the report: `title`, `byline`, and a `summary` of two or three
   sentences that opens with what people were living with. The overview lists
   are built from each workstream's `symptom`/`title` and `now`, so write
   those well. Add `dayNotes` and readable `lanes` names.
5. Every number comes from a PR, a context file or measured evidence. Never
   estimate. The writing rules above apply, and `check` enforces them, plus the
   limits on visuals and diffs per workstream. Then `render` (HTML),
   `--format pdf`, `--format md`, or `show`.

The page follows common critiques of generated design, so don't fight it:
one type family, no labels above headings, no icon tiles or colored card
borders, no identical card grids, no metric strips, nothing smaller than 14px.

## tour.json

```json
{
  "title": "feat: pass through hosts whose clients refuse our cert",
  "url": "https://github.com/o/r/pull/24", "number": 24, "author": "me",
  "base": "main", "head": "issue-24",
  "summary": "Hosts whose clients reject our certificate now pass through untouched. The proxy replays the `ClientHello` upstream and splices the two sockets.",
  "steps": ["Optional: 2-4 short steps of the flow, only if the summary can't carry it"],
  "chapters": [
    { "title": "Record a passthrough on the connection",
      "body": "A passthrough is its own type on `Connection`, not a variant of `Tunnel`.",
      "files": ["crates/core/src/connection.rs", { "path": "crates/proxy/src/connect.rs", "hunks": [1, 2] }] }
  ],
  "notes": [
    { "file": "crates/core/src/connection.rs", "line": 55, "title": "The relay's record",
      "body": "`bytes_up` counts the replayed `ClientHello`, so a relay that dies right after dialing still shows what it sent. Check that billing reads this the same way." },
    { "file": "crates/proxy/src/connect.rs", "line": 88, "side": "old", "title": "Likely bug: fallback removed",
      "body": "Clients that refuse the cert used to retry over plain HTTP here. Nothing replaces that path." }
  ],
  "hidden": [
    { "reason": "Tests", "files": ["**/*_test.rs", "tests/**"] },
    { "reason": "Small helpers and accessors", "files": ["crates/core/src/util.rs"] }
  ],
  "skipped": "Adds `rustls 0.23` to faim-proxy with the `ring` feature."
}
```

- `files` and `hidden.files` take exact paths or globs (`*`, `**`). Chapters
  are matched first. A file shown in any chapter (even partly) is never listed
  as hidden, so a broad `hidden` glob such as `"**"` is a safe way to hide
  everything you didn't show. Any file you leave out of both shows up in an
  "Unsorted" chapter with a warning.
- Notes on files outside every chapter, or on lines outside the shown hunks,
  get a warning and are shown at the top of the file.
- `allowLarge` (optional) is shown on the page as the reason the tour is over
  budget.
- `description`, `repo` and `parts` come from `init` and are context for you;
  only `parts` is rendered (as the Stack list). Leave them in place.
- Re-running `init` refreshes `diff.patch` and keeps your `tour.json`; add
  `--force` to re-scaffold.
