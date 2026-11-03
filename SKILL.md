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
2. **Read the diff** (`.prtour/<slug>/diff.patch`) and decide what a careful
   maintainer must review. **Show** core data layouts, non-trivial algorithms,
   control flow, public APIs, schema changes, security and money paths. **Hide**
   tests, constructors, trivial accessors, mechanical renames, small helpers,
   generated files, lockfiles and snapshots. These stay in the PR, and the page
   lists them as not in review.
3. **Write `tour.json`** (schema below). Order chapters by idea, not by directory:
   data shapes first, then the flow through the algorithms, and supporting
   changes last. If one file mixes core and boilerplate, list only its core hunks
   with `{"path": "...", "hunks": [0, 3]}`. One file can be split across
   chapters this way, and each hunk shows only once. A later plain or glob
   entry for the same file takes the hunks that are left.
   `npx prtour hunks <path-substring> --lines` prints each hunk's index and
   line range, and every line with its old and new line numbers. Use it to
   pick hunks and to anchor notes; don't count lines by hand.
4. **Annotate.** Add one note per stop in `notes`, in reading order (they are
   numbered `1/N`, `2/N`, …, so put them in chapter order). Anchor each note to a line that is in a shown
   hunk: `line` is the new-file line number, or the old one with
   `"side": "old"` for a deleted line. Say why the code is shaped this way,
   what could break, and what to check. Don't restate the code.
5. **Check.** Run `npx prtour check`. It exits 1 and names the problem when a
   file is unplaced, a path is wrong, or a note points at a line that isn't
   shown. Fix it until the check is clean.
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
   In your reply, list what you hid and why (dependencies and manifest changes
   in one line), and give the reading order as `n/N file:line`.

## tour.json

```json
{
  "title": "feat: pass through hosts whose clients refuse our cert",
  "url": "https://github.com/o/r/pull/24", "number": 24, "author": "me",
  "base": "main", "head": "issue-24",
  "summary": "What changed and why, 1-2 short paragraphs. Markdown: `code`, **bold**, lists, links.",
  "steps": ["Short end-to-end flow of the change", "3-6 steps"],
  "chapters": [
    { "title": "Record a passthrough on the connection",
      "body": "1-3 plain sentences for a reviewer who hasn't seen the diff.",
      "files": ["crates/core/src/connection.rs", { "path": "crates/proxy/src/connect.rs", "hunks": [1, 2] }] }
  ],
  "notes": [
    { "file": "crates/core/src/connection.rs", "line": 55, "title": "The relay's record",
      "body": "Mirrors Tunnel's shape but is its own type; bytes_up includes the replayed ClientHello." },
    { "file": "crates/proxy/src/connect.rs", "line": 88, "side": "old", "body": "Removed fallback: …" }
  ],
  "hidden": [
    { "reason": "Tests", "files": ["**/*_test.rs", "tests/**"] },
    { "reason": "Small helpers and accessors", "files": ["crates/core/src/util.rs"] }
  ],
  "skipped": "Manifests: adds `rustls 0.23` to faim-proxy; enables the `ring` feature."
}
```

- `files` and `hidden.files` take exact paths or globs (`*`, `**`). A file can be
  in only one place, and the first match wins. Any file you don't place shows up
  in an "Unsorted" chapter with a warning.
- Notes on files outside every chapter, or on lines outside the shown hunks,
  get a warning and are shown at the top of the file.
- `description`, `repo` and `parts` come from `init` and are context for you;
  only `parts` is rendered (as the Stack list). Leave them in place.
- Re-running `init` refreshes `diff.patch` and keeps your `tour.json`; add
  `--force` to re-scaffold.
