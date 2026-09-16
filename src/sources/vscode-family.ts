// VS Code family — one discovery layer over every VS Code-derived editor:
//   <AppData>/<App>/User/globalStorage/<ext>/tasks/*/api_conversation_history.json   (cline/roo/kilo…)
//   <AppData>/<App>/User/globalStorage/<ext>/**/{conversations,sessions,chat}/*.{json,jsonl} (trae/qoder/codebuddy agents — best effort)
//   <AppData>/<App>/User/workspaceStorage/*/chatSessions/*.{json,jsonl}              (copilot chat)
//   <AppData>/<App>/User/globalStorage/emptyWindowChatSessions/*.{json,jsonl}
// Apps scanned: Code, Code - Insiders, VSCodium, Cursor, Windsurf(-Next), Trae,
// Trae CN, Qoder, Kiro, CodeBuddy, Void, Positron. Sessions are tagged with the
// app name as platform (e.g. "trae") — or "<app>:cline"/"copilot-chat" where the
// writer is identifiable.
// Env: SCROLLBACK_VSCODE_ROOTS (':'-separated <App>/User roots).

import { join, basename } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { cleanText, isUserNoise } from "../clean.ts";
import { HOME, envRoots, isDir, readJson, readJsonl, walkFiles } from "../util.ts";
import { extractTurn, textOf } from "./jsonl.ts";

const APPS = [
  "Code",
  "Code - Insiders",
  "VSCodium",
  "Cursor",
  "Windsurf",
  "Windsurf - Next",
  "Trae",
  "Trae CN",
  "Qoder",
  "Kiro",
  "CodeBuddy",
  "Void",
  "Positron",
];

function appDataDirs(): string[] {
  const dirs: string[] = [];
  const bases = [
    join(HOME, "Library/Application Support"),
    join(HOME, ".config"),
    process.env.APPDATA || "",
  ].filter(Boolean);
  for (const base of bases) {
    for (const app of APPS) {
      const p = join(base, app, "User");
      if (existsSync(p)) dirs.push(p + "|" + app);
    }
  }
  return dirs;
}

function platformTag(app: string, writer: string): string {
  const a = app.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");
  return writer ? `${a}:${writer}` : a;
}

/** Cline-family api_conversation_history.json → messages[] array */
function parseTaskFile(path: string, app: string, ext: string): Session | null {
  const arr = readJson(path);
  const msgs: any[] = Array.isArray(arr) ? arr : arr?.messages || arr?.conversation || [];
  const turns: Turn[] = [];
  let startedAt = 0;
  for (const m of msgs) {
    const t = extractTurn(m);
    if (!t) continue;
    if (t.role === "user" && isUserNoise(t.text)) continue;
    if (!startedAt && m?.ts) startedAt = Number(m.ts) || Date.parse(m.ts) || 0;
    turns.push(t);
  }
  if (!turns.length) return null;
  const writer = /cline|roo|kilo/i.test(ext) ? "cline" : ext;
  const taskId = basename(join(path, ".."));
  return {
    platform: platformTag(app, writer),
    id: `${writer}-${taskId}`,
    cwd: "",
    startedAt,
    turns,
  };
}

/** Copilot Chat chatSessions file → {requests:[{message:{text},response}]} */
function parseChatSession(path: string, app: string): Session | null {
  const doc = readJson(path);
  if (!doc || typeof doc !== "object") return null;
  const reqs: any[] = Array.isArray(doc.requests) ? doc.requests : [];
  if (!reqs.length && !Array.isArray(doc.messages)) {
    // maybe jsonl
    return parseChatSessionJsonl(path, app);
  }
  const turns: Turn[] = [];
  for (const r of reqs) {
    const uText = cleanText(textOf(r?.message?.text ?? r?.message ?? ""));
    if (uText && !isUserNoise(uText)) turns.push({ role: "user", text: uText });
    const aText = cleanText(
      textOf(r?.response?.value ?? r?.response?.message ?? r?.response ?? ""),
    );
    if (aText) turns.push({ role: "assistant", text: aText });
  }
  if (!turns.length) return null;
  return {
    platform: platformTag(app, "copilot-chat"),
    id: doc.sessionId || basename(path).replace(/\.jsonl?$/, ""),
    cwd: "",
    startedAt: Date.parse(doc.creationDate ?? doc.createdAt ?? "") || 0,
    title: doc.customTitle || doc.title,
    turns,
  };
}

