// scrollback channel store — event-sourced local message bus.
// ~/.scrollback/channels/<bucket>/<channel>/{events.jsonl,meta.json,.seq,.lock}
// bucket = sanitized cwd (same convention as ~/.claude/projects), "_global"
// for machine-wide channels. Single-writer via O_EXCL lockfile with stale-pid
// steal; monotonic seq with a sidecar for fast append; idempotencyKey dedup.

import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
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
const keysPath = (dir: string) => join(dir, ".keys");
const workersPath = (dir: string) => join(dir, ".workers.json");

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const DOTS_RE = /^\.+$/; // "."/".." would escape the bucket via path join
export function validName(name: string): boolean {
  return NAME_RE.test(name) && !DOTS_RE.test(name);
}

// ---- advisory lock: O_EXCL lockfile holding owner pid; steal if dead ----

/** undefined pid → "don't know" → treat as alive; EPERM → alive but not ours. */
export function pidAlive(pid?: number): boolean {
  if (!pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code !== "ESRCH"; // ESRCH = gone; EPERM = alive, someone else's
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

export function withLock<T>(dir: string, fn: () => T): T {
  const lock = lockPath(dir);
  acquireLock(lock);
  try {
    return fn();
  } finally {
    releaseLock(lock);
  }
}

// ---- seq sidecar: fast last-seq, reconcile against jsonl tail ----

export function lastSeq(dir: string): number {
  const f = eventsPath(dir);
  let size = 0;
  try {
    size = statSync(f).size;
  } catch {
    return 0;
  }
  if (!size) return 0;
  let side = 0;
  try {
    side = Number(readFileSync(seqPath(dir), "utf8").trim()) || 0;
  } catch {}
  // trust the sidecar, but verify against the last line — read only the tail
  const fd = openSync(f, "r");
  let lastLine = "";
  try {
    const len = Math.min(size, 8192);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").trimEnd().split("\n").filter(Boolean);
    lastLine = lines.length ? lines[lines.length - 1] : "";
  } finally {
    closeSync(fd);
  }
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
  mkdirSync(dir, { recursive: true });
  // whole check+meta+create-event under one lock: no double-create races
  return withLock(dir, () => {
    const created = !existsSync(eventsPath(dir));
    if (created) {
      const meta: ChannelMeta = {
        name,
        type: opts.type || "chat",
        cwd: process.cwd(),
        created: new Date().toISOString(),
        description: opts.description,
      };
      writeFileSync(metaPath(dir), JSON.stringify(meta, null, 2) + "\n");
      appendEventLocked(dir, { kind: "create", by: opts.by || "user", body: opts.description });
    }
    return { dir, created };
  });
}

export type EventDraft = { kind: string; by: string; ts?: string } & Record<
  string,
  unknown
>;

// ---- idempotency: .keys sidecar (key\t<event json>) — O(keyed), not O(log) ----

function findByKey(dir: string, key: string): ChannelEvent | null {
  let text: string;
  try {
    text = readFileSync(keysPath(dir), "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0 || line.slice(0, tab) !== key) continue;
    try {
      return JSON.parse(line.slice(tab + 1));
    } catch {
      return null;
    }
  }
  return null;
}

// ---- workers sidecar: .workers.json — projected per append, O(1) reads ----

export type Lifecycle = "starting" | "running" | "done" | "error" | "killed" | "crashed";
export interface WorkerState {
  worker: string;
  agent?: string;
  pid?: number;
  lifecycle: Lifecycle;
  activity: "idle" | "mid-turn";
  lastKind: string;
  lastTs: string;
}

const TERMINAL_KINDS = new Set(["done", "error", "killed"]);

/** fold one event into a worker's projected state (shared by sidecar + full scans) */
export function updateWorkerState(v: WorkerState, ev: ChannelEvent): void {
  v.lastKind = ev.kind;
  v.lastTs = ev.ts;
  if (ev.agent) v.agent = String(ev.agent);
  if (ev.pid) v.pid = Number(ev.pid);
  switch (ev.kind) {
    case "spawned":
      v.lifecycle = "starting";
      break;
    case "turn_started":
      v.lifecycle = "running";
      v.activity = "mid-turn";
      break;
    case "turn_finished":
    case "waiting":
    case "awake":
      if (!TERMINAL_KINDS.has(v.lifecycle)) v.lifecycle = "running";
      v.activity = "idle";
      break;
    case "progress":
      if (!TERMINAL_KINDS.has(v.lifecycle)) v.lifecycle = "running";
      break;
    case "done":
    case "error":
    case "killed":
      v.lifecycle = ev.kind;
      v.activity = "idle";
      break;
    case "interrupted":
      v.activity = "idle";
      break;
  }
}

export function readWorkersSidecar(dir: string): Map<string, WorkerState> | null {
  try {
    const obj = JSON.parse(readFileSync(workersPath(dir), "utf8"));
    return new Map(Object.entries(obj));
  } catch {
    return null;
  }
}

export function writeWorkersSidecar(dir: string, ws: Map<string, WorkerState>): void {
  writeFileSync(workersPath(dir), JSON.stringify(Object.fromEntries(ws)));
}

function updateWorkersSidecar(dir: string, ev: ChannelEvent): void {
  const w = ev.worker || (ev.kind === "spawned" ? String(ev.by) : undefined);
  if (!w) return;
  const ws = readWorkersSidecar(dir);
  if (!ws) return; // no sidecar yet — read side lazy-builds from the full log
  let v = ws.get(w);
  if (!v) {
    v = { worker: w, lifecycle: "starting", activity: "idle", lastKind: "", lastTs: "" };
    ws.set(w, v);
  }
  updateWorkerState(v, ev);
  writeWorkersSidecar(dir, ws);
}

function appendEventLocked(dir: string, partial: EventDraft): ChannelEvent {
  if (partial.idempotencyKey) {
    const key = String(partial.idempotencyKey);
    if (/[\t\n]/.test(key)) throw new Error("idempotencyKey must not contain tab/newline");
    const dup = findByKey(dir, key);
    if (dup) return dup;
  }
  const ev = {
    ...partial,
    seq: lastSeq(dir) + 1,
    ts: partial.ts || new Date().toISOString(),
  } as ChannelEvent;
  const line = JSON.stringify(ev);
  appendFileSync(eventsPath(dir), line + "\n");
  writeFileSync(seqPath(dir), String(ev.seq));
  if (partial.idempotencyKey)
    appendFileSync(keysPath(dir), `${partial.idempotencyKey}\t${line}\n`);
  updateWorkersSidecar(dir, ev);
  return ev;
}

export function appendEvent(dir: string, partial: EventDraft): ChannelEvent {
  mkdirSync(dir, { recursive: true });
  return withLock(dir, () => appendEventLocked(dir, partial));
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

const CHUNK = 65536;

/**
 * Events with seq > fromSeq, scanned backward in 64KB chunks — stops at the
 * first seq <= fromSeq, so cost is O(new events + one chunk), not O(log size).
 */
export function readEventsFrom(dir: string, fromSeq: number): ChannelEvent[] {
  const f = eventsPath(dir);
  let size = 0;
  try {
    size = statSync(f).size;
  } catch {
    return [];
  }
  if (!size) return [];
  const fd = openSync(f, "r");
  try {
    const out: ChannelEvent[] = [];
    let pos = size;
    let carry = ""; // partial line at the chunk's leading edge
    let done = false;
    while (pos > 0 && !done) {
      const start = Math.max(0, pos - CHUNK);
      const buf = Buffer.alloc(pos - start);
      readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString("utf8") + carry;
      pos = start;
      const lines = text.split("\n");
      carry = lines.shift() ?? ""; // may be a partial first line
      for (let i = lines.length - 1; i >= 0; i--) {
        const t = lines[i].trim();
        if (!t) continue;
        let ev: ChannelEvent;
        try {
          ev = JSON.parse(t);
        } catch {
          continue;
        }
        if (ev.seq <= fromSeq) {
          done = true;
          break;
        }
        out.unshift(ev);
      }
    }
    if (!done && carry.trim() && pos === 0) {
      try {
        const ev: ChannelEvent = JSON.parse(carry.trim());
        if (ev.seq > fromSeq) out.unshift(ev);
      } catch {}
    }
    return out;
  } finally {
    closeSync(fd);
  }
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

// ---- watch: open fd + byte-offset tail-follow; reads only appended bytes ----

export async function* watchEvents(
  dir: string,
  opts: { from?: number; kinds?: Set<string>; timeoutMs?: number; signal?: AbortSignal },
): AsyncGenerator<ChannelEvent> {
  const f = eventsPath(dir);
  let offset = 0;
  let carry = "";
  let fd = -1;
  const deadline = opts.timeoutMs ? Date.now() + opts.timeoutMs : Infinity;
  try {
    while (Date.now() < deadline && !opts.signal?.aborted) {
      let size = 0;
      if (fd < 0) {
        try {
          fd = openSync(f, "r");
        } catch {
          fd = -1; // channel file may not exist yet
        }
      }
      if (fd >= 0) size = fstatSync(fd).size;
      if (size < offset) {
        offset = 0;
        carry = "";
      }
      if (size > offset) {
        const buf = Buffer.alloc(size - offset);
        readSync(fd, buf, 0, buf.length, offset);
        const text = carry + buf.toString("utf8");
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
      await new Promise((r) => setTimeout(r, 150));
    }
  } finally {
    if (fd >= 0) closeSync(fd);
  }
}
