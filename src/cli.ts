#!/usr/bin/env node
// scrollback — recall past AI conversations across coding agents.
// Local-first: reads each platform's session storage, nothing is uploaded.

import { cmdContext, cmdDoctor, cmdExtract, cmdList, cmdProjects, cmdSearch, cmdStats } from "./commands.ts";
import { cmdInstall } from "./install.ts";
import { serveMcp } from "./mcp.ts";

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else _.push(a);
  }
  return { _, flags };
}

const HELP = `scrollback — recall past AI conversations across coding agents

  scrollback projects [--since D]              rank project cwds by last activity
  scrollback list [--global|--cwd p] [--since D]
  scrollback search "<keywords>" [--global|--cwd p] [--platform p] [--since D]
  scrollback context <id> [--grep kw] [--turns N] [--around N] [--from N --to N]
  scrollback extract <id> [--grep kw] [--json]
  scrollback doctor                            detected sources + session counts
  scrollback stats                             per-platform + monthly activity
  scrollback install [--dry-run]               wire skills + MCP into agents
  scrollback --mcp                             run as MCP server (stdio)

platforms (auto-detected):
  claude       ~/.claude/projects/*/*.jsonl
  codex        ~/.codex/sessions/**/rollout-*.jsonl
  devin        ~/.local/share/devin/cli/sessions.db
  opencode     ~/.local/share/opencode/storage/
  qwen         ~/.qwen/{tmp,projects}/*/chats/
  gemini       ~/.gemini/tmp/*/chats/
  factory      ~/.factory/sessions/<cwd>/*.jsonl
  kimi         ~/.kimi-code/sessions/*/*/agents/*/wire.jsonl (+ ~/.kimi legacy)
  continue     ~/.continue/sessions/*.json
  copilot-cli  ~/.copilot/session-state/*/events.jsonl
  cursor       <Cursor>/User/globalStorage/state.vscdb + ~/.cursor/projects/**/agent-transcripts
  zed          <Zed>/threads/threads.db (zstd blobs)
  vscode-*     copilot-chat + cline/roo/kilo tasks + trae/qoder/codebuddy agent dirs
  aider        **/.aider.chat.history.md
  goose        ~/.local/share/goose/sessions/*.{jsonl,db}
  antigravity  ~/.gemini/antigravity*/brain/*/…/transcript.jsonl

override any root with SCROLLBACK_<PLATFORM>_ROOT (':'-separated).
session ids accept any unique prefix.`;

export function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  if (flags.mcp) {
    serveMcp();
    return;
  }
  const cmd = _[0];
  if (!cmd || flags.help || flags.h) {
    console.log(HELP);
    return;
  }
  if (flags.v || flags.version) {
    console.log("scrollback 0.2.0");
    return;
  }
  let out: string;
  switch (cmd) {
    case "projects":
      out = cmdProjects(flags);
      break;
    case "list":
      out = cmdList(flags);
      break;
    case "search":
      if (!_[1]) {
        console.error("usage: scrollback search <keywords>");
        process.exit(1);
      }
      out = cmdSearch(_[1], flags);
      break;
    case "context":
      if (!_[1]) {
        console.error("usage: scrollback context <id>");
        process.exit(1);
      }
      out = cmdContext(_[1], flags);
      break;
    case "extract":
      if (!_[1]) {
        console.error("usage: scrollback extract <id>");
        process.exit(1);
      }
      out = cmdExtract(_[1], flags);
      break;
    case "doctor":
      out = cmdDoctor(flags);
      break;
    case "stats":
      out = cmdStats(flags);
      break;
    case "install":
      out = cmdInstall(flags);
      break;
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
  if (out !== undefined) console.log(out);
}

main();
