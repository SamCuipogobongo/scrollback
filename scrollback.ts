#!/usr/bin/env node
// scrollback — recall past AI conversations across Claude Code, Codex, OpenCode, and Devin.
// Reads each platform's local session storage. Nothing is uploaded, no daemon, no index.
// Usage: scrollback <projects|list|search|context|extract> [args] [--flags]

import {
  readdirSync,
  readFileSync,
  statSync,
  existsSync,
  copyFileSync,
  mkdtempSync,
} from "node:fs";
import { join, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

// ---------- model ----------

type Platform = "claude" | "codex" | "opencode" | "devin";
type Role = "user" | "assistant";

interface Turn {
  role: Role;
  text: string;
}

interface Session {
  platform: Platform;
  id: string;
  cwd: string;
  startedAt: number; // epoch ms
  title?: string;
  turns: Turn[];
}

const HOME = homedir();

// ---------- shared cleaning ----------

const STRIP_TAGS = [
  "system-reminder",
  "system_info",
  "rules",
  "available_skills",
  "workflow-state",
  "INSTRUCTIONS",
  "environment_context",
  "permissions instructions",
  "collaboration_mode",
  "task-notification",
  "project_context",
  "additional_metadata",
  "command-message",
  "command-name",
  "command-args",
  "local-command-stdout",
  "local-command-caveat",
  "bash-input",
  "bash-stdout",
  "ide_opened_file",
  "ide_selection",
  "user-prompt-submit-hook",
  "ollama_coworker_plan_mode",
];

// single regex pass over the tag list; non-greedy, self-closing tolerated
const STRIP_RE = new RegExp(
  `<(${STRIP_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?(?:<\\/\\1>|$)|<(${STRIP_TAGS.join(
    "|",
  )})\\b[^>]*/>`,
  "gi",
);

function cleanText(raw: string): string {
  return raw
    .replace(STRIP_RE, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/```[\s\S]*?```/g, (m) => (m.length > 4000 ? " " : m))
    .replace(/\s+/g, " ")
    .trim();
}

const USER_NOISE = [
  /^Caveat:/,
  /^Output a summary/,
  /^Output a new summary/,
  /^Conversation to summarize/,
  /^This is a summary/,
  /^You are continuing work/,
  /^Base directory for this skill/,
  /^<\?xml/,
  /DO NOT respond to these messages/,
  /continue the conversation from where we left off/i,
  /The user interrupted the previous turn/,
];

function isUserNoise(text: string): boolean {
  return text.length < 4 || USER_NOISE.some((r) => r.test(text));
}

// ---------- claude adapter ----------

function claudeSessions(): Session[] {
  const root = join(HOME, ".claude/projects");
  if (!existsSync(root)) return [];
  const out: Session[] = [];
  for (const proj of readdirSync(root)) {
    const pdir = join(root, proj);
    if (!statSync(pdir).isDirectory()) continue;
    for (const f of readdirSync(pdir)) {
      if (!f.endsWith(".jsonl")) continue;
      const s = parseClaudeFile(join(pdir, f), basename(f, ".jsonl"));
      if (s) out.push(s);
    }
  }
  return out;
}

function parseClaudeFile(path: string, id: string): Session | null {
  let cwd = "";
  let startedAt = 0;
  const turns: Turn[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && ev.cwd) cwd = ev.cwd;
    if (!startedAt && ev.timestamp) startedAt = Date.parse(ev.timestamp);
    // compact summary: drop everything before it, keep summary as context anchor
    if (ev.isCompactSummary) {
      turns.length = 0;
      continue;
    }
    if (ev.type !== "user" && ev.type !== "assistant") continue;
    const content = ev.message?.content;
    const text = Array.isArray(content)
      ? content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n")
      : typeof content === "string"
        ? content
        : "";
    const t = cleanText(text);
    if (!t) continue;
    if (ev.type === "user" && isUserNoise(t)) continue;
    turns.push({ role: ev.type, text: t });
  }
  if (!turns.length) return null;
  return { platform: "claude", id, cwd, startedAt, turns };
}

// ---------- codex adapter ----------

