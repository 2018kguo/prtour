---
name: prtour
description: Turn a PR or branch diff into a guided review — chapters in reading order, numbered notes on the lines that matter, and tests/generated/helper noise hidden — rendered as one self-contained HTML file (also Markdown and terminal). Use when asked to open a diff for review, walk someone through a PR, make a big diff reviewable, or produce a review artifact.
---

# prtour

You write the tour; `prtour` fetches the diff, checks your tour against it, and
renders it. Run it with `npx -y prtour@latest <command>` (no install needed).

## Workflow

1. **Fetch and scaffold.** `npx -y prtour@latest init <target>`
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
   `npx prtour hunks <path-substring> --lines` prints each hunk's index and
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
  after the change. Mark nodes `"change": "new"` or `"changed"`, and give each
  the `chapter` that explains it. Use 3 to 8 nodes; it is a map, not a call
  graph. Edge labels are a word or two.
  `{"title": "Before / after", "caption": "Shared content reaches a thread", "nodes": [{"id": "a", "label": "MainActivity"}, {"id": "b", "label": "OnNewIntent", "change": "new", "chapter": 2}], "edges": [{"from": "a", "to": "b", "label": "intent"}]}`
- `mermaid` (top level or per chapter) is for sequence or state diagrams the
  map can't show: `"mermaid": "sequenceDiagram\n  App->>Pane: capture"`.
- `images` (top level or per chapter) are screenshots or short clips:
  `[{"src": "shots/after.png", "caption": "The record page after"}]`, with
  paths relative to the tour folder. For any UI change, a before/after
  screenshot says more than the diff. Images are embedded in the HTML.

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

5. **Check.** Run `npx prtour check`. It exits 1 and names the problem when a
   file is unplaced, a path is wrong, a note points at a line that isn't
   shown, the tour is over budget, or the writing trips the lint. Fix it until
   the check is clean. Don't rephrase just to dodge the lint; write the
   sentence plainly.
6. **Deliver**, depending on where you are:
   - Local with a human: `npx prtour open` serves the page with live reload.
     Every save of `tour.json` refreshes the page. Comments the reviewer leaves
     on lines, notes or chapters go to `feedback.json`; read them with
     `npx prtour feedback`, then address them.
   - Cloud or headless agent: `npx prtour render -o review.html` writes one
     self-contained file. It needs no server or network, and it works as an
     artifact, an attachment or a static page. In a PR comment, post
     `npx prtour render --format md` (add `--link <url>` if the HTML is hosted).
   - Terminal: `npx prtour show`.
   - PDF: `npx prtour render --format pdf` (needs Chrome, Chromium or Edge).
   In your reply, list what you hid and why (dependencies and manifest changes
   in one line), and give the reading order as `n/N file:line`.

## Recaps: what shipped across many PRs

For "what did X ship this week", "summarize my PRs since Monday", or a team
update, use a recap instead of a tour. It is about outcomes, not diffs.

1. `npx prtour recap --author <login> --since YYYY-MM-DD [--until …] [--repo o/r]`
   writes `.prtour/recap-<login>-<since>/recap.json` with every merged PR (title,
   date, size, area, and the PR description for you to read).
2. Group the PRs into 2 to 6 `themes` by outcome, not by directory. For each
   theme, write a `title` naming the outcome, a `body` of one or two sentences,
   and an optional `outcome` line: what is now true, or what is still pending.
   A theme can carry a `diagram`, `mermaid` or `images` like a chapter.
3. Give every PR a `oneLiner`: what it did, in plain words, under 140 chars.
4. Write a two- or three-sentence `summary`. Add optional `highlights` (numbers
   worth showing, e.g. `{"value": "40%", "label": "faster cold start"}`), but
   only numbers you can point to.
5. Run `npx prtour check`. The same writing lint applies. Then
   `npx prtour render` (HTML), `--format md` (Slack or GitHub),
   `--format pdf`, or `npx prtour show`.

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
