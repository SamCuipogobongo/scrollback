// Aider: per-repo `.aider.chat.history.md` markdown logs.
// Sessions split on "# aider chat started at <ts>"; user turns are ">"-quoted
// blocks, assistant turns are "####"/"##" headed blocks. Best-effort.
// Env: AIDER_CHAT_HISTORY_FILE, SCROLLBACK_AIDER_ROOT(S) (dirs to scan, or
// a direct file path).

import { join, dirname, basename } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { cleanText, isUserNoise } from "../clean.ts";
import { HOME, envRoots, isDir } from "../util.ts";

function parseMd(path: string): Session[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const cwd = dirname(path);
  const out: Session[] = [];
  const chunks = text.split(/^# aider chat started at /m).slice(1);
  for (const chunk of chunks) {
    const nl = chunk.indexOf("\n");
    const stamp = chunk.slice(0, nl).trim();
    const body = chunk.slice(nl + 1);
    const turns: Turn[] = [];
    let curKind: "user" | "assistant" | null = null;
    let curText = "";
    const flush = () => {
      if (!curKind) return;
      const t = cleanText(curText);
      if (t && !(curKind === "user" && isUserNoise(t))) turns.push({ role: curKind, text: t });
      curKind = null;
      curText = "";
    };
    for (const line of body.split("\n")) {
      if (line.startsWith("> ")) {
        if (curKind !== "user") {
          flush();
          curKind = "user";
        }
        curText += line.slice(2) + "\n";
      } else if (/^#{2,4}\s/.test(line)) {
        if (curKind !== "assistant") {
          flush();
          curKind = "assistant";
        }
        curText += line.replace(/^#+\s*/, "") + "\n";
      } else if (curKind === "assistant") {
        curText += line + "\n";
      }
    }
    flush();
    if (!turns.length) continue;
    out.push({
      platform: "aider",
      id: `${basename(path)}:${stamp || out.length}`,
      cwd,
      startedAt: Date.parse(stamp) || 0,
      turns,
    });
  }
  return out;
}

export const aider: Source = {
  id: "aider",
  roots() {
    const roots = [...envRoots("aider")];
    if (process.env.AIDER_CHAT_HISTORY_FILE) roots.push(process.env.AIDER_CHAT_HISTORY_FILE);
    roots.push(join(HOME, ".aider.chat.history.md"));
    const extra = process.env.SCROLLBACK_AIDER_ROOTS; // ':'-separated dirs to scan
    if (extra) for (const d of extra.split(":").filter(Boolean)) roots.push(d);
    return roots;
  },
  sessions(root) {
    if (root.endsWith(".md")) return existsSync(root) ? parseMd(root) : [];
    if (!isDir(root)) return [];
    const out: Session[] = [];
    // bounded: scan two levels deep for .aider.chat.history.md
    for (const d of [root, ...readdirSync(root).map((e) => join(root, e))]) {
      if (!isDir(d)) continue;
      const f = join(d, ".aider.chat.history.md");
      if (existsSync(f)) out.push(...parseMd(f));
    }
    return out;
  },
};
