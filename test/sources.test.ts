// Conformance tests: each source parses a synthetic fixture and returns
// cleaned user/assistant turns. sqlite fixtures are built on the fly.
// Run: node --test test/

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { zstdCompressSync } from "node:zlib";

import { claude } from "../src/sources/claude.ts";
import { codex } from "../src/sources/codex.ts";
import { devin } from "../src/sources/devin.ts";
import { opencode } from "../src/sources/opencode.ts";
import { qwen } from "../src/sources/gemini-family.ts";
import { factory } from "../src/sources/factory.ts";
import { kimi } from "../src/sources/kimi.ts";
import { cont } from "../src/sources/continue.ts";
import { copilotCli } from "../src/sources/copilot-cli.ts";
import { cursor } from "../src/sources/cursor.ts";
import { zed } from "../src/sources/zed.ts";
import { vscodeFamily } from "../src/sources/vscode-family.ts";
import { aider } from "../src/sources/aider.ts";
import { goose } from "../src/sources/goose.ts";
import { antigravity } from "../src/sources/antigravity.ts";

const FX = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const req = createRequire(import.meta.url);
const { DatabaseSync } = req("node:sqlite");

const texts = (s: any) => s.turns.map((t: any) => t.text).join(" ");

test("claude: parses jsonl, strips tags + tool blocks", () => {
  const ss = claude.sessions(join(FX, "claude/projects"));
  assert.equal(ss.length, 1);
  const s = ss[0];
  assert.equal(s.cwd, "/Users/test/myapp");
  assert.equal(s.turns.length, 4);
  assert.match(texts(s), /flaky jwt refresh/);
  assert.doesNotMatch(texts(s), /hidden/);
  assert.doesNotMatch(texts(s), /Edit/); // tool_use block gone
});

test("codex: response_item only (no event_msg double-count), bootstrap dropped", () => {
  const ss = codex.sessions(join(FX, "codex/sessions"));
  assert.equal(ss.length, 1);
  const s = ss[0];
  assert.equal(s.cwd, "/Users/test/myapp");
  assert.equal(s.turns.length, 2); // bootstrap user msg dropped; event_msg dupes not read
  assert.match(texts(s), /migrate the user table/);
  assert.doesNotMatch(texts(s), /environment_context/);
});

test("codex: multi-file session — fork file merges, replayed tail deduped", () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-codex-fork-"));
  const sid = "aaaaaaa1-cf5a-7290-8599-4b92ced8dae0";
  const fork = "bbbbbbb2-4d26-7a81-8ae1-54dc38f9b23a";
  const meta = (cwd: string) =>
    JSON.stringify({ type: "session_meta", payload: { cwd, timestamp: "2026-09-10T12:00:00Z" } });
  const msg = (role: string, text: string) =>
    JSON.stringify({
      type: "response_item",
      payload: { type: "message", role, content: [{ text }] },
    });
  mkdirSync(dir, { recursive: true });
  // segment 1: ends mid-conversation
  writeFileSync(
    join(dir, `rollout-2026-09-10T12-00-00-${sid}.jsonl`),
    [meta("/x"), msg("user", "first real question"), msg("assistant", "answer one"), msg("user", "follow up")].join("\n") + "\n",
  );
  // segment 2 (resume): replays last turn then continues
  writeFileSync(
    join(dir, `rollout-2026-09-10T12-30-00-${sid}_${fork}.jsonl`),
    [meta("/x"), msg("user", "follow up"), msg("assistant", "answer two")].join("\n") + "\n",
  );

  const ss = codex.sessions(dir);
  assert.equal(ss.length, 1);
  assert.equal(ss[0].id, sid); // canonical session uuid, not filename ts
  assert.deepEqual(
    ss[0].turns.map((t) => t.role + ":" + t.text),
    ["user:first real question", "assistant:answer one", "user:follow up", "assistant:answer two"],
  );
});

