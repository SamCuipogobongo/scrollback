// Cursor — two sources of truth:
//   IDE:  <AppData>/Cursor/User/globalStorage/state.vscdb
//         ItemTable['composer.composerHeaders'] = session list
//         cursorDiskKV['bubbleId:<composerId>:<bubbleId>'] = message blobs
//         workspaceStorage/<hash>/{state.vscdb,workspace.json} = cwd mapping
//   CLI:  ~/.cursor/projects/**/agent-transcripts/**/*.jsonl
// Env: CURSOR_CONFIG_DIR, SCROLLBACK_CURSOR_ROOT, SCROLLBACK_CURSOR_CLI_ROOT.

import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { cleanText, isUserNoise } from "../clean.ts";
import { HOME, envRoots, readJsonl, walkFiles, openSqliteSnapshot } from "../util.ts";
import { extractTurn } from "./jsonl.ts";

function cursorConfigDir(): string {
  return (
    process.env.CURSOR_CONFIG_DIR ||
    join(HOME, "Library/Application Support/Cursor")
  );
}

function bubbleRole(v: any): "user" | "assistant" | null {
  const t = v?.type;
  if (t === 1 || t === "user" || t === "human") return "user";
  if (t === 2 || t === "assistant" || t === "ai") return "assistant";
  return null;
}

function bubbleText(v: any): string {
  return cleanText(
    typeof v === "string" ? v : v?.text ?? v?.richText ?? v?.message ?? v?.content ?? "",
  );
}

function parseStateDb(dbPath: string): Session[] {
  const d = openSqliteSnapshot(dbPath);
  if (!d) return [];
  const out: Session[] = [];
  try {
    // session headers (3.x)
    const headersRow = d
      .prepare(`SELECT value FROM ItemTable WHERE key='composer.composerHeaders'`)
      .get() as any;
    const parsed: any = headersRow ? JSON.parse(headersRow.value) : [];
    const headers: any[] = Array.isArray(parsed) ? parsed : [];
    const meta = new Map<string, any>();
    for (const h of headers) if (h?.composerId) meta.set(h.composerId, h);

    // message bubbles
    const bubbles = d
      .prepare(`SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'`)
      .all() as any[];
    const byComposer = new Map<string, Session>();
    for (const row of bubbles) {
      const [, composerId] = String(row.key).split(":");
      let v: any;
      try {
        v = JSON.parse(row.value);
      } catch {
        continue;
      }
      const role = bubbleRole(v);
      if (!role) continue;
      const text = bubbleText(v);
      if (!text) continue;
      if (role === "user" && isUserNoise(text)) continue;
      let s = byComposer.get(composerId);
      if (!s) {
        const h = meta.get(composerId) || {};
        s = {
          platform: "cursor",
          id: composerId,
          cwd:
            h.folderPath || h.workspacePath ||
            (typeof h.uri === "string"
              ? decodeURIComponent(h.uri.replace(/^file:\/\//, ""))
              : ""),
          startedAt: h.lastUpdatedAt || h.createdAt || 0,
          title: h.name || h.title || undefined,
          turns: [],
        };
        byComposer.set(composerId, s);
      }
      s.turns.push({ role, text });
    }
    out.push(...[...byComposer.values()].filter((s) => s.turns.length));

    // legacy 2.x: aiService.prompts lives in per-workspace dbs; handled by caller
  } catch {
    // fall through
  } finally {
    d.close();
  }
  return out;
}

function parseCliTranscripts(root: string): Session[] {
  const out: Session[] = [];
  for (const f of walkFiles(root, [".jsonl"])) {
    if (!f.includes("agent-transcripts")) continue;
    const turns: Turn[] = [];
    let cwd = "";
    let startedAt = 0;
    for (const ev of readJsonl(f)) {
      if (!cwd && ev.cwd) cwd = ev.cwd;
      if (!startedAt && ev.timestamp) startedAt = Date.parse(ev.timestamp) || 0;
      const t = extractTurn(ev);
      if (!t) continue;
      if (t.role === "user" && isUserNoise(t.text)) continue;
      turns.push(t);
    }
    if (turns.length)
      out.push({
        platform: "cursor",
        id: basename(f, ".jsonl"),
        cwd,
        startedAt,
        turns,
      });
  }
  return out;
}

export const cursor: Source = {
  id: "cursor",
  roots() {
    const cfg = cursorConfigDir();
    return [
      ...envRoots("cursor"),
      join(cfg, "User/globalStorage"),
      process.env.SCROLLBACK_CURSOR_CLI_ROOT || join(HOME, ".cursor/projects"),
      // linux + windows spellings
      join(HOME, ".config/Cursor/User/globalStorage"),
    ];
  },
  sessions(root) {
    if (root.endsWith("globalStorage")) {
      const db = join(root, "state.vscdb");
      return existsSync(db) ? parseStateDb(db) : [];
    }
    return parseCliTranscripts(root);
  },
};
