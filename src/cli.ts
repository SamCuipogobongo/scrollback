#!/usr/bin/env node
// scrollback — recall past AI conversations across coding agents.
// Local-first: reads each platform's session storage, nothing is uploaded.

import { cmdContext, cmdDoctor, cmdExtract, cmdList, cmdProjects, cmdSearch, cmdStats } from "./commands.ts";
import { cmdInstall } from "./install.ts";
import { serveMcp } from "./mcp.ts";
import {
  cmdChannelCreate,
  cmdChannelList,
  cmdChannelRead,
  cmdChannelSend,
  cmdChannelWait,
  cmdChannelWatch,
  cmdInbox,
  cmdSpawn,
  cmdWorkers,
} from "./channel/cmd.ts";

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

function usage(msg: string): undefined {
  console.error(`usage: scrollback ${msg}`);
  process.exit(1);
}

const HELP = `scrollback — the open-source admin plane for every coding agent

  scrollback projects [--since D]              rank project cwds by last activity
  scrollback list [--global|--cwd p] [--since D]
  scrollback search "<keywords>" [--global|--cwd p] [--platform p] [--since D]
  scrollback context <id> [--grep kw] [--turns N] [--around N] [--from N --to N]
  scrollback extract <id> [--grep kw] [--json]
  scrollback doctor                            detected sources + session counts
  scrollback stats                             per-platform + monthly activity
  scrollback install [--dry-run]               wire skills + MCP into agents
  scrollback --mcp                             run as MCP server (stdio)

channels (the admin plane — ~/.scrollback/channels):
  scrollback channel create <name> [--global] [--desc d] [--type chat|forum]
  scrollback channel send <name> "<body>" [--to w] [--by b] [--kind k] [--key k]
  scrollback channel read <name> [--from seq] [--kinds a,b]
  scrollback channel watch <name> [--from seq] [--kinds a,b] [--timeout s]
  scrollback channel wait <name> [--kinds a,b] [--timeout s]   first match wins
  scrollback channel list                      all channels, all buckets
  scrollback inbox <worker> [--channel c] [--all] [--mark]
  scrollback workers [--alive]                 fleet view: state per worker
  scrollback spawn <claude|codex> "<task>" [--channel c]   run agent as worker

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
  codebuddy    ~/.codebuddy/projects/<cwd>/*.jsonl
  trae         <Trae CN>/ModularData/ai-agent (degraded: prompt echoes only)
  cline        ~/.cline/data/tasks/*/api_conversation_history.json

override any root with SCROLLBACK_<PLATFORM>_ROOT (':'-separated).
session ids accept any unique prefix.`;

export async function main() {
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
  let out: string | undefined;
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
    case "channel": {
      const sub = _[1];
      const name = _[2];
      const body = _[3];
      switch (sub) {
        case "create":
          if (!name) return usage("channel create <name>");
          out = cmdChannelCreate(name, flags);
          break;
        case "send":
          if (!name || !body) return usage('channel send <name> "<body>"');
          out = cmdChannelSend(name, body, flags);
          break;
        case "read":
          if (!name) return usage("channel read <name>");
          out = cmdChannelRead(name, flags);
          break;
        case "watch":
          if (!name) return usage("channel watch <name>");
          out = await cmdChannelWatch(name, flags);
          break;
        case "wait":
          if (!name) return usage("channel wait <name>");
          out = await cmdChannelWait(name, flags);
          break;
        case "list":
          out = cmdChannelList(flags);
          break;
        default:
          return usage("channel create|send|read|watch|wait|list");
      }
      break;
    }
    case "inbox":
      if (!_[1]) return usage("inbox <worker>");
      out = cmdInbox(_[1], flags);
      break;
    case "workers":
      out = cmdWorkers(flags);
      break;
    case "spawn":
      if (!_[1] || !_[2]) return usage('spawn <claude|codex> "<task>"');
      out = await cmdSpawn(_[1], _[2], flags);
      break;
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
  if (out !== undefined) console.log(out);
}

main().catch((e) => {
  console.error(e?.message || String(e));
  process.exit(1);
});
