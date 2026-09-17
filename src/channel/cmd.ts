// Channel commands: create/list/send/read/watch/wait + inbox + workers + spawn.
// String-returning so CLI and MCP share the path; watch/wait are async.

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { redactSecrets } from "../clean.ts";
import {
  GLOBAL_BUCKET,
  appendEvent,
  channelDir,
  channelRoot,
  createChannel,
  lastSeq,
  listChannels,
  pidAlive,
  readCursor,
  readEvents,
  readEventsFrom,
  readMeta,
  readWorkersSidecar,
  updateWorkerState,
  validName,
  watchEvents,
  withLock,
  writeCursor,
  writeWorkersSidecar,
} from "./store.ts";
import type { WorkerState } from "./store.ts";

type Flags = Record<string, string | boolean>;

const fmtTs = (ts: string) => ts.replace("T", " ").slice(5, 16);

/** Find a channel dir by name: requested scope first, then any bucket. */
function resolveChannel(name: string, global: boolean): string {
  if (!validName(name)) throw new Error(`bad channel name: ${name}`);
  const dir = channelDir(name, global);
  if (existsSync(dir)) return dir;
  const hit = listChannels().find((c) => c.name === name);
  if (hit) return hit.dir;
  throw new Error(`no channel "${name}" — create it or send to it first`);
}

export function cmdChannelCreate(name: string, f: Flags): string {
  const { dir, created } = createChannel(name, {
    global: !!f.global,
    type: (f.type as "chat" | "forum") || "chat",
    description: f.desc as string,
    by: (f.by as string) || "user",
  });
  return created ? `+ channel "${name}" → ${dir}` : `= channel "${name}" exists → ${dir}`;
}

export function cmdChannelSend(name: string, body: string, f: Flags): string {
  // send auto-creates: "post to X" shouldn't require a separate create step
  let dir: string;
  try {
    dir = resolveChannel(name, !!f.global);
  } catch {
    dir = createChannel(name, { global: !!f.global, by: (f.by as string) || "user" }).dir;
  }
  const kind = (f.kind as string) || "message";
  const ev = appendEvent(dir, {
    kind,
    by: (f.by as string) || "user",
    body,
    to: f.to as string,
    thread: f.thread as string,
    worker: f.worker as string,
    idempotencyKey: f.key as string,
  });
  return `#${ev.seq} ${ev.kind} → ${name}`;
}

export function cmdChannelRead(name: string, f: Flags): string {
  const dir = resolveChannel(name, !!f.global);
  const meta = readMeta(dir);
  const from = f.from ? Number(f.from) : 0;
  const events = from ? readEventsFrom(dir, from) : readEvents(dir);
  const lines = [`# channel ${name}${meta?.description ? ` — ${meta.description}` : ""}\n`];
  const kinds = f.kinds ? new Set(String(f.kinds).split(",")) : null;
  for (const ev of events) {
    if (ev.seq <= from) continue;
    if (kinds && !kinds.has(ev.kind)) continue;
    lines.push(formatEvent(ev));
  }
  return lines.join("\n");
}

function formatEvent(ev: { seq: number; ts: string; kind: string; by: string; to?: string; body?: string; worker?: string; [k: string]: unknown }): string {
  const to = ev.to ? ` → ${ev.to}` : "";
  const worker = ev.worker ? ` [${ev.worker}]` : "";
  const body = ev.body ? `\n    ${redactSecrets(String(ev.body))}` : "";
  return `${fmtTs(ev.ts)} #${ev.seq} ${ev.kind}  ${ev.by}${to}${worker}${body}`;
}

export async function cmdChannelWatch(name: string, f: Flags): Promise<string> {
  const dir = resolveChannel(name, !!f.global);
  const kinds = f.kinds ? new Set(String(f.kinds).split(",")) : undefined;
  const from = f.from !== undefined ? Number(f.from) : undefined;
  const timeout = f.timeout ? Number(f.timeout) * 1000 : undefined;
  const lines: string[] = [];
  for await (const ev of watchEvents(dir, { from, kinds, timeoutMs: timeout })) {
    lines.push(formatEvent(ev));
  }
  return lines.join("\n");
}

