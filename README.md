# scrollback

**The open-source admin plane for every coding agent.**

[![npm](https://img.shields.io/npm/v/sam-scrollback)](https://www.npmjs.com/package/sam-scrollback)

- **history** — reads what every agent already wrote: Claude Code, Codex,
  Devin, OpenCode, Qwen Code, Gemini CLI, Kimi Code, Factory Droid, Continue,
  Copilot CLI, Cursor, Zed, Copilot Chat, Cline/Roo/Kilo, Trae, Qoder,
  CodeBuddy, Aider, Goose, Antigravity — one search box across all of them
- **fleet** *(planned)* — every agent on one screen
- **comms** *(planned)* — a durable channel agents reach each other through

Local-first: nothing is uploaded, no daemon, no index — a query scans the
stores in place. Secrets are redacted at read time (API keys, tokens, private
keys never leave the store).

## Install

```bash
npm i -g sam-scrollback    # needs Node >= 22.13 (node:sqlite)
scrollback install         # auto-wire skills + MCP into detected agents
```

`scrollback install` detects which agents you have and writes a `SKILL.md`
into their skills dir plus an `mcpServers.scrollback` entry where the config
format is known — so every agent gains recall without you lifting a finger.
Preview with `--dry-run`.

For agents that speak MCP directly:

```json
{ "mcpServers": { "scrollback": { "command": "scrollback", "args": ["--mcp"] } } }
```

## Dev

```bash
node scrollback.ts <command>   # Node 23.6+ type-stripping, or bun
npm run build                  # tsc → dist/
```

## Commands

```bash
scrollback doctor                              # detected sources + counts
scrollback projects [--since YYYY-MM-DD]       # rank project cwds by activity
scrollback list [--global|--cwd p] [--since D] # enumerate sessions
scrollback search "<keywords>" [--global] [--platform p]
scrollback context <id> [--grep kw] [--turns N] [--around N] [--from N --to N]
scrollback extract <id> [--grep kw] [--json]
scrollback --mcp                               # MCP server over stdio
```

Recall is a two-step drill-down:

```bash
scrollback search "landing page" --global --since 2026-08-01
scrollback context 94aa7e8b --grep "landing" --turns 3
```

Session ids accept any unique prefix.

## Where data comes from

| Platform | Storage |
|---|---|
| Claude Code | `~/.claude/projects/<sanitized-cwd>/*.jsonl` (+ Xcode / cc-mirror roots) |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` (+ Xcode root) |
| Devin | `~/.local/share/devin/cli/sessions.db` (read on tmp snapshot) |
| OpenCode | `~/.local/share/opencode/storage/{session,message,part}/` |
| Qwen Code | `~/.qwen/{tmp,projects}/*/chats/session-*.{json,jsonl}` |
| Gemini CLI | `~/.gemini/tmp/<proj>/chats/session-*.{json,jsonl}` |
| Kimi Code | `~/.kimi-code/sessions/*/*/agents/*/wire.jsonl` (+ `~/.kimi` legacy) |
| Factory Droid | `~/.factory/sessions/<dashed-cwd>/*.jsonl` |
| Continue | `~/.continue/sessions/*.json` |
| Copilot CLI | `~/.copilot/session-state/*/events.jsonl` |
| Cursor | `Cursor/User/globalStorage/state.vscdb` (IDE) + `~/.cursor/projects/**/agent-transcripts/*.jsonl` (CLI) |
| Zed | `Zed/threads/threads.db` (zstd-compressed blobs, decoded in-process) |
| VS Code family | `*/User/globalStorage/<ext>/tasks/*` (Cline/Roo/Kilo), `chatSessions/*` (Copilot Chat), `*/conversations/*` (Trae/Qoder/CodeBuddy — best effort) |
| Aider | `**/.aider.chat.history.md` |
| Goose | `~/.local/share/goose/sessions/*.{jsonl,db}` |
| Antigravity | `~/.gemini/antigravity*/brain/*/…/transcript.jsonl` |

Every root can be overridden with `SCROLLBACK_<PLATFORM>_ROOT`
(`:`-separated for multiple). New adapters are one file in `src/sources/`
implementing `detect`-able `roots()` + `sessions(root)`.

## What's stripped

Only real human↔AI dialogue is kept. The cleaner drops:

- system/prompt injections (`<system_info>`, `<rules>`, `<task-notification>`, …)
- tool calls and tool results (only `text` blocks survive)
- bootstrap turns (Codex env envelope + `AGENTS.md` preamble; Devin continuation prompts)
- summarizer payloads (`Output a summary…`, `Conversation to summarize…`)
- compacted-session history (Claude `isCompactSummary`, Codex `compacted` events)
- duplicate re-stored messages (Devin stores one logical message per attempt)
- subagent recordings and non-resumable shells (Gemini-family rules)

## Layout

```
src/
  types.ts     Session/Turn/Source model
  clean.ts     noise + injection filters, turn dedupe
  util.ts      paths, jsonl/json readers, sqlite snapshot helper
  sources/     one file per platform
  registry.ts  source registry, detection, scoping
  commands.ts  the five commands (string-returning, shared by CLI + MCP)
  mcp.ts       zero-dep stdio MCP server
  install.ts   skill + MCP wiring into detected agents
  cli.ts       entry
```