function codexSessions(): Session[] {
  const root = join(HOME, ".codex/sessions");
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) files.push(p);
    }
  };
  walk(root);
  return files.map(parseCodexFile).filter((s): s is Session => !!s);
}

function parseCodexFile(path: string): Session | null {
  const m = basename(path).match(/rollout-[^-]*-[0-9a-f-]+\.jsonl$/);
  const id = (m ? m[0] : basename(path)).replace(/^rollout-|\.jsonl$/g, "");
  let cwd = "";
  let startedAt = 0;
  const turns: Turn[] = [];
  let bootstrapped = false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const p = ev.payload || {};
    if (ev.type === "session_meta") {
      cwd = p.cwd || "";
      startedAt = Date.parse(p.timestamp || ev.timestamp || "") || 0;
      continue;
    }
    // compacted sessions: drop pre-compact turns
    if ((ev.type === "event_msg" && p.type === "compacted") || ev.type === "compacted") {
      turns.length = 0;
      continue;
    }
    // codex dual-writes every message as response_item + event_msg; read only response_item
    if (ev.type !== "response_item" || p.type !== "message") continue;
    if (p.role !== "user" && p.role !== "assistant") continue;
    const blocks = p.content;
    const text = Array.isArray(blocks)
      ? blocks.map((b: any) => b?.text ?? "").join("\n")
      : String(blocks ?? "");
    const t = cleanText(text);
    if (!t) continue;
    // codex injects env envelope + AGENTS.md as the first user turn(s) — drop them
    if (p.role === "user" && !bootstrapped) {
      if (isUserNoise(t) || /AGENTS\.md instructions/i.test(text) || /<environment_context>|<app-context>/i.test(text)) continue;
      bootstrapped = true;
    }
    if (p.role === "user" && isUserNoise(t)) continue;
    turns.push({ role: p.role, text: t });
  }
  if (!turns.length) return null;
  return { platform: "codex", id, cwd, startedAt, turns };
}

// ---------- devin adapter ----------

function devinSessions(): Session[] {
  const db = join(HOME, ".local/share/devin/cli/sessions.db");
  if (!existsSync(db)) return [];
  // copy db+wal to a tmp dir so a running Devin never blocks us
  const tmp = mkdtempSync(join(tmpdir(), "scrollback-devin-"));
  for (const suffix of ["", "-wal", "-shm"]) {
    const src = db + suffix;
    if (existsSync(src)) copyFileSync(src, join(tmp, "sessions.db" + suffix));
  }
  const tmpDb = join(tmp, "sessions.db");
  let rows: any[];
  try {
    const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");
    const d = new DatabaseSync(tmpDb, { readOnly: true });
    rows = d
      .prepare(
        `SELECT s.id AS sid, s.working_directory AS cwd, s.title,
                m.node_id, m.chat_message
           FROM sessions s
           JOIN message_nodes m ON m.session_id = s.id
          ORDER BY s.id, m.node_id`,
      )
      .all() as any[];
    d.close();
  } catch {
    return [];
  }
  const byId = new Map<string, Session>();
  for (const r of rows) {
    let msg: any;
    try {
      msg = JSON.parse(r.chat_message);
    } catch {
      continue;
    }
    const role: string = msg.role;
    if (role !== "user" && role !== "assistant") continue;
    const t = cleanText(String(msg.content ?? ""));
    if (!t) continue;
    // devin marks real typed input with is_user_input=true; skip injected user msgs + summarizer noise
    if (role === "user" && (isUserNoise(t) || msg.metadata?.is_user_input === false)) continue;
    let s = byId.get(r.sid);
    if (!s) {
      s = {
        platform: "devin",
        id: r.sid,
        cwd: r.cwd || "",
        startedAt: Date.parse(msg?.metadata?.created_at ?? "") || 0,
        title: r.title || undefined,
        turns: [],
      };
      byId.set(r.sid, s);
      (s as any)._seenMsg = new Set<string>();
    }
    if (!s.startedAt) s.startedAt = Date.parse(msg?.metadata?.created_at ?? "") || 0;
    // devin re-stores the same logical message per attempt — dedupe by message_id
    const msgId: string | undefined = msg.message_id;
    if (msgId) {
      if ((s as any)._seenMsg.has(msgId)) continue;
      (s as any)._seenMsg.add(msgId);
    }
    s.turns.push({ role, text: t });
  }
  return [...byId.values()].filter((s) => s.turns.length);
}

