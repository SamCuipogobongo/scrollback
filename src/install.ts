// `scrollback install` — detect agent platforms on this machine and wire
// scrollback into them: a SKILL.md where the platform has a skills dir,
// an mcpServers entry where the config format is known. --dry-run previews.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { HOME } from "./util.ts";

interface Target {
  agent: string;
  detect: string; // dir that proves the agent is installed
  skillsDir?: string; // where SKILL.md packages live
  mcpJson?: string; // JSON file with a top-level "mcpServers" object
  mcpToml?: string; // codex-style config.toml ([mcp_servers.<name>])
}

const TARGETS: Target[] = [
  {
    agent: "claude",
    detect: join(HOME, ".claude"),
    skillsDir: join(HOME, ".claude/skills"),
    mcpJson: join(HOME, ".claude.json"),
  },
  {
    agent: "codex",
    detect: join(HOME, ".codex"),
    skillsDir: join(HOME, ".codex/skills"),
    mcpToml: join(HOME, ".codex/config.toml"),
  },
  {
    agent: "devin",
    detect: join(HOME, ".config/devin"),
    skillsDir: join(HOME, ".config/devin/skills"),
  },
  {
    agent: "opencode",
    detect: join(HOME, ".local/share/opencode"),
    skillsDir: join(HOME, ".config/opencode/skills"),
    mcpJson: join(HOME, ".config/opencode/opencode.json"),
  },
  {
    agent: "factory",
    detect: join(HOME, ".factory"),
    skillsDir: join(HOME, ".factory/skills"),
    mcpJson: join(HOME, ".factory/mcp.json"),
  },
  {
    agent: "qwen",
    detect: join(HOME, ".qwen"),
    mcpJson: join(HOME, ".qwen/settings.json"),
  },
  {
    agent: "gemini",
    detect: join(HOME, ".gemini"),
    mcpJson: join(HOME, ".gemini/settings.json"),
  },
  {
    agent: "continue",
    detect: join(HOME, ".continue"),
    skillsDir: join(HOME, ".continue/skills"),
  },
  {
    agent: "cursor",
    detect: join(HOME, ".cursor"),
    mcpJson: join(HOME, ".cursor/mcp.json"),
  },
];

function skillMd(command: string): string {
  return `---
name: scrollback
description: Search and recall past AI conversations across coding agents (claude, codex, devin, opencode, qwen, kimi, factory, continue, copilot-cli). Use whenever the user asks to remember, find, or look up anything discussed in previous AI sessions — "我之前跟 X 讨论过", "上次怎么处理 Y", "find what I said about Z". Reads local session storage only; nothing is uploaded.
---

# scrollback — cross-agent session recall

Run: \`${command} <args>\`

## Recall workflow — two steps

\`\`\`bash
# 1. discover candidate sessions
${command} search "<keywords>" --global --since <YYYY-MM-DD>

# 2. drill into one (id accepts any unique prefix)
${command} context <session-id-prefix> --grep <keyword> --turns 3 --around 1
\`\`\`

Vague about which project? \`${command} projects\` ranks cwds by recent activity.

| Command | Purpose |
|---|---|
| \`search <kw>\` | multi-token AND search; user-turn hits weighted ×3 |
| \`context <id>\` | top hit turns ± neighbors, ~6000-char budget |
| \`extract <id>\` | full cleaned dialogue (\`--grep\`, \`--json\`) — expensive, prefer context |
| \`list\` / \`projects\` | enumerate sessions / rank project cwds |
| \`doctor\` | show detected platforms + session counts |

## Channels — talk to other agents / the user

Channels are durable mailboxes under ~/.scrollback/channels (project-scoped by
default, \`--global\` for machine-wide). You can also use the MCP tools
(\`scrollback_channel_send\` / \`scrollback_channel_inbox\` / \`scrollback_channel_wait\`).

\`\`\`bash
${command} channel send <ch> "<msg>" --by <you> [--to <worker>] [--global]
${command} inbox <you> [--channel <ch>] [--all] [--mark]   # unread @you
${command} channel wait <ch> --kinds done --timeout 600    # block for result
${command} workers                                         # fleet overview
\`\`\`

If the user asks you to coordinate with other agents or work in the
background on a shared task, prefer channels over printing status —
messages persist, other agents and the user can read them later, and the
channel itself becomes searchable history.

Flags: \`--platform\`, \`--since/--until YYYY-MM-DD\`, \`--global\`, \`--cwd\`,
\`--limit\`, \`--grep\`, \`--turns\`, \`--around\`, \`--max-chars\`, \`--json\`.
`;
}

