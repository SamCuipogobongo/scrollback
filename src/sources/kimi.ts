// Kimi Code (Moonshot), two generations:
//   new: ~/.kimi-code/sessions/<workDirKey>/<sessionId>/{state.json,agents/*/wire.jsonl}
//        + session_index.jsonl
//   old: ~/.kimi/sessions/<workdir-md5>/<sessionId>/{context.jsonl,state.json}
// wire/context jsonl first line may be a _system_prompt record — skipped.
// Env: KIMI_CODE_HOME / KIMI_SHARE_DIR, SCROLLBACK_KIMI_ROOT.

import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { isUserNoise } from "../clean.ts";
import { HOME, envRoots, isDir, readJson, readJsonl, walkFiles } from "../util.ts";
import { extractTurn, textOf } from "./jsonl.ts";
import { cleanText } from "../clean.ts";

// Real wire.jsonl carriers (verified on ~/.kimi-code):
//   context.append_message  → user turns; origin.kind "injection" = date/
//     reminder noise — drop. "user" = real prompt.
//   agent.message.appended  → committed transcript; message.message is the
//     {role,content}. Assistant text lives here (think blocks ignored via
//     textOf). user-role entries duplicate append_message — skip them.
//   context.append_loop_event → streaming partials + tool events — ignore.
function parseWire(path: string, meta: any, id: string, cwd: string): Session | null {
  const turns: Turn[] = [];
  for (const ev of readJsonl(path)) {
    if (ev?.type === "context.append_message") {
      const m = ev.message;
      if (m?.role !== "user" || m.origin?.kind !== "user") continue;
      const t = cleanText(textOf(m.content));
      if (t && !isUserNoise(t)) turns.push({ role: "user", text: t });
      continue;
    }
    if (ev?.type === "agent.message.appended") {
      const m = ev.message?.message;
      if (m?.role !== "assistant") continue;
      const t = cleanText(textOf(m.content));
      if (t) turns.push({ role: "assistant", text: t });
      continue;
    }
    if (ev?._system_prompt || ev?.type === "_system_prompt") continue;
    const t = extractTurn(ev);
    if (!t) continue;
    if (t.role === "user" && isUserNoise(t.text)) continue;
    turns.push(t);
  }
  if (!turns.length) return null;
  const raw = meta?.createdAt ?? meta?.created_at ?? meta?.created;
  const startedAt =
    typeof raw === "number" ? raw : Date.parse(String(raw ?? "")) || 0;
  return { platform: "kimi", id, cwd, startedAt, title: meta?.title, turns };
}

function scanSessionsDir(sessionsDir: string): Session[] {
  if (!existsSync(sessionsDir)) return [];
  const out: Session[] = [];
  for (const wd of readdirSync(sessionsDir)) {
    const wdDir = join(sessionsDir, wd);
    if (!isDir(wdDir)) continue;
    for (const sid of readdirSync(wdDir)) {
      const sDir = join(wdDir, sid);
      if (!isDir(sDir)) continue;
      const meta = readJson(join(sDir, "state.json")) || {};
      const cwd = meta.workDir || meta.cwd || meta.working_directory || "";
      // new layout: agents/main/wire.jsonl (+subagents ignored); old: context.jsonl
      const candidates = [
        join(sDir, "agents/main/wire.jsonl"),
        ...walkFiles(join(sDir, "agents"), ["wire.jsonl"]).filter((p) => !p.includes("/main/")),
        join(sDir, "context.jsonl"),
      ];
      for (const f of candidates) {
        if (!existsSync(f)) continue;
        const s = parseWire(f, meta, sid, cwd);
        if (s) {
          out.push(s);
          break; // prefer main agent, else first wire file found
        }
      }
    }
  }
  return out;
}

export const kimi: Source = {
  id: "kimi",
  roots() {
    return [
      ...envRoots("kimi"),
      join(process.env.KIMI_CODE_HOME || join(HOME, ".kimi-code"), "sessions"),
      join(process.env.KIMI_SHARE_DIR || join(HOME, ".kimi"), "sessions"),
    ];
  },
  sessions: scanSessionsDir,
};