function parseChatSessionJsonl(path: string, app: string): Session | null {
  const turns: Turn[] = [];
  for (const ev of readJsonl(path)) {
    const t = extractTurn(ev);
    if (!t) continue;
    if (t.role === "user" && isUserNoise(t.text)) continue;
    turns.push(t);
  }
  if (!turns.length) return null;
  return {
    platform: platformTag(app, "copilot-chat"),
    id: basename(path).replace(/\.jsonl?$/, ""),
    cwd: "",
    startedAt: 0,
    turns,
  };
}

/** Best-effort generic conversation file (trae/qoder/codebuddy agent stores). */
function parseGeneric(path: string, app: string, ext: string): Session | null {
  const doc = path.endsWith(".jsonl") ? null : readJson(path);
  const turns: Turn[] = [];
  let startedAt = 0;
  if (doc) {
    const msgs: any[] = Array.isArray(doc)
      ? doc
      : doc.messages || doc.history || doc.conversation || doc.records || [];
    for (const m of msgs) {
      const t = extractTurn(m);
      if (!t) continue;
      if (t.role === "user" && isUserNoise(t.text)) continue;
      turns.push(t);
    }
    startedAt = Date.parse(doc.createdAt ?? doc.created_at ?? doc.startTime ?? "") || 0;
  } else {
    for (const ev of readJsonl(path)) {
      const t = extractTurn(ev);
      if (!t) continue;
      if (t.role === "user" && isUserNoise(t.text)) continue;
      turns.push(t);
    }
  }
  if (turns.length < 2) return null; // single-turn files are usually not conversations
  return {
    platform: platformTag(app, ext || "agent"),
    id: basename(path).replace(/\.jsonl?$/, ""),
    cwd: "",
    startedAt,
    turns,
  };
}

export const vscodeFamily: Source = {
  id: "vscode",
  roots() {
    return [
      ...envRoots("vscode"),
      ...appDataDirs(),
    ];
  },
  sessions(root) {
    // roots() entries carry "<path>|<app>" — split; bare paths get generic tag
    const [dir, appRaw] = root.split("|");
    const app = appRaw || "vscode";
    if (!existsSync(dir) || !isDir(dir)) return [];
    const out: Session[] = [];
    const seen = new Set<string>();

    const push = (s: Session | null) => {
      if (s && !seen.has(s.id)) {
        seen.add(s.id);
        out.push(s);
      }
    };

    // 1) cline-family tasks under globalStorage/<ext>/tasks/*/
    const gs = join(dir, "globalStorage");
    if (existsSync(gs)) {
      for (const ext of readdirSync(gs)) {
        const tasksDir = join(gs, ext, "tasks");
        if (isDir(tasksDir)) {
          for (const task of readdirSync(tasksDir)) {
            const f = join(tasksDir, task, "api_conversation_history.json");
            if (existsSync(f)) push(parseTaskFile(f, app, ext));
          }
        }
        // 2) generic agent conversation dirs — bounded scan
        const extDir = join(gs, ext);
        if (!isDir(extDir)) continue;
        const hits = walkFiles(extDir, [".json", ".jsonl"]).filter(
          (p) => /conversations?|sessions?|chat|history/i.test(p) && !/tasks\//.test(p),
        );
        for (const f of hits.slice(0, 100)) push(parseGeneric(f, app, ext));
      }
    }

    // 3) copilot chat sessions
    const ws = join(dir, "workspaceStorage");
    if (existsSync(ws)) {
      for (const h of readdirSync(ws)) {
        const cs = join(ws, h, "chatSessions");
        if (!isDir(cs)) continue;
        for (const f of readdirSync(cs)) {
          if (/\.jsonl?$/.test(f)) push(parseChatSession(join(cs, f), app));
        }
      }
    }
    const empty = join(gs, "emptyWindowChatSessions");
    if (isDir(empty)) {
      for (const f of readdirSync(empty)) {
        if (/\.jsonl?$/.test(f)) push(parseChatSession(join(empty, f), app));
      }
    }
    return out;
  },
};
