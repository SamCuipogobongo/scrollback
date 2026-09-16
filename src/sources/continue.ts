// Continue.dev: ~/.continue/sessions/*.json — each file is a session document
// with a `history` array. Env: CONTINUE_GLOBAL_DIR, SCROLLBACK_CONTINUE_ROOT.

import { join, basename } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { isUserNoise } from "../clean.ts";
import { HOME, envRoots, readJson } from "../util.ts";
import { extractTurn } from "./jsonl.ts";

export const cont: Source = {
  id: "continue",
  roots() {
    const base = process.env.CONTINUE_GLOBAL_DIR || join(HOME, ".continue");
    return [...envRoots("continue"), join(base, "sessions")];
  },
  sessions(root) {
    if (!existsSync(root)) return [];
    const out: Session[] = [];
    for (const f of readdirSync(root)) {
      if (!f.endsWith(".json")) continue;
      const doc = readJson(join(root, f));
      if (!doc || typeof doc !== "object") continue;
      const history: any[] = Array.isArray(doc.history)
        ? doc.history
        : Array.isArray(doc.messages)
          ? doc.messages
          : [];
      const turns: Turn[] = [];
      for (const h of history) {
        const t = extractTurn(h);
        if (!t) continue;
        if (t.role === "user" && isUserNoise(t.text)) continue;
        turns.push(t);
      }
      if (!turns.length) continue;
      out.push({
        platform: "continue",
        id: doc.sessionId || doc.session_id || doc.id || basename(f, ".json"),
        cwd: doc.workspaceDirectory || doc.cwd || "",
        startedAt: Date.parse(doc.dateCreated ?? doc.createdAt ?? "") || 0,
        title: doc.title,
        turns,
      });
    }
    return out;
  },
};
