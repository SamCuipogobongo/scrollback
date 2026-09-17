// scrollback channel store — event-sourced local message bus.
// ~/.scrollback/channels/<bucket>/<channel>/{events.jsonl,meta.json,.seq,.lock}
// bucket = sanitized cwd (same convention as ~/.claude/projects), "_global"
// for machine-wide channels. Single-writer via O_EXCL lockfile with stale-pid
// steal; monotonic seq with a sidecar for fast append; idempotencyKey dedup.

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { HOME, envRoots } from "../util.ts";

export interface ChannelEvent {
  seq: number;
  ts: string;
  kind: string;
  by: string;
  to?: string;
  thread?: string;
  body?: string;
  worker?: string;
  agent?: string;
  pid?: number;
  idempotencyKey?: string;
  [k: string]: unknown;
}

export interface ChannelMeta {
  name: string;
  type: "chat" | "forum";
  cwd: string;
  created: string;
  description?: string;
}

export const GLOBAL_BUCKET = "_global";

export function channelRoot(): string {
  const env = envRoots("channel")[0];
  return env || join(HOME, ".scrollback/channels");
}

export function bucketOf(cwd: string): string {
  return cwd.replace(/[\\/_]/g, "-").replace(/[^A-Za-z0-9.-]/g, "-");
}

function bucketFor(global: boolean): string {
  return global ? GLOBAL_BUCKET : bucketOf(process.cwd());
}

export function channelDir(name: string, global = false): string {
  return join(channelRoot(), bucketFor(global), name);
}

const eventsPath = (dir: string) => join(dir, "events.jsonl");
const metaPath = (dir: string) => join(dir, "meta.json");
const seqPath = (dir: string) => join(dir, ".seq");
const lockPath = (dir: string) => join(dir, ".lock");
const cursorDir = (dir: string) => join(dir, ".cursors");

const NAME_RE = /^[A-Za-z0-9._-]+$/;
export function validName(name: string): boolean {
  return NAME_RE.test(name);
}

// ---- advisory lock: O_EXCL lockfile holding owner pid; steal if dead ----

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(lock: string, maxWaitMs = 5000): void {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return;
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
      let stale = false;
      try {
        const pid = Number(readFileSync(lock, "utf8").trim());
        if (pid && !pidAlive(pid)) stale = true;
      } catch {
        stale = true; // unreadable lock — treat as stale
      }
      if (stale) {
        try {
          unlinkSync(lock);
        } catch {}
        continue;
      }
      if (Date.now() > deadline) throw new Error(`channel lock timeout: ${lock}`);
      const until = Date.now() + 25;
      while (Date.now() < until) {} // ~25ms backoff; sync lock is held briefly
    }
  }
}

function releaseLock(lock: string): void {
  try {
    unlinkSync(lock);
  } catch {}
}

// ---- seq sidecar: fast last-seq, reconcile against jsonl tail ----

function lastSeq(dir: string): number {
  const f = eventsPath(dir);
  if (!existsSync(f)) return 0;
  let side = 0;
  try {
    side = Number(readFileSync(seqPath(dir), "utf8").trim()) || 0;
  } catch {}
  // trust sidecar but verify the file isn't shorter than it claims
  const tail = readFileSync(f, "utf8");
  const lines = tail.trimEnd().split("\n").filter(Boolean);
  const lastLine = lines.length ? lines[lines.length - 1] : null;
  let last = 0;
  if (lastLine) {
    try {
      last = Number(JSON.parse(lastLine).seq) || 0;
    } catch {}
  }
  return Math.max(side, last);
}

// ---- public api ----