test("devin: sqlite snapshot, dedupes by message_id, drops is_user_input=false", () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-devin-"));
  const db = new DatabaseSync(join(dir, "sessions.db"));
  db.exec(`CREATE TABLE sessions (id TEXT, working_directory TEXT, title TEXT);
           CREATE TABLE message_nodes (session_id TEXT, node_id INTEGER, chat_message TEXT);`);
  db.prepare(`INSERT INTO sessions VALUES ('s1','/Users/test/myapp','Devin task')`).run();
  const rows = [
    { node: 1, msg: { role: "user", message_id: "u1", content: "devin: fix the webhook retries", metadata: { is_user_input: true, created_at: "2026-09-10T01:00:00Z" } } },
    { node: 2, msg: { role: "assistant", message_id: "a1", content: "Retries now honor Retry-After.", metadata: {} } },
    { node: 3, msg: { role: "user", message_id: "u1", content: "devin: fix the webhook retries", metadata: { is_user_input: true, created_at: "2026-09-10T01:00:00Z" } } }, // re-stored
    { node: 4, msg: { role: "user", message_id: "inj", content: "injected env", metadata: { is_user_input: false } } },
  ];
  for (const r of rows)
    db.prepare(`INSERT INTO message_nodes VALUES ('s1', ?, ?)`).run(r.node, JSON.stringify(r.msg));
  db.close();

  const ss = devin.sessions(dir);
  assert.equal(ss.length, 1);
  assert.equal(ss[0].turns.length, 2);
  assert.equal(ss[0].title, "Devin task");
  assert.match(texts(ss[0]), /webhook retries/);
  assert.doesNotMatch(texts(ss[0]), /injected env/);
});

test("opencode: session/message/part three-dir layout", () => {
  const ss = opencode.sessions(join(FX, "opencode/storage"));
  assert.equal(ss.length, 1);
  assert.equal(ss[0].cwd, "/Users/test/myapp");
  assert.equal(ss[0].turns.length, 2); // tool part ignored
  assert.match(texts(ss[0]), /auth middleware loop/);
});

test("qwen: ConversationRecord json + projects.json cwd mapping", () => {
  const ss = qwen.sessions(join(FX, "qwen"));
  assert.equal(ss.length, 1);
  assert.equal(ss[0].id, "qwen-sess-1");
  assert.equal(ss[0].cwd, "/Users/test/myapp");
  assert.equal(ss[0].turns.length, 2); // tool msg skipped
  assert.match(texts(ss[0]), /timeout_ms/);
});

test("factory: dashed-cwd dir + meta first line", () => {
  const ss = factory.sessions(join(FX, "factory/sessions"));
  assert.equal(ss.length, 1);
  assert.equal(ss[0].cwd, "/Users/test/myapp");
  assert.match(texts(ss[0]), /streaming/);
});

test("kimi: wire.jsonl under agents/main, state.json for meta", () => {
  const ss = kimi.sessions(join(FX, "kimi-code/sessions"));
  assert.equal(ss.length, 1);
  assert.equal(ss[0].cwd, "/Users/test/myapp");
  assert.match(texts(ss[0]), /retries/);
  assert.doesNotMatch(texts(ss[0]), /you are kimi/);
});

test("continue: history array", () => {
  const ss = cont.sessions(join(FX, "continue/sessions"));
  assert.equal(ss.length, 1);
  assert.match(texts(ss[0]), /undo stack/);
});

test("copilot-cli: events.jsonl", () => {
  const ss = copilotCli.sessions(join(FX, "copilot-cli/session-state"));
  assert.equal(ss.length, 1);
  assert.match(texts(ss[0]), /open ports/);
});

