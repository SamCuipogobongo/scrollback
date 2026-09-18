// Cline CLI (standalone): ~/.cline/data/tasks/<taskId>/api_conversation_history.json
// Same task layout as the VS Code extension — the extension's globalStorage
// tasks are covered by vscode-family (tagged "<app>:cline"); this source covers
// the headless CLI only. CLINE_DIR replaces ~/.cline/data when set.
// Env: CLINE_DIR, CLINE_DATA_DIR, SCROLLBACK_CLINE_ROOT.

import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { isUserNoise } from "../clean.ts";
import { HOME, envRoots, isDir, readJson } from "../util.ts";
import { extractTurn } from "./jsonl.ts";

function parseTaskFile(path: string, taskId: string): Session | null {
  const arr = readJson(path);
  const msgs: any[] = Array.isArray(arr)
    ? arr
    : arr?.messages || arr?.conversation || [];
  const turns: Turn[] = [];
  let startedAt = 0;
  for (const m of msgs) {
    const filtered = Array.isArray(m?.content)
      ? { ...m, content: m.content.filter((b) => b?.type !== "tool_result") }
      : m;
    const t = extractTurn(filtered);
    if (!t) continue;
    if (t.role === "user" && isUserNoise(t.text)) continue;
    if (!startedAt && m?.ts) startedAt = Number(m.ts) || Date.parse(m.ts) || 0;
    turns.push(t);
  }
  if (!turns.length) return null;
  return { platform: "cline", id: taskId, cwd: "", startedAt, turns };
}

export const cline: Source = {
  id: "cline",
  roots() {
    const out = [
      ...envRoots("cline"),
      join(HOME, ".cline/data/tasks"),
    ];
    // CLINE_DIR / CLINE_DATA_DIR replace the data dir that holds tasks/
    for (const v of [process.env.CLINE_DIR, process.env.CLINE_DATA_DIR])
      if (v) out.push(join(v, "tasks"));
    return out;
  },
  sessions(root) {
    if (!existsSync(root) || !isDir(root)) return [];
    const out: Session[] = [];
    for (const taskId of readdirSync(root)) {
      const f = join(root, taskId, "api_conversation_history.json");
      if (!existsSync(f)) continue;
      const s = parseTaskFile(f, taskId);
      if (s) out.push(s);
    }
    return out;
  },
};