export async function cmdChannelWait(name: string, f: Flags): Promise<string> {
  // wait = watch restricted to terminal-ish kinds, first hit wins
  const kinds = f.kinds
    ? new Set(String(f.kinds).split(","))
    : new Set(["done", "error", "killed", "message"]);
  const dir = resolveChannel(name, !!f.global);
  const timeout = (f.timeout ? Number(f.timeout) : 600) * 1000;
  // wait = future events only; pass --from explicitly to replay history
  const from = f.from !== undefined ? Number(f.from) : lastSeq(dir);
  for await (const ev of watchEvents(dir, { from, kinds, timeoutMs: timeout })) {
    return formatEvent(ev);
  }
  return `timeout after ${timeout / 1000}s`;
}

export function cmdChannelList(f: Flags): string {
  const all = listChannels();
  const bucketFilter = f.bucket as string;
  const rows = bucketFilter ? all.filter((c) => c.bucket === bucketFilter) : all;
  const lines = ["channel  (bucket)\n"];
  for (const c of rows.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.name.localeCompare(b.name))) {
    const meta = readMeta(c.dir);
    // seq is gapless from 1 → lastSeq doubles as the event count; the tail
    // event and worker count come from sidecars, so list stays O(channels)
    const count = lastSeq(c.dir);
    const tail = count ? readEventsFrom(c.dir, count - 1) : [];
    const last = tail.length ? tail[tail.length - 1] : null;
    const workers = workersForDir(c.dir).size;
    const bucket = c.bucket === GLOBAL_BUCKET ? "global" : c.bucket;
    lines.push(
      `${c.name}${meta?.type === "forum" ? " (forum)" : ""}  ${bucket}` +
        `  events=${count}  workers=${workers}` +
        (last ? `  last: ${fmtTs(last.ts)} ${last.kind} by ${last.by}` : ""),
    );
  }
  lines.push(`\n${rows.length} channel(s)  root: ${channelRoot()}`);
  return lines.join("\n");
}

export function cmdInbox(worker: string, f: Flags): string {
  // read unread `message` events for this worker across channels (or one channel)
  const channels = f.channel
    ? [resolveChannel(String(f.channel), !!f.global)]
    : listChannels().map((c) => c.dir);
  const lines: string[] = [`# inbox: ${worker}\n`];
  let unread = 0;
  for (const dir of channels) {
    const cursor = readCursor(dir, worker);
    // backward scan stops at the cursor — cost is O(unread), not O(log size)
    const pending = readEventsFrom(dir, cursor).filter(
      (e) => e.kind === "message" && e.seq > cursor && (e.to === worker || (f.all && !e.to)),
    );
    if (!pending.length) continue;
    const meta = readMeta(dir);
    lines.push(`## ${meta?.name || dir}`);
    let maxSeq = cursor;
    for (const ev of pending) {
      lines.push(formatEvent(ev));
      maxSeq = Math.max(maxSeq, ev.seq);
    }
    if (f.mark) writeCursor(dir, worker, maxSeq);
    unread += pending.length;
  }
  lines.push(`\n${unread} unread${f.mark ? " (marked read)" : ""}`);
  return lines.join("\n");
}

// ---- worker projection over event log ----

export interface WorkerView extends WorkerState {
  channelDir: string;
  channelName: string;
}

export function projectWorkers(events: ReturnType<typeof readEvents>): Map<string, WorkerState> {
  const workers = new Map<string, WorkerState>();
  const get = (w: string) => {
    let v = workers.get(w);
    if (!v) {
      v = { worker: w, lifecycle: "starting", activity: "idle", lastKind: "", lastTs: "" };
      workers.set(w, v);
    }
    return v;
  };
  for (const ev of events) {
    const w = ev.worker || (ev.kind === "spawned" ? String(ev.by) : undefined);
    if (!w) continue;
    updateWorkerState(get(w), ev);
  }
  return workers;
}