// ---------- opencode adapter ----------

function opencodeSessions(): Session[] {
  const root = join(HOME, ".local/share/opencode/storage");
  if (!existsSync(root)) return [];
  const out: Session[] = [];
  const sessDir = join(root, "session");
  const msgDir = join(root, "message");
  const partDir = join(root, "part");
  if (!existsSync(sessDir)) return [];
  const readJson = (p: string) => {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  };
  const walkJson = (d: string): string[] =>
    existsSync(d)
      ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walkJson(join(d, e.name)) : e.name.endsWith(".json") ? [join(d, e.name)] : [],
        )
      : [];
  for (const sf of walkJson(sessDir)) {
    const info = readJson(sf);
    if (!info?.id) continue;
    const s: Session = {
      platform: "opencode",
      id: info.id,
      cwd: info.directory || "",
      startedAt: info.time?.created || 0,
      title: info.title,
      turns: [],
    };
    const mdir = join(msgDir, info.id);
    if (!existsSync(mdir)) continue;
    for (const mf of readdirSync(mdir).sort()) {
      const msg = readJson(join(mdir, mf));
      if (!msg?.role || (msg.role !== "user" && msg.role !== "assistant")) continue;
      const pdir = join(partDir, msg.id);
      const parts = existsSync(pdir)
        ? readdirSync(pdir)
            .sort()
            .map((pf) => readJson(join(pdir, pf)))
            .filter((p) => p?.type === "text")
            .map((p) => p.text)
        : [];
      const t = cleanText(parts.join("\n"));
      if (!t) continue;
      if (msg.role === "user" && isUserNoise(t)) continue;
      s.turns.push({ role: msg.role, text: t });
    }
    if (s.turns.length) out.push(s);
  }
  return out;
}

// ---------- args ----------

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else _.push(a);
  }
  return { _, flags };
}

const sinceMs = (d?: string) => (d ? Date.parse(d + "T00:00:00") : 0);
const untilMs = (d?: string) => (d ? Date.parse(d + "T23:59:59") : Infinity);

function dedupeTurns(turns: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (const t of turns) {
    const prev = out[out.length - 1];
    if (prev && prev.role === t.role && prev.text === t.text) continue;
    out.push(t);
  }
  return out;
}

function loadAll(platform?: string): Session[] {
  const want = (p: Platform) => !platform || platform === "all" || platform === p;
  const all = [
    ...(want("claude") ? claudeSessions() : []),
    ...(want("codex") ? codexSessions() : []),
    ...(want("devin") ? devinSessions() : []),
    ...(want("opencode") ? opencodeSessions() : []),
  ];
  for (const s of all) s.turns = dedupeTurns(s.turns);
  return all.filter((s) => s.turns.length);
}

function applyScope(sessions: Session[], f: Record<string, string | boolean>): Session[] {
  const since = sinceMs(f.since as string);
  const until = untilMs(f.until as string);
  let out = sessions.filter((s) => s.startedAt >= since && s.startedAt <= until);
  if (!f.global) {
    const cwd = (f.cwd as string) || process.cwd();
    out = out.filter((s) => s.cwd === cwd || s.cwd === cwd.replace(/^~/, HOME) || s.cwd === cwd.replace(HOME, "~"));
  }
  return out;
}

const fmtDate = (ms: number) =>
  ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "????-??-?? ??:??";

const matchSession = (sessions: Session[], prefix: string) =>
  sessions.find((s) => s.id === prefix || s.id.startsWith(prefix));

// ---------- commands ----------

