// Google Antigravity IDE: ~/.gemini/antigravity*/brain/<conv>/.system_generated/logs/transcript.jsonl
// Env: SCROLLBACK_ANTIGRAVITY_ROOT.

import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { isUserNoise } from "../clean.ts";
import { HOME, envRoots, isDir, readJsonl } from "../util.ts";
import { extractTurn } from "./jsonl.ts";

function parseTranscript(path: string): Session | null {
  const turns: Turn[] = [];
  let startedAt = 0;
  for (const ev of readJsonl(path)) {
    if (!startedAt && ev?.timestamp) startedAt = Date.parse(ev.timestamp) || 0;
    const t = extractTurn(ev);
    if (!t) continue;
    if (t.role === "user" && isUserNoise(t.text)) continue;
    turns.push(t);
  }
  if (!turns.length) return null;
  const id = path.split("/brain/")[1]?.split("/")[0] || path;
  return { platform: "antigravity", id, cwd: "", startedAt, turns };
}

export const antigravity: Source = {
  id: "antigravity",
  roots() {
    const g = process.env.GEMINI_CLI_HOME || join(HOME, ".gemini");
    return [...envRoots("antigravity"), g];
  },
  sessions(root) {
    if (!existsSync(root)) return [];
    const out: Session[] = [];
    for (const d of readdirSync(root)) {
      if (!d.startsWith("antigravity")) continue;
      const brain = join(root, d, "brain");
      if (!isDir(brain)) continue;
      for (const conv of readdirSync(brain)) {
        const f = join(brain, conv, ".system_generated/logs/transcript.jsonl");
        if (existsSync(f)) {
          const s = parseTranscript(f);
          if (s) out.push(s);
        }
      }
    }
    return out;
  },
};
