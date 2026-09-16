---
name: scrollback
description: Search and recall past AI conversations across coding agents — Claude Code, Codex, Devin, OpenCode, Qwen, Gemini, Kimi, Factory, Continue, Copilot CLI. Use whenever the user asks to remember, find, or look up anything discussed in previous AI sessions — across platforms, projects, or time. Triggers on phrases like "我之前跟 Claude/Codex/Devin 讨论过 X", "上次怎么处理 Y", "翻一下历史对话", "find what I said about Z", "what did I discuss last week". Reads local session storage only; nothing is uploaded.
---

# scrollback — cross-agent session recall

In this repo, run `node scrollback.ts <args>` (Node 23.6+ type-stripping) or
`bun scrollback.ts <args>`. When installed via npm the command is `scrollback`.

## Recall workflow — two steps

```bash
# 1. discover candidate sessions
scrollback search "<keywords>" --global --since <YYYY-MM-DD>

# 2. drill into one (session ids accept any unique prefix)
scrollback context <session-id-prefix> --grep <keyword> --turns 3 --around 1
```

Vague about which project? `scrollback projects` ranks cwds by recent activity.
Unsure what's on this machine? `scrollback doctor` lists detected platforms.

## Commands

| Command | Purpose |
|---|---|
| `projects` | rank project cwds by last activity, per-platform counts |
| `list` | enumerate sessions (`--global` widens beyond cwd) |
| `search <kw>` | multi-token AND search; ranked sessions + excerpt |
| `context <id>` | top hit turns ± neighbors, ~6000-char budget; `--from/--to` for ranges |
| `extract <id>` | full cleaned dialogue (`--grep`, `--json`) — expensive, prefer context |
| `doctor` | detected sources + session counts |
| `install` | wire this tool into other agents (skills + MCP) |
| `--mcp` | run as an MCP server over stdio |

Flags: `--platform claude|codex|devin|opencode|qwen|gemini|kimi|factory|continue|copilot-cli|all`,
`--since/--until YYYY-MM-DD`, `--global`, `--cwd <path>`, `--limit N`,
`--grep KW`, `--turns N`, `--around N`, `--max-chars N`, `--json`.

## How to read search output

`score = (3 × user_hits + asst_hits) / total_turns` — user-turn hits weighted ×3
because the user's own wording is the strongest topic signal.

Don't run `extract` for recall unless the user explicitly wants the whole
session — it's expensive on tokens.

## Coverage notes

- **Devin**: reads `~/.local/share/devin/cli/sessions.db` via a tmp-copy
  snapshot (never locks the live db). Summarizer/injected messages filtered.
- **Codex**: uses `response_item/message` events only (codex dual-writes to
  `event_msg`; reading both would double-count).
- **Claude**: compact summaries replace pre-compact history rather than
  double-counting it.
- **Gemini family** (qwen/gemini): skips `kind==='subagent'` and
  `hasResumableContent===false` records.
- Every platform's root can be overridden via `SCROLLBACK_<PLATFORM>_ROOT`.
