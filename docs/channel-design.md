# scrollback channel — design

The second half of scrollback: not just reading what agents *said* (recall),
but being the layer they coordinate *through*. One tool = the admin plane
for every coding agent on the machine.

```
past  ── search / context / extract / stats   (existing — reads agents' own stores)
now   ── channels / inbox / workers           (this doc — scrollback-owned store)
```

## Why merge into scrollback

- Channels are sessions. A `platform:"channel"` Source plugs the event
  logs into the same search/context/extract — agent-to-agent conversation
  becomes recallable through the same interface.
- We already ship the two delivery mechanisms: a zero-dep MCP server
  (any wired agent can call channel tools) and self-installing skills
  (teaches agents the CLI verbs). No new distribution needed.
- Positioning: "cross-platform agent admin" — nobody owns this. deja-vu
  owns recall, mcp_agent_mail owns mailbox semantics; the operator view
  across all agents (who's working on what, where, how to reach them) is
  unclaimed.

## Store

`~/.scrollback/channels/<bucket>/<channel>/`

```
events.jsonl   append-only event log  — {seq, ts, kind, by, ...payload}
meta.json      {name, type: chat|forum, created, description, labels}
.seq           sidecar: last seq (fast append; reconciles with jsonl tail)
.lock          advisory lockfile: O_EXCL create, stores holder pid,
               stale-pid steal, ~25ms retry / ~5s max wait
```

`bucket` = sanitized cwd (`-Users-sam-Workspace-foo`), same convention as
Claude Code's `~/.claude/projects/`. Global channels live under `_global`.
Env overrides: `SCROLLBACK_CHANNEL_ROOT`, `SCROLLBACK_CHANNEL_PROJECT`.

Concurrency model (from Trellis's channel/, which we re-implement
clean-room): single-writer via lockfile, monotonic `seq`, idempotencyKey
dedup on write, crash-safe append (jsonl + sidecar repair on corruption).

## Events

Adopt the proven kind set, minus what we don't need:

```
messaging    message (to?, subject?, thread?, body, importance?)
membership   create / join / leave
lifecycle    spawned / progress / done / error / killed / waiting / awake
control      interrupt_requested / interrupted
threads      thread (forum channels: opened/comment/status/…)
```

Worker state is a pure projection over the log — no separate DB:
lifecycle = starting→running→done|error|killed|crashed;
activity = idle|mid-turn (from turn_started/turn_finished).

## Read path

`watch(channel, {since?, kinds?, to?})` — byte-offset tail-follow:
stat → read delta → carry partial line → yield new events. Poll-based,
no fs.watch (portable, survives NFS/permission weirdness). Same
`--from <seq>` resume lets a worker re-attach after a crash.

## Inbox

`inbox(worker)` = policy-filtered view over `message` events:
- `explicitOnly` — only `to: <worker>`
- `broadcast` — + messages with no `to`

Unread = messages with seq > worker's `lastRead` (cursor kept in
meta.json per worker, or derived from the worker's own `awake`/`done`
events).

## MCP tools (the delivery wedge)

Any agent with scrollback MCP wired can participate — zero platform code:

```
channel_send(channel, body, {to?, thread?, importance?})
channel_inbox(worker, {channel?, mark?})     → unread messages
channel_wait(channel, {kinds?, timeout?})    → long-poll for events
channel_list({scope?})                        → channels + worker states
```

Existing MCP server gains these four; CLI calls the same functions.

## Workers

MVP: `scrollback spawn <agent> "<task>"` —
1. create channel `<task-slug>` if needed, emit `spawned {worker, agent}`
2. launch the platform CLI non-interactively (`claude -p`, `codex exec`,
   `devin …`) with env `SCROLLBACK_CHANNEL`, `SCROLLBACK_WORKER`
3. wrapper emits `turn_started`/`progress`/`done` around the run
4. messages `to:` the worker get forwarded between turns (worker reads
   inbox via MCP tool or the wrapper injects via stdin/prompt)

v2: supervisor loop (`scrollback watch --supervise`) emitting
`supervisor_warning` on approaching-timeout; `interrupt` via
stdin/signal; `respawn` on crash.

## CLI surface

```
scrollback channel list|create|send|watch|wait
scrollback inbox <worker>
scrollback spawn <agent> "<task>" [--channel <ch>]
scrollback workers                     # live fleet view — the "admin" screen
```

`scrollback workers` = projected table: worker / agent / channel /
lifecycle / last event / age. This is the headline feature for the
"admin" positioning — one glance, every agent on the machine.

## Source unification

`sources/channel.ts`: each channel → one Session
(id = `<bucket>/<name>`, turns = `message` events, title = meta.name).
Then `scrollback search`/`context`/`extract` cover coordination history
for free — and `stats` shows channel activity next to real sessions.

## Phasing

1. store + event log + lock + seq + watch primitives
2. `channel create/send/list/watch` + `Source` unification (already
   searchable!)
3. MCP tools
4. `spawn` for claude + codex (non-interactive CLIs exist)
5. supervisor + interrupt

MVP = 1–3: a durable cross-agent mailbox any wired agent can use, that
also feeds recall. Worker lifecycle (4–5) is where "admin" becomes real.

## What we deliberately don't copy from Trellis

- Forum/thread taxonomy — start chat-only; threads come via `thread` field
- Python writer parity / dual-language constraint — single impl
- Trellis task coupling (channel ↔ .trellis/tasks) — ours is standalone
- Their licensing/files-in-repo init model — ours is `~/.scrollback` only

## Competitor note

Full landscape + marketing teardown lives in `docs/competitive.md`
("第二批调研" section). Short version:

`mcp_agent_mail` (HTTP FastMCP, Git+SQLite, auto-assigned identities,
file reservations, Overseer steering, Beads integration, iOS companion)
proves demand for agent mailboxes. Our wedge vs them: channels *are*
searchable sessions (recall merge), zero-dep single binary, and the
fleet view — they're a mailbox, we're the admin plane. Advisory file
reservations (their killer feature) are worth stealing in v2: a `lock`
event kind + `scrollback reserve <glob>` is cheap to add; auto-assigned
worker names (their "GreenCastle" gimmick) cost nothing and are worth
copying at `spawn`.

Gas Town validates the heavyweight end of worker
registry+supervisor+interrupt but couples it to tmux/Beads/role lore —
we stay the single-machine substrate. A2A is a different layer
(cross-vendor RPC); say so explicitly in the README to pre-empt the
"isn't this just A2A" question.
