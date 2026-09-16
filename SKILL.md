---
name: scrollback
description: Search and recall past AI conversations across Claude Code, Codex, OpenCode, and Devin sessions. Use whenever the user asks to remember, find, or look up anything they discussed in previous AI sessions — across platforms, projects, or time. Triggers on phrases like "我之前跟 Claude/Codex/Devin 讨论过 X", "上次怎么处理 Y", "翻一下历史对话", "find what I said about Z", "what did I discuss about X last week". The tool reads sessions directly from each platform's local storage; nothing is uploaded.
---

# Scrollback — cross-platform AI session recall

Single-file TypeScript CLI at `scrollback.ts` (same directory as this file).
Run with `node scrollback.ts <args>` (Node 23.6+, type-stripping) or
`bun scrollback.ts <args>`. Zero npm dependencies.

## Recall workflow — two steps

```bash
# 1. discover candidate sessions
node scrollback.ts search "<keywords>" --global --since <YYYY-MM-DD>

# 2. drill into one
node scrollback.ts context <session-id-prefix> --grep <keyword> --turns 3 --around 1
```

If the user is vague about which project, run `projects` first to surface
recently-active cwds, then scope with `--cwd`.

## Commands

| Command | Purpose |
|---|---|
| `projects` | rank project cwds by last activity, per-platform session counts |
| `list` | enumerate sessions (`--global` to widen beyond cwd) |
| `search <kw>` | multi-token AND search; ranked sessions + paragraph excerpt |
| `context <id>` | top hit turns ± surrounding turns, ~6000-char budget |
| `extract <id>` | full cleaned dialogue (`--grep` to filter, `--json` for structured) |

Flags: `--platform claude|codex|devin|opencode|all`, `--since/--until YYYY-MM-DD`,
`--global`, `--cwd <path>`, `--limit N`, `--grep KW`, `--turns N`, `--around N`,
`--max-chars N`, `--json`.

## How to read search output

`score = (3 × user_hits + asst_hits) / total_turns` — user-turn hits weighted ×3
because the user's own wording is the strongest topic signal.

Don't run `extract` for recall unless the user explicitly wants the whole
session — it's expensive on tokens.

## Coverage notes

- **Devin**: reads `~/.local/share/devin/cli/sessions.db` via a tmp copy
  (never locks the live db). Devin's own summarizer sessions are filtered out.
- **Codex**: uses `response_item/message` events only (codex dual-writes to
  `event_msg`; reading both would double-count).
- **Claude**: compact summaries replace pre-compact history rather than
  double-counting it.
