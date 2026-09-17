// scrollback's own channel store as a Source — coordination traffic becomes
// searchable/extractable through the same interface as every agent's history.
// Root: ~/.scrollback/channels (or SCROLLBACK_CHANNEL_ROOT).

import { existsSync } from "node:fs";
import type { Session, Source, Turn } from "../types.ts";
import {
  GLOBAL_BUCKET,
  channelRoot,
  listChannels,
  readEvents,
  readMeta,
} from "../channel/store.ts";

const TEXT_KINDS = new Set([
  "message",
  "progress",
  "done",
  "error",
  "waiting",
  "awake",
  "interrupted",
  "interrupt_requested",
]);

export const channelSource: Source = {
  id: "channel",
  roots() {
    return [channelRoot()];
  },
  sessions(root) {
    if (!existsSync(root)) return [];
    const out: Session[] = [];
    for (const c of listChannels(root)) {
      const meta = readMeta(c.dir);
      const events = readEvents(c.dir);
      const turns: Turn[] = [];
      for (const ev of events) {
        if (!TEXT_KINDS.has(ev.kind) || !ev.body) continue;
        const sender = ev.by === "user" ? "" : `${ev.by}: `;
        const to = ev.to ? ` (→ ${ev.to})` : "";
        turns.push({
          role: ev.by === "user" ? "user" : "assistant",
          text: `${sender}${ev.body}${to}`,
        });
      }
      if (!turns.length) continue;
      out.push({
        platform: "channel",
        id: `${c.bucket}/${c.name}`,
        cwd: meta?.cwd || (c.bucket === GLOBAL_BUCKET ? "" : c.bucket),
        startedAt: meta ? Date.parse(meta.created) || 0 : 0,
        title: meta?.description || c.name,
        turns,
      });
    }
    return out;
  },
};