function cmdProjects(f: Record<string, string | boolean>) {
  const sessions = applyScope(loadAll(f.platform as string), { ...f, global: true });
  const map = new Map<string, { last: number; counts: Record<string, number>; n: number }>();
  for (const s of sessions) {
    const k = s.cwd || "(no cwd)";
    const e = map.get(k) || { last: 0, counts: {}, n: 0 };
    e.n++;
    e.last = Math.max(e.last, s.startedAt);
    e.counts[s.platform] = (e.counts[s.platform] || 0) + 1;
    map.set(k, e);
  }
  const rows = [...map.entries()].sort((a, b) => b[1].last - a[1].last);
  const lim = Number(f.limit || 50);
  console.log("active projects");
  for (const [cwd, e] of rows.slice(0, lim)) {
    const parts = Object.entries(e.counts)
      .map(([p, n]) => `${p}:${n}`)
      .join(" ");
    console.log(`${fmtDate(e.last)}  sessions=${String(e.n).padStart(3)} (${parts})  ${cwd}`);
  }
  console.log(`${rows.length} project(s)`);
}

function cmdList(f: Record<string, string | boolean>) {
  const sessions = applyScope(loadAll(f.platform as string), f).sort(
    (a, b) => b.startedAt - a.startedAt,
  );
  const lim = Number(f.limit || 50);
  const scope = f.global ? "global" : `project=${(f.cwd as string) || process.cwd()}`;
  console.log(`scope: ${scope}  platform=${f.platform || "all"}`);
  for (const s of sessions.slice(0, lim)) {
    const title = s.title ? `  ${s.title.slice(0, 50)}` : "";
    console.log(`[${s.platform.padEnd(8)}] ${fmtDate(s.startedAt)}  ${s.id.slice(0, 13)}  ${s.cwd}${title}`);
  }
  console.log(`${sessions.length} session(s)`);
}

function cmdSearch(q: string, f: Record<string, string | boolean>) {
  const sessions = applyScope(loadAll(f.platform as string), f);
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scope = f.global ? "global" : `project=${(f.cwd as string) || process.cwd()}`;
  console.log(`scope: ${scope}  keyword="${q}"  platform=${f.platform || "all"}`);
  const hits: { s: Session; score: number; uh: number; ah: number; excerpt: string; role: Role }[] = [];
  for (const s of sessions) {
    let uh = 0,
      ah = 0,
      best: Turn | null = null,
      bestHits = -1;
    for (const t of s.turns) {
      const low = t.text.toLowerCase();
      const n = tokens.reduce((acc, tok) => acc + (low.split(tok).length - 1), 0);
      const allPresent = tokens.every((tok) => low.includes(tok));
      if (n > 0) t.role === "user" ? (uh += n) : (ah += n);
      if (allPresent && n > bestHits) {
        bestHits = n;
        best = t;
      }
    }
    if (!uh && !ah) continue;
    // fall back to rarest-token turn when no single turn contains all tokens
    if (!best) {
      const rare = tokens.reduce((a, b) => {
        const ca = sessions.reduce((n, s2) => n + s2.turns.filter((t) => t.text.toLowerCase().includes(a)).length, 0);
        const cb = sessions.reduce((n, s2) => n + s2.turns.filter((t) => t.text.toLowerCase().includes(b)).length, 0);
        return ca <= cb ? a : b;
      });
      best = s.turns.find((t) => t.text.toLowerCase().includes(rare)) || s.turns[0];
    }
    const score = (3 * uh + ah) / Math.max(s.turns.length, 1);
    hits.push({ s, score, uh, ah, excerpt: best.text.slice(0, 400), role: best.role });
  }
  hits.sort((a, b) => b.score - a.score);
  const lim = Number(f.limit || 50);
  for (const h of hits.slice(0, lim)) {
    const title = h.s.title ? ` "${h.s.title.slice(0, 40)}"` : "";
    console.log(
      `[${h.s.platform.padEnd(8)}] ${fmtDate(h.s.startedAt)}  ${h.s.id.slice(0, 13)}  ${h.s.cwd}  score=${h.score.toFixed(3)}  hits=${h.uh + h.ah} (u=${h.uh},a=${h.ah})  turns=${h.s.turns.length}${title}`,
    );
    for (const line of h.excerpt.split("\n").slice(0, 4)) {
      if (line.trim()) console.log(`    [${h.role}] ${line.slice(0, 160)}`);
    }
    console.log();
  }
  console.log(`${hits.length} session(s)`);
}

