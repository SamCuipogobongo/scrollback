// Gemini-CLI family — one parser, multiple roots. Qwen Code and friends are
// gemini-cli forks with an identical on-disk shape:
//   <root>/tmp/<projectId>/chats/session-*.{json,jsonl}   (legacy + modern)
//   <root>/projects/*/chats/*.jsonl                      (newer layout)
//   <root>/projects.json                                 (projectId -> cwd map)
// Skips subagent recordings and non-resumable shells (gemini's own rules).
// Env: QWEN_HOME / GEMINI_CLI_HOME, SCROLLBACK_<ID>_ROOT.

import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { isUserNoise } from "../clean.ts";
import { HOME, envRoots, readJson, readJsonl, walkFiles, decodeDashedPath } from "../util.ts";
import { extractTurn } from "./jsonl.ts";

function projectMap(root: string): Map<string, string> {
  const reg = readJson(join(root, "projects.json"));
  const map = new Map<string, string>();
  if (reg && typeof reg === "object") {
    for (const [k, v] of Object.entries(reg)) {
      // orientation varies: whichever side looks like an abs path is the cwd
      if (typeof v === "string" && v.startsWith("/")) map.set(k, v);
      else if (k.startsWith("/") && typeof v === "string") map.set(v, k);
      else if (v && typeof v === "object" && typeof (v as any).path === "string")
        map.set(k, (v as any).path);
    }
  }
  return map;
}

function parseRecord(rec: any, fallbackId: string, cwd: string, platform: string): Session | null {
  if (!rec || typeof rec !== "object") return null;
  if (rec.kind === "subagent" || rec.hasResumableContent === false) return null;
  const msgs: any[] = Array.isArray(rec.messages) ? rec.messages : [];
  const turns: Turn[] = [];
  for (const m of msgs) {
    const t = extractTurn(m);
    if (!t) continue;
    if (t.role === "user" && isUserNoise(t.text)) continue;
    turns.push(t);
  }
  if (!turns.length) return null;
  return {
    platform,
    id: rec.sessionId || fallbackId,
    cwd,
    startedAt: Date.parse(rec.startTime ?? rec.lastUpdated ?? "") || 0,
    turns,
  };
}

function parseJsonl(path: string, cwd: string, platform: string): Session | null {
  let meta: any = null;
  let firstTs = 0;
  const turns: Turn[] = [];
  const fallbackId = basename(path).replace(/^session-?|\.jsonl?$/g, "") || basename(path);
  for (const ev of readJsonl(path)) {
    // real qwen records carry ISO timestamp on every event — first one is a
    // fine startedAt when no meta record exists (verified on ~/.qwen)
    if (!firstTs && ev?.timestamp) firstTs = Date.parse(ev.timestamp) || 0;
    if (ev && Array.isArray(ev.messages)) {
      const s = parseRecord(ev, fallbackId, cwd, platform);
      if (s) return s;
      continue;
    }
    if (!meta && ev && (ev.sessionId || ev.projectHash || ev.startTime) && !ev.type) {
      meta = ev;
      continue;
    }
    if (meta?.kind === "subagent" || meta?.hasResumableContent === false) return null;
    // qwen writes type:"system" provenance noise (attribution/file snapshots,
    // ui_telemetry) — extractTurn already returns null for those; also skip
    // any non-real provenance on user/assistant records defensively
    if (ev?.provenance && !/^(real_user|assistant_output)$/.test(ev.provenance))
      continue;
    const t = extractTurn(ev);
    if (!t) continue;
    if (t.role === "user" && isUserNoise(t.text)) continue;
    turns.push(t);
  }
  if (!turns.length) return null;
  return {
    platform,
    id: meta?.sessionId || fallbackId,
    cwd,
    startedAt:
      Date.parse(meta?.startTime ?? meta?.lastUpdated ?? "") || firstTs || 0,
    turns,
  };
}

function makeSource(id: string, defaultRoot: string, envVar?: string): Source {
  return {
    id,
    roots() {
      const home = (envVar && process.env[envVar]) || defaultRoot;
      return [...envRoots(id), home];
    },
    sessions(root) {
      if (!existsSync(root)) return [];
      const pmap = projectMap(root);
      const out: Session[] = [];
      const dirs = [
        join(root, "tmp"), // <id>/chats/…
        join(root, "projects"), // <projectDir>/chats/…
      ];
      for (const base of dirs) {
        if (!existsSync(base)) continue;
        for (const proj of walkFiles(base, [".json", ".jsonl"])) {
          if (!proj.includes("/chats/")) continue;
          const projKey = proj.slice(base.length + 1).split("/")[0];
          const cwd = pmap.get(projKey) || decodeDashedPath(projKey);
          const s = proj.endsWith(".jsonl")
            ? parseJsonl(proj, cwd, id)
            : parseRecord(readJson(proj), basename(proj, ".json"), cwd, id);
          if (s) out.push(s);
        }
      }
      return out;
    },
  };
}

export const qwen: Source = makeSource("qwen", join(HOME, ".qwen"), "QWEN_HOME");
export const gemini: Source = makeSource("gemini", join(HOME, ".gemini"), "GEMINI_CLI_HOME");
