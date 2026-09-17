// Minimal MCP server over stdio — newline-delimited JSON-RPC 2.0, zero deps.
// Exposes the same commands as tools so any MCP-capable agent can recall.

import { cmdContext, cmdExtract, cmdList, cmdProjects, cmdSearch } from "./commands.ts";
import {
  cmdChannelList,
  cmdChannelSend,
  cmdChannelWait,
  cmdInbox,
} from "./channel/cmd.ts";

const VERSION = "0.3.0";
const PROTOCOL = "2025-06-18";

const TOOLS = [
  {
    name: "scrollback_search",
    description:
      "Search past AI conversations across all detected coding agents (claude, codex, devin, opencode, qwen, kimi, factory, continue, copilot-cli). Multi-token AND search; user-turn hits weighted ×3. Returns ranked sessions with excerpts and session ids for drill-down.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "keywords, space separated (AND)" },
        cwd: { type: "string", description: "scope to this project dir" },
        global: { type: "boolean", description: "search everywhere (default true for MCP)" },
        platform: { type: "string" },
        since: { type: "string", description: "YYYY-MM-DD" },
        until: { type: "string", description: "YYYY-MM-DD" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "scrollback_context",
    description:
      "Drill into one session found by scrollback_search. Returns the turns that hit `grep` plus `around` neighbors each side, within a char budget. Session ids accept any unique prefix.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "session id or unique prefix" },
        grep: { type: "string" },
        turns: { type: "number", description: "top hit turns to show (default 3)" },
        around: { type: "number", description: "neighbor turns each side (default 1)" },
        "max-chars": { type: "number", description: "char budget (default 6000)" },
      },
      required: ["session"],
    },
  },
  {
    name: "scrollback_extract",
    description:
      "Dump a session's full cleaned dialogue (user+assistant turns only). Expensive on tokens — prefer scrollback_context for recall.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" },
        grep: { type: "string" },
        json: { type: "boolean" },
      },
      required: ["session"],
    },
  },
  {
    name: "scrollback_projects",
    description: "Rank project working dirs by last activity, with per-platform session counts.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string" },
        platform: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "scrollback_list",
    description: "Enumerate sessions, newest first. Scope with cwd or widen with global.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        global: { type: "boolean" },
        platform: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "scrollback_channel_send",
    description:
      "Post a message to a scrollback channel — the durable cross-agent mailbox. Any agent can send; workers and humans read via scrollback_channel_inbox.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string" },
        body: { type: "string" },
        to: { type: "string", description: "address to one worker; omit = broadcast" },
        by: { type: "string", description: "sender name (default: user)" },
        thread: { type: "string" },
        global: { type: "boolean", description: "global channel (default: project-scoped)" },
      },
      required: ["channel", "body"],
    },
  },
  {
    name: "scrollback_channel_inbox",
    description:
      "Read unread messages addressed to a worker (or broadcast if `all`). Pass `mark` to advance the read cursor.",
    inputSchema: {
      type: "object",
      properties: {
        worker: { type: "string" },
        channel: { type: "string", description: "limit to one channel; omit = all" },
        all: { type: "boolean", description: "include broadcast messages" },
        mark: { type: "boolean", description: "mark returned messages as read" },
        global: { type: "boolean" },
      },
      required: ["worker"],
    },
  },
  {
    name: "scrollback_channel_wait",
    description:
      "Long-poll a channel for the next matching event (default kinds: done/error/killed/message). Returns the first hit or 'timeout'.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string" },
        kinds: { type: "string", description: "comma-separated event kinds" },
        timeout: { type: "number", description: "seconds (default 600)" },
        global: { type: "boolean" },
      },
      required: ["channel"],
    },
  },
  {
    name: "scrollback_channel_list",
    description: "List all channels with event/worker counts — the fleet overview.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name: string, args: Record<string, any>): Promise<string> {
  const f: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(args || {})) f[k] = v;
  if (f.global === undefined) f.global = true; // MCP default: search everywhere
  switch (name) {
    case "scrollback_search":
      return cmdSearch(String(args.query ?? ""), f);
    case "scrollback_context":
      return cmdContext(String(args.session ?? ""), f);
    case "scrollback_extract":
      return cmdExtract(String(args.session ?? ""), f);
    case "scrollback_projects":
      return cmdProjects(f);
    case "scrollback_list":
      return cmdList(f);
    case "scrollback_channel_send":
      return cmdChannelSend(String(args.channel ?? ""), String(args.body ?? ""), f);
    case "scrollback_channel_inbox":
      return cmdInbox(String(args.worker ?? ""), f);
    case "scrollback_channel_wait":
      return cmdChannelWait(String(args.channel ?? ""), f);
    case "scrollback_channel_list":
      return cmdChannelList(f);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function send(msg: any) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id: any, result: any) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id: any, code: number, message: string) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg: any) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notification — nothing to answer
  try {
    switch (method) {
      case "initialize":
        reply(id, {
          protocolVersion: params?.protocolVersion || PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "scrollback", version: VERSION },
        });
        return;
      case "ping":
        reply(id, {});
        return;
      case "tools/list":
        reply(id, { tools: TOOLS });
        return;
      case "tools/call": {
        const text = await callTool(params?.name, params?.arguments || {});
        reply(id, { content: [{ type: "text", text }] });
        return;
      }
      case "resources/list":
        reply(id, { resources: [] });
        return;
      case "prompts/list":
        reply(id, { prompts: [] });
        return;
      default:
        replyError(id, -32601, `method not found: ${method}`);
    }
  } catch (e: any) {
    replyError(id, -32603, e?.message || String(e));
  }
}

export function serveMcp() {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        void handle(JSON.parse(line));
      } catch {
        // malformed line — keep serving
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
