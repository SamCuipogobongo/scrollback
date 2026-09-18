// Amp (Sourcegraph): one pretty-printed JSON doc per thread.
//   ~/.local/share/amp/threads/T-*.json      (AMP_THREADS_DIR / XDG_DATA_HOME)
//   <App>/User/globalStorage/sourcegraph.amp/threads3/*.json  (legacy ext)
// Doc: {v, id, created, title, env:{initial:{trees[]}},
//       messages:[{role, content:[text|thinking|tool_use|tool_result|image]}]}
// Only type:"text" blocks are conversation; tool/thinking blocks are skipped.
// Newer Amp builds are server-authoritative and may not write this dir —
// files are still read in place where they exist.
// Env: AMP_THREADS_DIR, SCROLLBACK_AMP_ROOT.

import { join, basename } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import { cleanText, isUserNoise } from "../clean.ts";
import { HOME, envRoots, isDir, readJson } from "../util.ts";

const LEGACY_APPS = ["Code", "Code - Insiders", "VSCodium", "Cursor", "Windsurf"];

function legacyThreadsRoots(): string[] {
  const bases = [
    join(HOME, "Library/Application Support"),
    join(HOME, ".config"),
    process.env.APPDATA || "",
  ].filter(Boolean);
  const out: string[] = [];
  for (const base of bases)
    for (const app of LEGACY_APPS)
      out.push(join(base, app, "User/globalStorage/sourcegraph.amp/threads3"));
  return out;
}

function messageText(msg: any): string {
  const c = msg?.content;
  if (typeof c === "string") return cleanText(c);
  if (!Array.isArray(c)) return "";
  return cleanText(
    c
      .filter((b) => b?.type === "text" && typeof b?.text === "string")
      .map((b) => b.text)
      .join("\n"),
  );
}

function parseThread(path: string): Session | null {
  const doc = readJson(path);
  if (!doc || !Array.isArray(doc.messages)) return null;
  const turns: Turn[] = [];
  for (const m of doc.messages) {
    const role =
      m?.role === "user" ? "user" : m?.role === "assistant" ? "assistant" : null;
    if (!role) continue;
    const text = messageText(m);
    if (!text) continue;
    if (role === "user" && isUserNoise(text)) continue;
    turns.push({ role, text });
  }
  if (!turns.length) return null;
  const tree = doc.env?.initial?.trees?.[0];
  const created = doc.created;
  return {
    platform: "amp",
    id: doc.id || basename(path, ".json"),
    cwd: typeof tree === "string" ? tree : (tree?.path ?? tree?.uri ?? ""),
    startedAt:
      typeof created === "number"
        ? created < 1e12
          ? created * 1000
          : created
        : Date.parse(created ?? "") || 0,
    title: typeof doc.title === "string" ? doc.title : undefined,
    turns,
  };
}

export const amp: Source = {
  id: "amp",
  roots() {
    const out = [
      ...envRoots("amp"),
      ...(process.env.AMP_THREADS_DIR ? [process.env.AMP_THREADS_DIR] : []),
    ];
    const xdg = process.env.XDG_DATA_HOME;
    out.push(
      xdg ? join(xdg, "amp/threads") : join(HOME, ".local/share/amp/threads"),
      ...legacyThreadsRoots(),
    );
    return out;
  },
  sessions(root) {
    if (!existsSync(root) || !isDir(root)) return [];
    const out: Session[] = [];
    for (const f of readdirSync(root)) {
      if (!f.endsWith(".json")) continue;
      const s = parseThread(join(root, f));
      if (s) out.push(s);
    }
    return out;
  },
};
