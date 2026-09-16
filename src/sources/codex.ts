// Codex CLI: ~/.codex/sessions/**/rollout-*.jsonl (+ history.jsonl ignored —
// it's just the prompt log). Xcode CodingAssistant variant included.
// Env: CODEX_HOME, SCROLLBACK_CODEX_ROOT.
// Codex dual-writes each message as response_item + event_msg — we only read
// response_item/message so nothing counts twice.

import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { cleanText, isUserNoise } from "../clean.ts";
import { HOME, envRoots, readJsonl, walkFiles } from "../util.ts";

function parseFile(path: string): Session | null {
  const m = basename(path).match(/rollout-[^-]*-[0-9a-f-]+\.jsonl$/);
  const id = (m ? m[0] : basename(path)).replace(/^rollout-|\.jsonl$/g, "");
  let cwd = "";
  let startedAt = 0;
  const turns: Turn[] = [];
  let bootstrapped = false;
  for (const ev of readJsonl(path)) {
    const p = ev.payload || {};
    if (ev.type === "session_meta") {
      cwd = p.cwd || "";
      startedAt = Date.parse(p.timestamp || ev.timestamp || "") || 0;
      continue;
    }
    if ((ev.type === "event_msg" && p.type === "compacted") || ev.type === "compacted") {
      turns.length = 0;
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
  if (!turns.length) return null;
  return { platform: "codex", id, cwd, startedAt, turns };
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
    return walkFiles(root, [".jsonl"])
      .filter((f) => basename(f).startsWith("rollout-"))
      .map(parseFile)
      .filter((s): s is Session => !!s);
  },
};