function cmdContext(prefix: string, f: Record<string, string | boolean>) {
  const s = matchSession(loadAll("all"), prefix);
  if (!s) {
    console.error(`no session matching "${prefix}"`);
    process.exit(1);
  }
  const budget = Number(f["max-chars"] || 6000);
  const grep = (f.grep as string)?.toLowerCase();
  const nTurns = Number(f.turns || 3);
  const around = Number(f.around ?? 1);
  console.log(`# context: [${s.platform}] ${s.id}${s.title ? ` — ${s.title}` : ""}`);
  console.log(`# cwd:   ${s.cwd}`);
  let idxs: number[];
  if (grep) {
    const scored = s.turns
      .map((t, i) => ({ i, n: t.text.toLowerCase().split(grep).length - 1 }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, nTurns)
      .map((x) => x.i);
    const set = new Set<number>();
    for (const i of scored) for (let j = i - around; j <= i + around; j++) set.add(j);
    idxs = [...set].filter((i) => i >= 0 && i < s.turns.length).sort((a, b) => a - b);
    console.log(`# grep="${grep}" — top ${scored.length} hit turns ±${around}`);
  } else {
    idxs = Array.from({ length: Math.min(nTurns, s.turns.length) }, (_, i) => i);
    console.log(`# no grep — showing first ${idxs.length} turns of ${s.turns.length}`);
  }
  let used = 0;
  for (const i of idxs) {
    const t = s.turns[i];
    const hit = grep && t.text.toLowerCase().includes(grep) ? "  ← hit" : "";
    const text = t.text.slice(0, Math.max(200, budget / 2));
    console.log(`\n## turn ${i} (${t.role})${hit}\n\n${text}`);
    used += text.length;
    if (used > budget) {
      console.log(`\n# budget_used: ${used}/${budget} chars — truncated`);
      break;
    }
  }
}

function cmdExtract(prefix: string, f: Record<string, string | boolean>) {
  const s = matchSession(loadAll("all"), prefix);
  if (!s) {
    console.error(`no session matching "${prefix}"`);
    process.exit(1);
  }
  const grep = (f.grep as string)?.toLowerCase();
  const turns = grep ? s.turns.filter((t) => t.text.toLowerCase().includes(grep)) : s.turns;
  if (f.json) {
    console.log(JSON.stringify({ ...s, turns }, null, 2));
    return;
  }
  console.log(`# extract: [${s.platform}] ${s.id}${s.title ? ` — ${s.title}` : ""}`);
  console.log(`# cwd: ${s.cwd}  started: ${fmtDate(s.startedAt)}  turns shown: ${turns.length}/${s.turns.length}\n`);
  for (const t of turns) console.log(`## ${t.role}\n\n${t.text}\n`);
}

// ---------- main ----------

const HELP = `scrollback — recall past AI conversations (claude / codex / opencode / devin)

  scrollback projects [--since D]              rank project cwds by last activity
  scrollback list [--global|--cwd p] [--since D]
  scrollback search "<keywords>" [--global|--cwd p] [--platform p] [--since D]
  scrollback context <id> [--grep kw --turns N --around N --max-chars N]
  scrollback extract <id> [--grep kw] [--json]

platforms: claude  ~/.claude/projects/*\/*.jsonl
           codex   ~/.codex/sessions/**\/rollout-*.jsonl
           devin   ~/.local/share/devin/cli/sessions.db (+ summaries/)
           opencode ~/.local/share/opencode/storage/

session ids accept any unique prefix.`;

function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0];
  if (!cmd || flags.help || flags.h) {
    console.log(HELP);
    return;
  }
  if (flags.v || flags.version) {
    console.log("scrollback 0.1.0");
    return;
  }
  switch (cmd) {
    case "projects":
      return cmdProjects(flags);
    case "list":
      return cmdList(flags);
    case "search":
      return cmdSearch(_.slice(1).join(" "), flags);
    case "context":
      return cmdContext(_[1], flags);
    case "extract":
      return cmdExtract(_[1], flags);
    default:
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
}

main();
