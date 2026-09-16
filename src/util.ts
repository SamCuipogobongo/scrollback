// Small shared utilities: paths, JSON, filesystem walks, sqlite snapshots.

import {
  readdirSync,
  readFileSync,
  statSync,
  existsSync,
  copyFileSync,
  mkdtempSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createRequire } from "node:module";

export const HOME = homedir();
const nodeRequire = createRequire(import.meta.url);

/** Read+parse a JSON file; null on any failure. */
export function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Iterate a JSONL file, yielding parsed objects. */
export function* readJsonl(path: string): Generator<any> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      continue;
    }
  }
}

/** Recursively list files under dir matching `exts` ([".jsonl"] etc). */
export function walkFiles(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/** Expand ~ and env overrides: SCROLLBACK_<ID>_ROOT (':'-separated list). */
export function envRoots(id: string): string[] {
  const v = process.env[`SCROLLBACK_${id.toUpperCase().replace(/-/g, "_")}_ROOT`];
  return v ? v.split(":").filter(Boolean) : [];
}

/**
 * Open a sqlite db read-only on a tmp snapshot (copies db+wal+shm) so a live
 * writer never blocks us. Caller must close. Returns null if unavailable.
 */
export function openSqliteSnapshot(dbPath: string): any {
  try {
    const tmp = mkdtempSync(join(tmpdir(), "scrollback-db-"));
    for (const suffix of ["", "-wal", "-shm"]) {
      const src = dbPath + suffix;
      if (existsSync(src)) copyFileSync(src, join(tmp, "snap.db" + suffix));
    }
    const { DatabaseSync } = nodeRequire("node:sqlite");
    return new DatabaseSync(join(tmp, "snap.db"), { readOnly: true });
  } catch {
    return null;
  }
}

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Decode a dash-joined project dir name (claude/factory style) to a path guess. */
export function decodeDashedPath(name: string): string {
  return name.startsWith("-") ? name.replace(/-/g, "/") : name;
}
