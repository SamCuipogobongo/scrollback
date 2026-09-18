// CodeBuddy CLI (Tencent): ~/.codebuddy/projects/<sanitized-cwd>/<sessionId>.jsonl
// Distinct from the CodeBuddy VS Code fork (covered by vscode-family discovery).
// Event types verified on a real install:
//   message {role,content:[{type:input_text|output_text,text}],sessionId,cwd,timestamp}
//   summary {summary, providerData.source:"initial-user-message"} — fallback title
//   ai-title {aiTitle} — generated title, preferred
//   reasoning / file-history-snapshot / turn-metrics — skipped
// Env: CODEBUDDY_HOME, SCROLLBACK_CODEBUDDY_ROOT.

import { join, basename } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { cleanText, isUserNoise } from "../clean.ts";
import { HOME, envRoots, isDir, readJsonl } from "../util.ts";
import { textOf } from "./jsonl.ts";

function parseFile(path: string, id: string): Session | null {
  let cwd = "";
  let startedAt = 0;
  let title: string | undefined;
  let fallbackTitle: string | undefined;
  const turns: Turn[] = [];
  for (const ev of readJsonl(path)) {
    if (!cwd && ev.cwd) cwd = ev.cwd;
    if (!startedAt && typeof ev.timestamp === "number")
      startedAt = ev.timestamp;
    if (ev.type === "ai-title" && typeof ev.aiTitle === "string")
      title = ev.aiTitle;
    if (ev.type === "summary" && typeof ev.summary === "string")
      fallbackTitle = ev.summary;
    if (ev.type !== "message") continue;
    const role = ev.role === "user" || ev.role === "assistant" ? ev.role : null;
    if (!role) continue;
    const t = cleanText(textOf(ev.content));
    if (!t) continue;
    if (role === "user" && isUserNoise(t)) continue;
    turns.push({ role, text: t });
  }
  if (!turns.length) return null;
  return {
    platform: "codebuddy",
    id,
    cwd,
    startedAt,
    title: title ?? fallbackTitle,
    turns,
  };
}

export const codebuddy: Source = {
  id: "codebuddy",
  roots() {
    return [
      ...envRoots("codebuddy"),
      join(process.env.CODEBUDDY_HOME || join(HOME, ".codebuddy"), "projects"),
    ];
  },
  sessions(root) {
    if (!existsSync(root) || !isDir(root)) return [];
    const out: Session[] = [];
    for (const proj of readdirSync(root)) {
      const pdir = join(root, proj);
      if (!isDir(pdir)) continue;
      for (const f of readdirSync(pdir)) {
        if (!f.endsWith(".jsonl")) continue;
        const s = parseFile(join(pdir, f), basename(f, ".jsonl"));
        if (s) out.push(s);
      }
    }
    return out;
  },
};
