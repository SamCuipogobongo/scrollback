// Devin CLI: ~/.local/share/devin/cli/sessions.db (SQLite).
// Read on a tmp snapshot so a running Devin never blocks; requires node:sqlite
// (Node >= 22.13 / 23.4+). Env: SCROLLBACK_DEVIN_ROOT (dir holding sessions.db)
// or SCROLLBACK_DEVIN_DB (db file).

import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Session, Source } from "../types.ts";
import { cleanText, isUserNoise } from "../clean.ts";
import { HOME, envRoots, openSqliteSnapshot } from "../util.ts";

function dbPath(root: string): string {
  return root.endsWith(".db") ? root : join(root, "sessions.db");
}

export const devin: Source = {
  id: "devin",
  roots() {
    return [
      process.env.SCROLLBACK_DEVIN_DB || "",
      ...envRoots("devin"),
      join(HOME, ".local/share/devin/cli"),
    ].filter(Boolean);
  },
  sessions(root) {
    const file = dbPath(root);
    if (!existsSync(file)) return [];
    const d = openSqliteSnapshot(file);
    if (!d) return [];
    let rows: any[];
    try {
      rows = d
        .prepare(
          `SELECT s.id AS sid, s.working_directory AS cwd, s.title,
                  m.node_id, m.chat_message
             FROM sessions s
             JOIN message_nodes m ON m.session_id = s.id
            ORDER BY s.id, m.node_id`,
        )
        .all() as any[];
    } catch {
      return [];
    } finally {
      d.close();
    }
    const byId = new Map<string, Session & { _seen?: Set<string> }>();
    for (const r of rows) {
      let msg: any;
      try {
        msg = JSON.parse(r.chat_message);
      } catch {
        continue;
      }
      const role: string = msg.role;
      if (role !== "user" && role !== "assistant") continue;
      const t = cleanText(String(msg.content ?? ""));
      if (!t) continue;
      // is_user_input=false marks injected messages; also drop summarizer noise
      if (role === "user" && (isUserNoise(t) || msg.metadata?.is_user_input === false)) continue;
      let s = byId.get(r.sid);
      if (!s) {
        s = {
          platform: "devin",
          id: r.sid,
          cwd: r.cwd || "",
          startedAt: Date.parse(msg?.metadata?.created_at ?? "") || 0,
          title: r.title || undefined,
          turns: [],
          _seen: new Set(),
        };
        byId.set(r.sid, s);
      }
      if (!s.startedAt) s.startedAt = Date.parse(msg?.metadata?.created_at ?? "") || 0;
      // devin re-stores the same logical message per attempt — dedupe by id
      const msgId: string | undefined = msg.message_id;
      if (msgId) {
        if (s._seen!.has(msgId)) continue;
        s._seen!.add(msgId);
      }
      s.turns.push({ role, text: t });
    }
    return [...byId.values()].filter((s) => s.turns.length);
  },
};
