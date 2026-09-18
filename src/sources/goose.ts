// Goose (Block): ~/.local/share/goose/sessions/*.jsonl (+ sessions.db newer).
// Env: GOOSE_PATH_ROOT, XDG_DATA_HOME, SCROLLBACK_GOOSE_ROOT.

import { join, basename } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { isUserNoise } from "../clean.ts";
import { HOME, envRoots, readJsonl, openSqliteSnapshot } from "../util.ts";
import { extractTurn } from "./jsonl.ts";

function parseJsonl(path: string): Session | null {
  let meta: any = null;
  const turns: Turn[] = [];
  for (const ev of readJsonl(path)) {
    if (!meta && ev && (ev.id || ev.session_id || ev.working_dir || ev.description)) {
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
    platform: "goose",
    id: meta?.id || meta?.session_id || basename(path, ".jsonl"),
    cwd: meta?.working_dir || meta?.cwd || "",
    startedAt: meta?.created ? meta.created * 1000 : Date.parse(meta?.timestamp ?? "") || 0,
    title: meta?.description,
    turns,
  };
}

export const goose: Source = {
  id: "goose",
  roots() {
    const xdg = process.env.XDG_DATA_HOME || join(HOME, ".local/share");
    const base = process.env.GOOSE_PATH_ROOT || HOME;
    return [
      ...envRoots("goose"),
      join(xdg, "goose/sessions"),
      join(base, ".local/share/goose/sessions"),
      join(base, ".config/goose/sessions"),
    ];
  },
  sessions(root) {
    if (!existsSync(root)) return [];
    const out: Session[] = [];
    for (const f of readdirSync(root)) {
      if (f.endsWith(".jsonl")) {
        const s = parseJsonl(join(root, f));
        if (s) out.push(s);
      } else if (f === "sessions.db" || f.endsWith(".db")) {
        // newer goose keeps a sqlite store; parse defensively if present
        const d = openSqliteSnapshot(join(root, f));
        if (!d) continue;
        try {
          const tables = d
            .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
            .all() as any[];
          const has = (n: string) => tables.some((t) => t.name === n);
          if (has("sessions") && has("messages")) {
            const rows = d
              .prepare(
                `SELECT s.id, s.working_dir, s.description, s.created_at, m.role, m.content_json
                   FROM sessions s JOIN messages m ON m.session_id = s.id
                  ORDER BY s.id, m.created_timestamp`,
              )
              .all() as any[];
            const byId = new Map<string, Session>();
            for (const r of rows) {
              let content: any = r.content_json;
              if (typeof content === "string") {
                try {
                  content = JSON.parse(content); // content_json is serialized JSON
                } catch {
                  continue;
                }
              }
              const t = extractTurn({ role: r.role, content });
              if (!t) continue;
              if (t.role === "user" && isUserNoise(t.text)) continue;
              let s = byId.get(r.id);
              if (!s) {
                s = {
                  platform: "goose",
                  id: r.id,
                  cwd: r.working_dir || "",
                  startedAt:
                    typeof r.created_at === "number"
                      ? r.created_at * 1000
                      : Date.parse(r.created_at ?? "") || 0,
                  title: r.description,
                  turns: [],
                };
                byId.set(r.id, s);
              }
              s.turns.push(t);
            }
            out.push(...[...byId.values()].filter((s) => s.turns.length));
          }
        } catch {
          // unknown schema — skip
        } finally {
          d.close();
        }
      }
    }
    return out;
  },
};