function resolveCommand(): string {
  // Prefer the bin on PATH; fall back to invoking this file via node.
  try {
    const p = execSync("command -v scrollback 2>/dev/null").toString().trim();
    if (p) return "scrollback";
  } catch {}
  const self = process.argv[1];
  return self ? `node ${self}` : "scrollback";
}

function mergeMcpJson(path: string, cmd: string, args: string[], dry: boolean): string {
  let doc: any = {};
  if (existsSync(path)) {
    try {
      doc = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return `    ! ${path}: unparsable JSON — skipped`;
    }
  }
  doc.mcpServers = doc.mcpServers || {};
  const prev = doc.mcpServers.scrollback;
  const next = { command: cmd, args };
  if (prev && prev.command === cmd && JSON.stringify(prev.args) === JSON.stringify(args))
    return `    = ${path}: already configured`;
  doc.mcpServers.scrollback = next;
  if (!dry) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
  }
  return `    ${prev ? "~" : "+"} ${path}: mcpServers.scrollback${prev ? " (updated)" : ""}`;
}

function mergeMcpToml(path: string, cmd: string, args: string[], dry: boolean): string {
  const body = `[mcp_servers.scrollback]\ncommand = "${cmd}"\nargs = [${args.map((a) => `"${a}"`).join(", ")}]`;
  const cur = existsSync(path) ? readFileSync(path, "utf8") : "";
  const re = /\[mcp_servers\.scrollback\][\s\S]*?(?=\n\[|$)/;
  const existing = cur.match(re);
  if (existing && existing[0].trim() === body) return `    = ${path}: already configured`;
  if (!dry) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, existing ? cur.replace(re, body + "\n") : cur + "\n" + body + "\n");
  }
  return `    ${existing ? "~" : "+"} ${path}: [mcp_servers.scrollback]${existing ? " (updated)" : ""}`;
}

export function cmdInstall(f: Record<string, string | boolean>): string {
  const dry = !!f["dry-run"];
  const cmdStr = resolveCommand();
  const [cmd, ...rest] = cmdStr.split(" ");
  const mcpArgs = [...rest, "--mcp"];
  const lines = [
    `scrollback install${dry ? " (dry run)" : ""}`,
    `command: ${cmdStr}`,
    "",
  ];
  let wired = 0;
  for (const t of TARGETS) {
    if (!existsSync(t.detect)) continue;
    lines.push(`[${t.agent}] detected at ${t.detect}`);
    wired++;
    if (t.skillsDir) {
      const file = join(t.skillsDir, "scrollback", "SKILL.md");
      const content = skillMd(cmdStr);
      const prev = existsSync(file) ? readFileSync(file, "utf8") : null;
      if (!dry && prev !== content) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
      }
      lines.push(`    ${prev === null ? "+" : prev === content ? "=" : "~"} ${file}`);
    }
    if (t.mcpJson) lines.push(mergeMcpJson(t.mcpJson, cmd, mcpArgs, dry));
    if (t.mcpToml) lines.push(mergeMcpToml(t.mcpToml, cmd, mcpArgs, dry));
    lines.push("");
  }
  if (!wired) lines.push("no agent platforms detected");
  else {
    lines.push(`${wired} agent(s) wired.`);
    lines.push(
      "MCP entries use `scrollback --mcp` (stdio). Restart each agent to pick it up.",
    );
  }
  return lines.join("\n");
}
