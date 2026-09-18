// Source registry + session loading. Auto-detection = a root that exists.

import type { Session, Source } from "./types.ts";
import { dedupeTurns } from "./clean.ts";
import { existsSync } from "node:fs";
import { claude } from "./sources/claude.ts";
import { codex } from "./sources/codex.ts";
import { devin } from "./sources/devin.ts";
import { opencode } from "./sources/opencode.ts";
import { qwen, gemini } from "./sources/gemini-family.ts";
import { factory } from "./sources/factory.ts";
import { kimi } from "./sources/kimi.ts";
import { cont } from "./sources/continue.ts";
import { copilotCli } from "./sources/copilot-cli.ts";
import { cursor } from "./sources/cursor.ts";
import { zed } from "./sources/zed.ts";
import { vscodeFamily } from "./sources/vscode-family.ts";
import { aider } from "./sources/aider.ts";
import { goose } from "./sources/goose.ts";
import { antigravity } from "./sources/antigravity.ts";
import { codebuddy } from "./sources/codebuddy.ts";
import { trae } from "./sources/trae.ts";
import { amp } from "./sources/amp.ts";
import { cline } from "./sources/cline.ts";
import { channelSource } from "./sources/channel.ts";

export const SOURCES: Source[] = [
  claude,
  codex,
  devin,
  opencode,
  qwen,
  gemini,
  factory,
  kimi,
  cont,
  copilotCli,
  cursor,
  zed,
  vscodeFamily,
  aider,
  goose,
  antigravity,
  codebuddy,
  trae,
  amp,
  cline,
  channelSource,
];

export interface DetectedSource {
  source: Source;
  roots: string[];
}

/** Sources whose storage exists on this machine (or env-overridden). */
export function detectSources(): DetectedSource[] {
  return SOURCES.map((source) => ({
    source,
    roots: source.roots().filter((r) => !r.includes("*") && existsSync(r)),
  })).filter((d) => d.roots.length > 0);
}

export function loadAll(platform?: string): Session[] {
  const all: Session[] = [];
  const want = (p: string) =>
    p === platform || p.startsWith(platform + ":"); // "trae:cline" matches --platform trae
  for (const source of SOURCES) {
    const family = source.id === "vscode"; // produces per-app platform tags
    if (platform && platform !== "all" && source.id !== platform && !family) continue;
    for (const root of source.roots()) {
      try {
        for (const s of source.sessions(root)) {
          if (platform && platform !== "all" && !want(s.platform)) continue;
          all.push(s);
        }
      } catch {
        continue; // one bad store never kills the scan
      }
    }
  }
  for (const s of all) s.turns = dedupeTurns(s.turns);
  return all.filter((s) => s.turns.length);
}

export const sinceMs = (d?: string) => (d ? Date.parse(d + "T00:00:00") : 0);
export const untilMs = (d?: string) => (d ? Date.parse(d + "T23:59:59") : Infinity);

export function applyScope(
  sessions: Session[],
  f: Record<string, string | boolean>,
): Session[] {
  const since = sinceMs(f.since as string);
  const until = untilMs(f.until as string);
  let out = sessions.filter((s) => s.startedAt >= since && s.startedAt <= until);
  if (!f.global) {
    const cwd = ((f.cwd as string) || process.cwd()).replace(/\/+$/, "");
    const home = process.env.HOME || "";
    out = out.filter(
      (s) =>
        s.cwd === cwd ||
        s.cwd === cwd.replace(/^~/, home) ||
        s.cwd === cwd.replace(home, "~"),
    );
  }
  return out;
}

export const fmtDate = (ms: number) =>
  ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "????-??-?? ??:??";

export const matchSession = (sessions: Session[], prefix: string) =>
  sessions.find((s) => s.id === prefix || s.id.startsWith(prefix));
