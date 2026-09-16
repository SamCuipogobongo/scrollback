// Minimal MCP server over stdio — newline-delimited JSON-RPC 2.0, zero deps.
// Exposes the same commands as tools so any MCP-capable agent can recall.

import { cmdContext, cmdExtract, cmdList, cmdProjects, cmdSearch } from "./commands.ts";

const VERSION = "0.2.0";
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
];

function callTool(name: string, args: Record<string, any>): string {
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

function handle(msg: any) {
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
        const text = callTool(params?.name, params?.arguments || {});
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
        handle(JSON.parse(line));
      } catch {
        // malformed line — keep serving
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
