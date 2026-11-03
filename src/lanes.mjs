// Which agent session opened each PR, and what the person asked it. Reads
// local Claude Code (~/.claude/projects) and Codex (~/.codex/sessions)
// transcripts; names lanes from ptyd when it is running. Everything here is
// context for the writer: the recap page shows lane names, never transcripts.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const home = os.homedir();

function transcriptFiles(since, until) {
  const files = [];
  const claude = path.join(home, '.claude', 'projects');
  if (fs.existsSync(claude)) for (const d of fs.readdirSync(claude)) {
    const dir = path.join(claude, d);
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) files.push({ file: path.join(dir, f), agent: 'claude', session: f.replace(/\.jsonl$/, '') }); } catch {}
  }
  // Codex keeps sessions/YYYY/MM/DD; only read the days in the window (plus one before).
  const codex = path.join(home, '.codex', 'sessions');
  const start = new Date(Date.parse(`${since}T00:00:00Z`) - 864e5);
  for (let d = start; d <= new Date(`${until}T23:59:59Z`); d = new Date(d.getTime() + 864e5)) {
    const dir = path.join(codex, d.toISOString().slice(0, 4), d.toISOString().slice(5, 7), d.toISOString().slice(8, 10));
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) files.push({ file: path.join(dir, f), agent: 'codex', session: (f.match(/[0-9a-f-]{36}/) ?? [f])[0] });
  }
  return files.filter((f) => { try { return fs.statSync(f.file).mtimeMs >= start.getTime(); } catch { return false; } });
}

function ptydLanes() {
  try {
    const ts = JSON.parse(execFileSync('ptyd', ['term', 'ls', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }));
    return new Map(ts.filter((t) => t.agent_session).map((t) => [t.agent_session, t.name]));
  } catch { return new Map(); }
}

// Human-typed text of a transcript line, or null (tool results, reminders, meta).
function userText(obj) {
  const m = obj.type === 'user' && !obj.isMeta ? obj.message
    : obj.type === 'response_item' && obj.payload?.type === 'message' && obj.payload.role === 'user' ? obj.payload : null;
  if (!m) return null;
  const parts = typeof m.content === 'string' ? [m.content] : (m.content ?? []).filter((c) => c.type === 'text' || c.type === 'input_text').map((c) => c.text);
  const text = parts.join('\n').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<(environment_context|user_instructions|command-[a-z]+|local-command-[a-z]+)>[\s\S]*?<\/\1>/g, '').trim();
  return text && !text.startsWith('<') && !/^\[Request interrupted/.test(text) ? text : null;
}

async function readSession(file) {
  const users = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    n++;
    if (line.length > 200000) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const t = userText(o);
    if (t) users.push({ line: n, at: o.timestamp ?? o.payload?.timestamp, text: t });
  }
  return users;
}

async function lineTimestamps(file, wanted) {
  const out = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    n++;
    if (!wanted.has(n)) continue;
    const m = line.match(/"timestamp":"([^"]+)"/);
    if (m) out.set(n, m[1]);
    if (out.size === wanted.size) break;
  }
  rl.close();
  return out;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

// prs: [{ number, createdAt }]. Returns Map number -> { agent, session, lane, asked: [..] }.
export async function findLanes({ repo, prs, since, until }) {
  const files = transcriptFiles(since, until);
  if (!files.length) return new Map();
  const want = new Set(prs.map((p) => p.number));
  const re = `github\\.com/${repo.replace('/', '\\/')}/pull/([0-9]+)`;
  let out = '';
  try { out = execFileSync('rg', ['-n', '-o', '--no-heading', '-e', re, ...files.map((f) => f.file)], { encoding: 'utf8', maxBuffer: 1 << 30 }); } catch (e) { out = e.stdout ?? ''; }
  // First mention of each PR in each file.
  const first = new Map(); // file -> Map(pr -> line)
  for (const l of out.split('\n')) {
    const m = l.match(/^(.*\.jsonl):(\d+):.*\/pull\/(\d+)/);
    if (!m || !want.has(Number(m[3]))) continue;
    const per = first.get(m[1]) ?? new Map();
    if (!per.has(Number(m[3]))) per.set(Number(m[3]), Number(m[2]));
    first.set(m[1], per);
  }
  // The opener is the session whose first mention is closest to the PR's creation.
  const created = new Map(prs.map((p) => [p.number, Date.parse(p.createdAt)]));
  const best = new Map();
  for (const [file, per] of first) {
    const ts = await lineTimestamps(file, new Set(per.values()));
    for (const [pr, line] of per) {
      const at = Date.parse(ts.get(line) ?? '');
      const gap = Math.abs(at - created.get(pr));
      if (Number.isFinite(gap) && gap < 2 * 36e5 && (!best.has(pr) || gap < best.get(pr).gap)) best.set(pr, { file, line, gap });
    }
  }
  const lanes = ptydLanes();
  const meta = new Map(files.map((f) => [f.file, f]));
  const sessions = new Map();
  const result = new Map();
  for (const [pr, { file, line }] of best) {
    if (!sessions.has(file)) sessions.set(file, await readSession(file));
    const users = sessions.get(file).filter((u) => u.line < line);
    const f = meta.get(file);
    // What the person asked: how the session started, then the last few asks before the PR.
    const asked = [...new Set([users[0], ...users.slice(-3)].filter(Boolean))].map((u) => clip(u.text.replace(/\s+/g, ' '), 600));
    result.set(pr, { agent: f.agent, session: f.session, lane: lanes.get(f.session) ?? null, asked });
  }
  return result;
}
