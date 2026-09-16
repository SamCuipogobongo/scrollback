// Zed agent threads: <AppData>/Zed/threads/threads.db
// threads(id, summary, updated_at, data_type, data BLOB, folder_paths, created_at)
// data_type: "zstd" (current) or "json" (pre-compression rows).
// Env: SCROLLBACK_ZED_ROOT (dir holding threads.db) / SCROLLBACK_ZED_DB.

import { join } from "node:path";
import { existsSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import type { Session, Source, Turn } from "../types.ts";
import { isUserNoise } from "../clean.ts";
import { HOME, envRoots, openSqliteSnapshot } from "../util.ts";
import { extractTurn, textOf } from "./jsonl.ts";
import { cleanText } from "../clean.ts";

function threadTurns(doc: any): Turn[] {
  // SerializedThread: {version, summary, messages:[{role, content}...], ...}
  const msgs: any[] = Array.isArray(doc?.messages)
    ? doc.messages
    : Array.isArray(doc?.entries)
      ? doc.entries
      : [];
  const turns: Turn[] = [];
  for (const m of msgs) {
    let t = extractTurn(m);
    if (!t && m?.role && m?.content) {
      const role = String(m.role).toLowerCase();
      const r = role === "user" ? "user" : role === "assistant" ? "assistant" : null;
      const text = cleanText(textOf(m.content));
      if (r && text) t = { role: r, text };
    }
    if (!t) continue;
    if (t.role === "user" && isUserNoise(t.text)) continue;
    turns.push(t);
  }
  return turns;
}

export const zed: Source = {
  id: "zed",
  roots() {
    return [
      process.env.SCROLLBACK_ZED_DB || "",
      ...envRoots("zed"),
      join(HOME, "Library/Application Support/Zed/threads/threads.db"),
      join(process.env.XDG_DATA_HOME || join(HOME, ".local/share"), "zed/threads/threads.db"),
    ].filter(Boolean);
  },
  sessions(root) {
    const dbFile = root.endsWith(".db") ? root : join(root, "threads.db");
    if (!existsSync(dbFile)) return [];
    const d = openSqliteSnapshot(dbFile);
    if (!d) return [];
    let rows: any[];
    try {
      rows = d
        .prepare(`SELECT id, summary, updated_at, created_at, data_type, data, folder_paths
                    FROM threads`)
        .all() as any[];
    } catch {
      d.close();
      return [];
    }
    d.close();
    const out: Session[] = [];
    for (const r of rows) {
      try {
        let buf: Buffer = Buffer.isBuffer(r.data) ? r.data : Buffer.from(r.data);
        if (r.data_type === "zstd") buf = zstdDecompressSync(buf);
        const doc = JSON.parse(buf.toString("utf8"));
        const turns = threadTurns(doc);
        if (!turns.length) continue;
        let cwd = "";
        if (typeof r.folder_paths === "string") {
          try {
            const p = JSON.parse(r.folder_paths);
            cwd = Array.isArray(p) ? p[0] : p?.paths?.[0] || "";
          } catch {}
        }
        out.push({
          platform: "zed",
          id: r.id,
          cwd,
          startedAt: Date.parse(r.created_at ?? r.updated_at ?? "") || 0,
          title: r.summary || doc?.summary,
          turns,
        });
      } catch {
        continue;
      }
    }
    return out;
  },
};
