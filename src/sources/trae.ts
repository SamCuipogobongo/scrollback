// Trae CN (ByteDance SOLO) — degraded adapter, verified on a real install.
// The full transcript lives in ModularData/ai-agent/database.db, which is
// SQLCipher-encrypted, and the session index is server-side. What IS
// locally readable:
//   ModularData/ai-agent/sandbox/<sid>.json          → workspace cwd, mtime
//   User/workspaceStorage/<h>/state.vscdb            →
//     ai-chat.chatQueryCompletion.v2.<sid>           → sent-prompt echoes
//     ai-chat-v2.lastActiveSessionId                 → last session
// So trae sessions surface cwd + user-side prompt fragments only — never
// assistant replies. Honest metadata, better than invisible.
// Env: SCROLLBACK_TRAE_ROOT (app-data dir, e.g. ".../Application Support/Trae CN").

import { join, basename } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { cleanText, isUserNoise } from "../clean.ts";
import {
  HOME,
  envRoots,
  isDir,
  openSqliteSnapshot,
  readJson,
} from "../util.ts";

const APPDIRS = [
  "Library/Application Support/Trae CN",
  "Library/Application Support/Trae",
  ".config/Trae CN",
  ".config/Trae",
];

interface SandboxInfo {
  cwd: string;
  mtime: number;
}

/** sandbox/<sid>.json → workspace path + file mtime */
function scanSandboxes(agentDir: string): Map<string, SandboxInfo> {
  const dir = join(agentDir, "sandbox");
  const out = new Map<string, SandboxInfo>();
  if (!isDir(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f.endsWith("-hooks.json")) continue;
    const sid = basename(f, ".json");
    let cwd = "";
    const doc = readJson(join(dir, f));
    for (const p of Array.isArray(doc?.permission) ? doc.permission : []) {
      if (p?.dir_type === "workspace" && p.file_inherit_user) {
        cwd = p.file_inherit_user;
        break;
      }
    }
    let mtime = 0;
    try {
      mtime = statSync(join(dir, f)).mtimeMs;
    } catch {}
    out.set(sid, { cwd, mtime });
  }
  return out;
}

interface WsHit {
  texts: string[];
  cwd: string;
  mtime: number;
}

function folderOf(hashDir: string): string {
  const ws = readJson(join(hashDir, "workspace.json"));
  const f = String(ws?.folder ?? "");
  return f.startsWith("file://") ? decodeURIComponent(f.slice(7)) : f;
}

/** workspaceStorage/<hash>/state.vscdb → per-sid prompt fragments + cwd */
function scanWorkspaceDbs(wsDir: string): Map<string, WsHit> {
  const out = new Map<string, WsHit>();
  if (!isDir(wsDir)) return out;
  for (const h of readdirSync(wsDir)) {
    const hashDir = join(wsDir, h);
    const dbPath = join(hashDir, "state.vscdb");
    if (!existsSync(dbPath)) continue;
    const db = openSqliteSnapshot(dbPath);
    if (!db) continue;
    try {
      const rows = db
        .prepare(
          "SELECT key, value FROM ItemTable WHERE key LIKE 'ai-chat.chatQueryCompletion.v2.%'",
        )
        .all();
      for (const r of rows) {
        const sid = String(r.key).split(".").pop() || "";
        if (!sid) continue;
        const doc = JSON.parse(String(r.value));
        const hit = out.get(sid) || {
          texts: [],
          cwd: folderOf(hashDir),
          mtime: statSync(dbPath).mtimeMs,
        };
        for (const item of Array.isArray(doc?.response?.result)
          ? doc.response.result
          : []) {
          const t = cleanText(String(item?.text ?? ""));
          if (t && !isUserNoise(t)) hit.texts.push(t);
        }
        if (hit.texts.length) out.set(sid, hit);
      }
    } catch {
      // one bad db never kills the scan
    } finally {
      db.close();
    }
  }
  return out;
}

export const trae: Source = {
  id: "trae",
  roots() {
    return [
      ...envRoots("trae"),
      ...APPDIRS.map((d) => join(HOME, d)),
    ];
  },
  sessions(root) {
    const sandboxes = scanSandboxes(join(root, "ModularData/ai-agent"));
    const fragments = scanWorkspaceDbs(join(root, "User/workspaceStorage"));
    const out: Session[] = [];
    for (const [sid, hit] of fragments) {
      const turns: Turn[] = hit.texts.map((text) => ({
        role: "user" as const,
        text,
      }));
      const sb = sandboxes.get(sid);
      out.push({
        platform: "trae",
        id: sid,
        cwd: hit.cwd || sb?.cwd || "",
        startedAt: sb?.mtime || hit.mtime || 0,
        turns,
      });
    }
    return out;
  },
};