/**
 * Worker projection for one channel: sidecar when it exists, else one full
 * scan under the lock that then writes the sidecar — subsequent reads (and
 * every append) are O(1).
 */
function workersForDir(dir: string): Map<string, WorkerState> {
  const cached = readWorkersSidecar(dir);
  if (cached) return cached;
  return withLock(dir, () => {
    const again = readWorkersSidecar(dir);
    if (again) return again;
    const ws = projectWorkers(readEvents(dir));
    writeWorkersSidecar(dir, ws);
    return ws;
  });
}

const TERMINAL = new Set(["done", "error", "killed"]);
const isTerminal = (l: string) => TERMINAL.has(l);

export function cmdWorkers(f: Flags): string {
  const lines = ["worker            agent    channel              state     activity  last event", ""];
  let n = 0;
  for (const c of listChannels()) {
    const meta = readMeta(c.dir);
    const ws = workersForDir(c.dir);
    for (const s of ws.values()) {
      const v: WorkerView = { ...s, channelDir: c.dir, channelName: meta?.name || c.name };
      if (!isTerminal(v.lifecycle) && !pidAlive(v.pid)) v.lifecycle = "crashed";
      if (f.alive && isTerminal(v.lifecycle)) continue;
      n++;
      lines.push(
        `${v.worker.padEnd(18)}${(v.agent || "-").padEnd(9)}${v.channelName.padEnd(21)}` +
          `${v.lifecycle.padEnd(10)}${v.activity.padEnd(10)}${fmtTs(v.lastTs)} ${v.lastKind}`,
      );
    }
  }
  lines.push(`\n${n} worker(s)`);
  return lines.join("\n");
}

// ---- spawn: run an agent CLI as a channel worker ----

const AGENT_CMDS: Record<string, (task: string) => { cmd: string; args: string[] }> = {
  claude: (task) => ({ cmd: "claude", args: ["-p", task] }),
  codex: (task) => ({ cmd: "codex", args: ["exec", task] }),
};

export async function cmdSpawn(agent: string, task: string, f: Flags): Promise<string> {
  const worker = `${agent}-${Math.random().toString(36).slice(2, 6)}`;
  const channel = (f.channel as string) || `w-${worker}`;
  const global = !!f.global;

  const spec = AGENT_CMDS[agent] || (f.cmd ? () => ({ cmd: String(f.cmd), args: [task] }) : null);
  if (!spec) return `unknown agent "${agent}" (known: ${Object.keys(AGENT_CMDS).join(", ")}) — or pass --cmd`;

  const { dir } = createChannel(channel, { global, by: "user" });

  const preamble = [
    `You are worker "${worker}" on scrollback channel "${channel}".`,
    `Between steps, check for messages:`,
    `  scrollback inbox ${worker} --channel ${channel}${global ? " --global" : ""} --mark`,
    `Report progress:`,
    `  scrollback channel send ${channel} "<what you did>" --by ${worker} --kind progress${global ? " --global" : ""}`,
    ``,
    `Task: ${task}`,
  ].join("\n");

  const { cmd, args } = spec(preamble);
  // async spawn so the child pid lands in the log while the worker is still
  // running — that's what lets `workers` tell crashed from still-working
  const child = spawn(cmd, args, { stdio: "inherit" });
  appendEvent(dir, { kind: "spawned", by: "user", worker, agent, pid: child.pid, body: task });
  appendEvent(dir, { kind: "turn_started", by: "supervisor", worker });
  const status = await new Promise<number | null>((res) => {
    child.on("close", (code) => res(code));
    child.on("error", () => res(null));
  });
  const ok = status === 0;
  appendEvent(dir, {
    kind: ok ? "done" : "error",
    by: "supervisor",
    worker,
    pid: child.pid,
    body: `exit ${status ?? "?"}`,
  });
  appendEvent(dir, { kind: "turn_finished", by: "supervisor", worker });
  return `${ok ? "done" : "error"}: worker ${worker} on channel ${channel} (exit ${status})`;
}
