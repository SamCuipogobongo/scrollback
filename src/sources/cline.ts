// Cline CLI (standalone), verified on a real install (v3.0.62):
//   ~/.cline/data/sessions/<sid>/<sid>.json           meta: cwd/workspace_root,
//                                                     started_at, metadata.title
//   ~/.cline/data/sessions/<sid>/<sid>.messages.json  {messages:[{role,content,ts}]}
//   content blocks: text | thinking — text only; user text arrives wrapped in
//   <user_input …>…</user_input> (stripped by cleanText).
// Legacy/docs layout also accepted: tasks/<taskId>/api_conversation_history.json
// (same shape the VS Code extension writes — extension copies are covered by
// vscode-family as "<app>:cline").
// CLINE_DIR replaces ~/.cline; CLINE_DATA_DIR replaces ~/.cline/data.
// Env: SCROLLBACK_CLINE_ROOT.

import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { cleanText, isUserNoise } from "../clean.ts";
import { HOME, envRoots, isDir, readJson } from "../util.ts";
import { extractTurn } from "./jsonl.ts";

function blockText(content: any): string {
  if (typeof content === "string") return cleanText(content);
  if (!Array.isArray(content)) return "";
  return cleanText(
    content
      .filter(
        (b) => (!b?.type || b.type === "text") && typeof b?.text === "string",
      )
      .map((b) => b.text)
      .join("\n"),
  );
}

// sessions/<sid>/<sid>.{json,messages.json}
function parseSessionDir(dir: string, id: string): Session | null {
  const doc = readJson(join(dir, `${id}.messages.json`));
  const msgs: any[] = Array.isArray(doc)
    ? doc
    : Array.isArray(doc?.messages)
      ? doc.messages
      : [];
  const turns: Turn[] = [];
  for (const m of msgs) {
    const role =
      m?.role === "user" ? "user" : m?.role === "assistant" ? "assistant" : null;
    if (!role) continue;
    const text = blockText(m?.content);
    if (!text) continue;
    if (role === "user" && isUserNoise(text)) continue;
    turns.push({ role, text });
  }
  if (!turns.length) return null;
  const meta = readJson(join(dir, `${id}.json`)) ?? {};
  const firstTs =
    msgs.map((m) => Number(m?.ts) || Date.parse(m?.ts ?? "") || 0).find(Boolean) || 0;
  return {
    platform: "cline",
    id: String(meta.session_id || id),
    cwd: meta.workspace_root || meta.cwd || "",
    startedAt:
      Number(meta.started_at) || Date.parse(meta.started_at ?? "") || firstTs,
    title:
      typeof meta.metadata?.title === "string"
        ? meta.metadata.title
        : undefined,
    turns,
  };
}

// tasks/<taskId>/api_conversation_history.json (legacy / doc'd layout)
function parseTaskFile(path: string, taskId: string): Session | null {
  const arr = readJson(path);
  const msgs: any[] = Array.isArray(arr)
    ? arr
    : Array.isArray(arr?.messages)
      ? arr.messages
      : Array.isArray(arr?.conversation)
        ? arr.conversation
        : [];
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
  return { platform: "cline", id: taskId, cwd: "", startedAt, turns };
}

export const cline: Source = {
  id: "cline",
  roots() {
    const out = [
      ...envRoots("cline"),
      join(HOME, ".cline/data/sessions"),
      join(HOME, ".cline/data/tasks"),
    ];
    // CLINE_DIR replaces ~/.cline (data lives one level down); CLINE_DATA_DIR
    // replaces ~/.cline/data. Both spellings are pushed for each — missing
    // roots are filtered out downstream anyway.
    for (const v of [process.env.CLINE_DIR, process.env.CLINE_DATA_DIR])
      if (v)
        out.push(
          join(v, "data/sessions"),
          join(v, "data/tasks"),
          join(v, "sessions"),
          join(v, "tasks"),
        );
    // CLINE_SESSION_DATA_DIR points at the sessions/ leaf itself
    if (process.env.CLINE_SESSION_DATA_DIR)
      out.push(process.env.CLINE_SESSION_DATA_DIR);
    return [...new Set(out)];
  },
  sessions(root) {
    if (!existsSync(root) || !isDir(root)) return [];
    const out: Session[] = [];
    const seen = new Set<string>();
    // root may be the leaf (…/sessions|…/tasks) or a parent that contains them
    for (const scan of [root, join(root, "sessions"), join(root, "tasks")]) {
      if (!isDir(scan)) continue;
      for (const id of readdirSync(scan)) {
        const dir = join(scan, id);
        if (!isDir(dir)) continue;
        let s: Session | null = null;
        if (existsSync(join(dir, `${id}.messages.json`)))
          s = parseSessionDir(dir, id);
        else if (existsSync(join(dir, "api_conversation_history.json")))
          s = parseTaskFile(join(dir, "api_conversation_history.json"), id);
        if (s && !seen.has(s.id)) {
          seen.add(s.id);
          out.push(s);
        }
      }
    }
    return out;
  },
};
