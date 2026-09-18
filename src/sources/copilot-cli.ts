// GitHub Copilot CLI: ~/.copilot/session-state/<sessionId>/events.jsonl
// (plus session.json / workspace.yaml metadata when present).
// Env: COPILOT_HOME, SCROLLBACK_COPILOT_ROOT.

import { join, basename } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { isUserNoise } from "../clean.ts";
import { HOME, envRoots, isDir, readJson, readJsonl } from "../util.ts";
import { extractTurn } from "./jsonl.ts";

export const copilotCli: Source = {
  id: "copilot-cli",
  roots() {
    const base = process.env.COPILOT_HOME || join(HOME, ".copilot");
    return [
      ...envRoots("copilot-cli"), // SCROLLBACK_COPILOT_CLI_ROOT (convention)
      ...envRoots("copilot"), // SCROLLBACK_COPILOT_ROOT (back-compat)
      join(base, "session-state"),
    ];
  },
  sessions(root) {
    if (!existsSync(root)) return [];
    const out: Session[] = [];
    for (const d of readdirSync(root)) {
      const sDir = join(root, d);
      if (!isDir(sDir)) continue;
      const eventsFile = join(sDir, "events.jsonl");
      if (!existsSync(eventsFile)) continue;
      const meta =
        readJson(join(sDir, "session.json")) || readJson(join(sDir, "metadata.json")) || {};
      const turns: Turn[] = [];
      for (const ev of readJsonl(eventsFile)) {
        const t = extractTurn(ev);
        if (!t) continue;
        if (t.role === "user" && isUserNoise(t.text)) continue;
        turns.push(t);
      }
      if (!turns.length) continue;
      out.push({
        platform: "copilot-cli",
        id: meta.sessionId || meta.id || d || basename(sDir),
        cwd: meta.cwd || meta.workingDirectory || meta.workspace || "",
        startedAt: Date.parse(meta.createdAt ?? meta.startTime ?? "") || 0,
        title: meta.title || meta.summary,
        turns,
      });
    }
    return out;
  },
};