test("cursor: state.vscdb bubbles + composerHeaders", () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-cursor-"));
  const gs = join(dir, "globalStorage");
  mkdirSync(gs, { recursive: true });
  const db = new DatabaseSync(join(gs, "state.vscdb"));
  db.exec(`CREATE TABLE ItemTable (key TEXT, value TEXT);
           CREATE TABLE cursorDiskKV (key TEXT, value TEXT);`);
  db.prepare(`INSERT INTO ItemTable VALUES ('composer.composerHeaders', ?)`).run(
    JSON.stringify([{ composerId: "c1", name: "Cursor chat", lastUpdatedAt: 1757500000000 }]),
  );
  const bubbles = [
    ["bubbleId:c1:b1", { type: 1, text: "cursor: fix the sidebar layout" }],
    ["bubbleId:c1:b2", { type: 2, text: "Moved the panel into a flex row." }],
    ["bubbleId:c1:b3", { type: "tool", text: "ignored" }],
  ];
  for (const [k, v] of bubbles)
    db.prepare(`INSERT INTO cursorDiskKV VALUES (?, ?)`).run(k, JSON.stringify(v));
  db.close();

  const ss = cursor.sessions(gs);
  assert.equal(ss.length, 1);
  assert.equal(ss[0].turns.length, 2);
  assert.equal(ss[0].title, "Cursor chat");
  assert.match(texts(ss[0]), /sidebar layout/);
});

test("zed: threads.db with zstd blob", () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-zed-"));
  const dbPath = join(dir, "threads.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, summary TEXT, updated_at TEXT,
             data_type TEXT, data BLOB, folder_paths TEXT, created_at TEXT);`);
  const doc = {
    version: "0.1",
    summary: "Zed thread",
    messages: [
      { role: "User", content: [{ Text: "zed: add a dark mode toggle" }] },
      { role: "Assistant", content: [{ Text: "Added a toggle in settings." }] },
    ],
  };
  db.prepare(
    `INSERT INTO threads VALUES ('t1','Zed thread','2026-09-11T10:00:00Z','zstd',?, ?, '2026-09-11T09:00:00Z')`,
  ).run(zstdCompressSync(Buffer.from(JSON.stringify(doc))), JSON.stringify(["/Users/test/myapp"]));
  db.close();

  const ss = zed.sessions(dbPath);
  assert.equal(ss.length, 1);
  assert.equal(ss[0].cwd, "/Users/test/myapp");
  assert.match(texts(ss[0]), /dark mode/);
});

test("vscode-family: cline tasks + generic agent conv + copilot chatSessions", () => {
  const root = join(FX, "vscode-fake/User") + "|Trae";
  const ss = vscodeFamily.sessions(root);
  assert.ok(ss.length >= 3, `expected >=3, got ${ss.length}`);
  const all = texts({ turns: ss.flatMap((s) => s.turns) });
  assert.match(all, /cline: fix the build/);
  assert.match(all, /trae agent: generate a login form/);
  assert.match(all, /copilot: why is my test slow/);
});

test("aider: markdown history splits on 'started at'", () => {
  const ss = aider.sessions(join(FX, "aider-repo/.aider.chat.history.md"));
  assert.equal(ss.length, 2);
  assert.match(texts(ss[0]), /timeout to 30s/);
});

test("goose: sessions dir jsonl", () => {
  const ss = goose.sessions(join(FX, "goose/sessions"));
  assert.equal(ss.length, 1);
  assert.match(texts(ss[0]), /hello world server/);
});

test("antigravity: transcript.jsonl under brain/<conv>", () => {
  const ss = antigravity.sessions(join(FX, "gemini-root"));
  assert.equal(ss.length, 1);
  assert.match(texts(ss[0]), /system diagram/);
});

test("secrets are redacted everywhere", () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-claude-"));
  mkdirSync(join(dir, "proj"), { recursive: true });
  writeFileSync(
    join(dir, "proj", "s.jsonl"),
    JSON.stringify({
      type: "user",
      cwd: "/x",
      timestamp: "2026-01-01T00:00:00Z",
      message: { content: [{ type: "text", text: "my key is sk-ant-abcdef0123456789XYZ ok" }] },
    }) + "\n",
  );
  const ss = claude.sessions(dir);
  assert.match(ss[0].turns[0].text, /\[redacted\]/);
  assert.doesNotMatch(ss[0].turns[0].text, /sk-ant/);
});
