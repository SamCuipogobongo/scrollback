# scrollback

**The open-source admin plane for every coding agent.**

[![npm](https://img.shields.io/npm/v/sam-scrollback?style=flat-square)](https://www.npmjs.com/package/sam-scrollback)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![agents](https://img.shields.io/badge/agents-22-green?style=flat-square)](#why-scrollback)
[![node](https://img.shields.io/badge/node-%3E%3D22.13-lightgrey?style=flat-square)](https://nodejs.org)

One search box across every agent you run — Claude Code, Codex, Devin,
OpenCode, Qwen Code, Gemini CLI, Kimi Code, Factory Droid, Continue,
Copilot CLI, Cursor, Zed, Copilot Chat, Cline/Roo/Kilo, Trae, Qoder,
CodeBuddy, Aider, Goose, Antigravity.

Local-first: nothing is uploaded, no daemon, no index — a query scans the
stores in place. Secrets are redacted at read time.

```text
$ scrollback doctor
  [claude     ] 132 session(s)  ~/.claude/projects
  [codex      ]  47 session(s)  ~/.codex/sessions
  [devin      ]  39 session(s)  ~/.local/share/devin/cli
  [opencode   ]   1 session(s)  ~/.local/share/opencode/storage
  …
  219 session(s) across 5 detected source(s)

$ scrollback search "jwt refresh" --global
[claude ] 2026-09-10  sess-aaa  ~/myapp   hits=4   "…flaky jwt refresh…"
[codex  ] 2026-09-10  deadbeef  ~/myapp   hits=2   "…migrate the user table…"

$ scrollback context sess-aaa --grep jwt --turns 2
# context: [claude] sess-aaa  ·  ~/myapp
## turn 3 (assistant) — …the refresh token race is in auth.ts:41…
```

## Why scrollback

| | scrollback | deja-vu | claude-mem | agent mail |
|---|---|---|---|---|
| Reads existing sessions | ✓ | ✓ | ✗ (captures forward only) | ✗ |
| Index / daemon required | ✗ (scans in place) | index | index + LLM per call | — |
| Devin · Trae · Qoder · CodeBuddy | ✓ | ✗ | ✗ | ✗ |
| Wires itself into every agent | ✓ `install` | partial | manual | manual |
| Agent↔agent comms | [roadmap](docs/channel-design.md) | ✗ | ✗ | ✓ |

Different lane, same store: recall of what agents already wrote, plus a
durable channel for what they say next.

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

Session ids accept any unique prefix. Every storage root can be overridden
with `SCROLLBACK_<PLATFORM>_ROOT` (`:`-separated for multiple).

## Roadmap

- **fleet** — every agent on one screen
- **comms** — a durable channel agents reach each other through

Design and competitive notes: [docs/channel-design.md](docs/channel-design.md) ·
[docs/competitive.md](docs/competitive.md)

## Contributing

New platform support is one adapter file in `src/sources/` implementing
`roots()` + `sessions(root)`, plus a fixture under `fixtures/` and a
conformance test in `test/sources.test.ts`.

```bash
node scrollback.ts <command>   # dev entry, Node 23.6+ type-stripping
npm run build && npm test      # tsc → dist/, 17 conformance tests
```

## License

[MIT](LICENSE)