export function createChannel(
  name: string,
  opts: { global?: boolean; type?: "chat" | "forum"; description?: string; by?: string },
): { dir: string; created: boolean } {
  if (!validName(name)) throw new Error(`bad channel name: ${name}`);
  const dir = channelDir(name, opts.global);
  const created = !existsSync(eventsPath(dir));
  mkdirSync(dir, { recursive: true });
  if (created) {
    const meta: ChannelMeta = {
      name,
      type: opts.type || "chat",
      cwd: process.cwd(),
      created: new Date().toISOString(),
      description: opts.description,
    };
    writeFileSync(metaPath(dir), JSON.stringify(meta, null, 2) + "\n");
    appendEvent(dir, { kind: "create", by: opts.by || "user", body: opts.description });
  }
  return { dir, created };
}

export type EventDraft = { kind: string; by: string; ts?: string } & Record<
  string,
  unknown
>;

export function appendEvent(dir: string, partial: EventDraft): ChannelEvent {
  mkdirSync(dir, { recursive: true });
  const lock = lockPath(dir);
  acquireLock(lock);
  try {
    if (partial.idempotencyKey) {
      const dup = readEvents(dir).find((e) => e.idempotencyKey === partial.idempotencyKey);
      if (dup) return dup;
    }
    const ev = {
      ...partial,
      seq: lastSeq(dir) + 1,
      ts: partial.ts || new Date().toISOString(),
    } as ChannelEvent;
    appendFileSync(eventsPath(dir), JSON.stringify(ev) + "\n");
    writeFileSync(seqPath(dir), String(ev.seq));
    return ev;
  } finally {
    releaseLock(lock);
  }
}

export function readEvents(dir: string): ChannelEvent[] {
  const f = eventsPath(dir);
  if (!existsSync(f)) return [];
  const out: ChannelEvent[] = [];
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {}
  }
  return out;
}

export function readMeta(dir: string): ChannelMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath(dir), "utf8"));
  } catch {
    return null;
  }
}

/** every channel dir across all buckets: [{dir, bucket, name}] */
export function listChannels(root = channelRoot()): { dir: string; bucket: string; name: string }[] {
  if (!existsSync(root)) return [];
  const out: { dir: string; bucket: string; name: string }[] = [];
  for (const b of readdirSync(root)) {
    const bdir = join(root, b);
    try {
      if (!statSync(bdir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const c of readdirSync(bdir)) {
      const cdir = join(bdir, c);
      if (NAME_RE.test(c) && existsSync(eventsPath(cdir))) out.push({ dir: cdir, bucket: b, name: c });
    }
  }
  return out;
}

// ---- inbox cursors: .cursors/<worker> holds last-read seq ----

export function readCursor(dir: string, worker: string): number {
  try {
    return Number(readFileSync(join(cursorDir(dir), worker), "utf8").trim()) || 0;
  } catch {
    return 0;
  }
}

export function writeCursor(dir: string, worker: string, seq: number): void {
  mkdirSync(cursorDir(dir), { recursive: true });
  writeFileSync(join(cursorDir(dir), worker), String(seq));
}

// ---- watch: byte-offset tail-follow with partial-line carry ----

export async function* watchEvents(
  dir: string,
  opts: { from?: number; kinds?: Set<string>; timeoutMs?: number; signal?: AbortSignal },
): AsyncGenerator<ChannelEvent> {
  const f = eventsPath(dir);
  let offset = 0;
  let carry = "";
  const deadline = opts.timeoutMs ? Date.now() + opts.timeoutMs : Infinity;
  while (Date.now() < deadline && !opts.signal?.aborted) {
    if (existsSync(f)) {
      const size = statSync(f).size;
      if (size < offset) {
        offset = 0;
        carry = "";
      }
      if (size > offset) {
        const buf = readFileSync(f); // small files; simple and correct
        const text = carry + buf.subarray(offset).toString("utf8");
        const lines = text.split("\n");
        carry = lines.pop() ?? "";
        offset = size;
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          let ev: ChannelEvent;
          try {
            ev = JSON.parse(t);
          } catch {
            continue;
          }
          if (opts.from !== undefined && ev.seq <= opts.from) continue;
          if (opts.kinds && !opts.kinds.has(ev.kind)) continue;
          yield ev;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}
