# scrollback

Recall past AI conversations across **Claude Code, Codex, OpenCode, and Devin**.

Reads each platform's local session storage directly — no daemon, no index, no
upload. One TypeScript file, zero npm dependencies (Devin's SQLite store is read
via `node:sqlite` on a copied snapshot, so a running Devin never blocks).

## Run

Requires Node 23.6+ (native TypeScript type-stripping) or Bun.

```bash
node scrollback.ts <command>     # or: bun scrollback.ts <command>
```

## Commands

```bash
scrollback projects [--since YYYY-MM-DD]             # rank project cwds by last activity
scrollback list [--global|--cwd <path>] [--since D]  # enumerate sessions
scrollback search "<keywords>" [--global] [--platform claude|codex|devin|opencode]
scrollback context <id> [--grep kw] [--turns N] [--around N] [--max-chars N]
scrollback extract <id> [--grep kw] [--json]
```

Recall is a two-step drill-down:

```bash
scrollback search "landing page" --global --since 2026-08-01   # find candidate sessions
scrollback context 94aa7e8b --grep "landing" --turns 3         # pull the actual content
```

Session ids accept any unique prefix.

## Where data comes from

| Platform | Storage |
|---|---|
| Claude Code | `~/.claude/projects/<sanitized-cwd>/*.jsonl` |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| Devin | `~/.local/share/devin/cli/sessions.db` (copied to tmp before read) |
| OpenCode | `~/.local/share/opencode/storage/{session,message,part}/` |

## What's stripped

Only real human↔AI dialogue is kept. The cleaner drops:

- system/prompt injections (`<system_info>`, `<rules>`, `<task-notification>`, …)
- tool calls and tool results (only `text` blocks survive)
- bootstrap turns (Codex env envelope + `AGENTS.md` preamble; Devin continuation prompts)
- summarizer payloads (`Output a summary…`, `Conversation to summarize…`)
- compacted-session history (Claude `isCompactSummary`, Codex `compacted` events)
- duplicate re-stored messages (Devin stores one logical message per attempt)
