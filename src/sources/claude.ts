// Claude Code: ~/.claude/projects/<sanitized-cwd>/*.jsonl
// Env: CLAUDE_CONFIG_DIR, CLAUDE_CODE_PROJECT_DIR_NAME, SCROLLBACK_CLAUDE_ROOT
// Also covers Xcode CodingAssistant + cc-mirror roots (like deja-vu).

import { join, basename } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { cleanText, isUserNoise } from "../clean.ts";
import { HOME, envRoots, isDir, readJsonl } from "../util.ts";

function parseFile(path: string, id: string): Session | null {
  let cwd = "";
  let startedAt = 0;
  const turns: Turn[] = [];
  for (const ev of readJsonl(path)) {
    if (!cwd && ev.cwd) cwd = ev.cwd;
    if (!startedAt && ev.timestamp) startedAt = Date.parse(ev.timestamp) || 0;
    // compact summary: drop everything before it, keep summary as anchor
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

function scanRoot(root: string): Session[] {
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
}

export const claude: Source = {
  id: "claude",
  roots() {
    const cfg = process.env.CLAUDE_CONFIG_DIR || join(HOME, ".claude");
    const projDir = process.env.CLAUDE_CODE_PROJECT_DIR_NAME || "projects";
    return [
      ...envRoots("claude"),
      join(cfg, projDir),
      join(cfg, "transcripts"),
      join(
        HOME,
        `Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/${projDir}`,
      ),
      join(process.env.SCROLLBACK_CC_MIRROR_ROOT || join(HOME, ".cc-mirror"), "*/.claude", projDir),
    ];
  },
  sessions(root) {
    if (root.includes("*")) {
      // glob-lite: only used for the cc-mirror pattern above
      const [pre, post] = root.split("*");
      if (!existsSync(pre)) return [];
      return readdirSync(pre).flatMap((d) => {
        const p = join(pre, d, post);
        return isDir(p) ? scanRoot(p) : [];
      });
    }
    return existsSync(root) ? scanRoot(root) : [];
  },
};
