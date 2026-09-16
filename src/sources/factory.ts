// Factory Droid: ~/.factory/sessions/<dashed-cwd>/<uuid>.jsonl (+ .settings.json)
// First jsonl line is session metadata, rest are messages. Env: SCROLLBACK_FACTORY_ROOT.

import { join, basename } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { isUserNoise } from "../clean.ts";
import { HOME, envRoots, isDir, readJsonl, decodeDashedPath } from "../util.ts";
import { extractTurn } from "./jsonl.ts";

function parseFile(path: string, cwdFromDir: string): Session | null {
  let meta: any = null;
  const turns: Turn[] = [];
  for (const ev of readJsonl(path)) {
    if (!meta && ev && (ev.sessionId || ev.session_id || ev.working_directory || ev.title)) {
      meta = ev;
      continue;
    }
    const t = extractTurn(ev);
    if (!t) continue;
    if (t.role === "user" && isUserNoise(t.text)) continue;
    turns.push(t);
  }
  if (!turns.length) return null;
  return {
    platform: "factory",
    id: meta?.sessionId || meta?.session_id || meta?.id || basename(path, ".jsonl"),
    cwd: meta?.working_directory || meta?.cwd || cwdFromDir,
    startedAt: Date.parse(meta?.created_at ?? meta?.createdAt ?? meta?.timestamp ?? "") || 0,
    title: meta?.title,
    turns,
  };
}

export const factory: Source = {
  id: "factory",
  roots() {
    return [...envRoots("factory"), join(HOME, ".factory/sessions")];
  },
  sessions(root) {
    if (!existsSync(root)) return [];
    const out: Session[] = [];
    for (const d of readdirSync(root)) {
      const pdir = join(root, d);
      if (!isDir(pdir)) continue;
      const cwd = decodeDashedPath(d);
      for (const f of readdirSync(pdir)) {
        if (!f.endsWith(".jsonl")) continue;
        const s = parseFile(join(pdir, f), cwd);
        if (s) out.push(s);
      }
    }
    return out;
  },
};
