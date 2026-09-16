// Codex CLI: ~/.codex/sessions/**/rollout-*.jsonl (+ history.jsonl ignored —
// it's just the prompt log). Xcode CodingAssistant variant included.
// Env: CODEX_HOME, SCROLLBACK_CODEX_ROOT.
// Codex dual-writes each message as response_item + event_msg — we only read
// response_item/message so nothing counts twice.
// A session can span several rollout files: resume/fork writes
// rollout-<ts>-<session-uuid>[_<fork-uuid>].jsonl and replays the parent tail —
// group by session uuid, sort by ts, dedupe the overlap at the seam.

import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { cleanText, isUserNoise } from "../clean.ts";
import { HOME, envRoots, readJsonl, walkFiles } from "../util.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** rollout-2026-09-09T16-18-33-<session-uuid>[_<fork-uuid>].jsonl → {sid, ts} */
function fileKey(path: string): { sid: string; ts: string } | null {
  const m = basename(path).match(
    new RegExp(`^rollout-([0-9T-]+)-(${UUID})(_${UUID})?\\.jsonl$`),
  );
  return m ? { ts: m[1], sid: m[2] } : null;
}

function parseFile(path: string): {
  startedAt: number;
  cwd: string;
  turns: Turn[];
  startsCompacted: boolean;
} {
  let cwd = "";
  let startedAt = 0;
  let startsCompacted = false;
  const turns: Turn[] = [];
  let bootstrapped = false;
  for (const ev of readJsonl(path)) {
    const p = ev.payload || {};
    if (ev.type === "session_meta") {
      cwd = p.cwd || "";
      startedAt = Date.parse(p.timestamp || ev.timestamp || "") || 0;
      continue;
    }
    // context compaction: earlier turns are real history but the agent saw a
    // summary — mark them instead of dropping. A segment opening with one
    // means the whole previous file is pre-compact.
    if ((ev.type === "event_msg" && p.type === "compacted") || ev.type === "compacted") {
      if (!turns.length) startsCompacted = true;
      for (const t of turns) t.preCompact = true;
      continue;
    }
    if (ev.type !== "response_item" || p.type !== "message") continue;
    if (p.role !== "user" && p.role !== "assistant") continue;
    const blocks = p.content;
    const text = Array.isArray(blocks)
      ? blocks.map((b: any) => b?.text ?? "").join("\n")
      : String(blocks ?? "");
    const t = cleanText(text);
    if (!t) continue;
    // codex injects env envelope + AGENTS.md as first user turn(s)
    if (p.role === "user" && !bootstrapped) {
      if (
        isUserNoise(t) ||
        /AGENTS\.md instructions/i.test(text) ||
        /<environment_context>|<app-context>/i.test(text)
      )
        continue;
      bootstrapped = true;
    }
    if (p.role === "user" && isUserNoise(t)) continue;
    turns.push({ role: p.role, text: t });
  }
  return { startedAt, cwd, turns, startsCompacted };
}

/** Append b onto a, dropping the head of b that replays a's tail. */
function mergeTurns(a: Turn[], b: Turn[]): Turn[] {
  for (let k = Math.min(a.length, b.length); k > 0; k--) {
    let ok = true;
    for (let i = 0; i < k; i++) {
      if (a[a.length - k + i].role !== b[i].role || a[a.length - k + i].text !== b[i].text) {
        ok = false;
        break;
      }
    }
    if (ok) return [...a, ...b.slice(k)];
  }
  return [...a, ...b];
}

export const codex: Source = {
  id: "codex",
  roots() {
    const home = process.env.CODEX_HOME || join(HOME, ".codex");
    return [
      ...envRoots("codex"),
      join(home, "sessions"),
      join(HOME, "Library/Developer/Xcode/CodingAssistant/codex/sessions"),
    ];
  },
  sessions(root) {
    if (!existsSync(root)) return [];
    const bySid = new Map<string, string[]>();
    for (const f of walkFiles(root, [".jsonl"])) {
      const k = fileKey(f);
      if (!k) continue;
      (bySid.get(k.sid) ?? bySid.set(k.sid, []).get(k.sid)!).push(k.ts + "\0" + f);
    }
    const out: Session[] = [];
    for (const [sid, files] of bySid) {
      files.sort();
      let cwd = "";
      let startedAt = 0;
      let turns: Turn[] = [];
      for (const key of files) {
        const seg = parseFile(key.slice(key.indexOf("\0") + 1));
        if (seg.cwd && !cwd) cwd = seg.cwd;
        if (seg.startedAt && (!startedAt || seg.startedAt < startedAt))
          startedAt = seg.startedAt;
        if (seg.startsCompacted) for (const t of turns) t.preCompact = true;
        turns = mergeTurns(turns, seg.turns);
      }
      if (turns.length) out.push({ platform: "codex", id: sid, cwd, startedAt, turns });
    }
    return out;
  },
};
