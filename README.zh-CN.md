# scrollback

**一站搜遍、召回、调度所有编程 Agent。**

[English](README.md) | **简体中文**

[![npm](https://img.shields.io/npm/v/sam-scrollback?style=flat-square)](https://www.npmjs.com/package/sam-scrollback)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![agents](https://img.shields.io/badge/agents-23-green?style=flat-square)](#为什么用它)
[![node](https://img.shields.io/badge/node-%3E%3D22.13-lightgrey?style=flat-square)](https://nodejs.org)

一个搜索框,搜遍你装过的所有编程 Agent 的历史对话 —— Claude Code、Codex、
Devin、OpenCode、Qwen Code、Gemini CLI、Kimi Code、Factory Droid、Continue、
Copilot CLI、Cursor、Zed、Copilot Chat、Cline/Roo/Kilo、Trae、Qoder、
CodeBuddy、Aider、Goose、Antigravity、Cline CLI。

本地优先:查询时直接读各 agent 本地的历史文件,不建索引、不上传;API 密钥自动打码。

<p align="center">
  <img src="assets/demo.gif" alt="scrollback 演示" width="720">
</p>

## 安装

```bash
npm i -g sam-scrollback    # 需要 Node >= 22.13(node:sqlite)
scrollback install         # 自动往检测到的 agent 写 skills + MCP 配置
```

`scrollback install` 会识别本机装了哪些 agent,并教会每个 agent 使用它。

本身支持 MCP 的 agent 也可以直接配:

```json
{ "mcpServers": { "scrollback": { "command": "scrollback", "args": ["--mcp"] } } }
```

## 为什么用它

| | scrollback | deja-vu | claude-mem | agent mail |
|---|---|---|---|---|
| 能读已有会话 | ✓ | ✓ | ✗ | ✗ |
| 要索引/守护进程 | ✗(原地扫) | 要索引 | 索引 + 每次查询过 LLM | — |
| Devin · Trae · Qoder · CodeBuddy | ✓ | ✗ | ✗ | ✗ |
| 自动接入所有 agent | ✓ `install` | 部分支持 | 手动 | 手动 |
| Agent 互相通信 | ✓ `channel` | ✗ | ✗ | ✓ |

## 用法

```bash
scrollback doctor                              # 检测到哪些源、各有多少会话
scrollback projects [--since YYYY-MM-DD]       # 项目按活跃度排名
scrollback list [--global|--cwd p] [--since D] # 列出会话
scrollback search "<keywords>" [--global] [--platform p]
scrollback context <id> [--grep kw] [--turns N] [--around N] [--from N --to N]
scrollback extract <id> [--grep kw] [--json]
scrollback --mcp                               # stdio 模式跑 MCP server
```

```bash
scrollback search "landing page" --global --since 2026-08-01
scrollback context 94aa7e8b --grep "landing" --turns 3
```

每个存储根目录都能用 `SCROLLBACK_<PLATFORM>_ROOT` 覆盖,多个路径用 `:` 分隔。

频道(channel)—— agent 之间互发消息,数据在 `~/.scrollback/channels`:

```bash
scrollback channel create <name> [--global] [--desc d] [--type chat|forum]
scrollback channel send <name> "<body>" [--to w] [--by b] [--kind k] [--key k]
scrollback channel read|watch|wait <name> [--from seq] [--kinds a,b]
scrollback inbox <worker> [--channel c] [--all] [--mark]
scrollback workers [--alive]                 # 所有 agent 状态一览
scrollback spawn <claude|codex> "<task>" [--channel c]   # 把任务丢给另一个 agent
```

## 计划

- **fleet** —— 实时查看你跑着的所有 agent

设计和竞品笔记见 [docs/channel-design.md](docs/channel-design.md) ·
[docs/competitive.md](docs/competitive.md)

## 参与贡献

加一个新平台 = 在 `src/sources/` 写一个 adapter,实现 `roots()` 和
`sessions(root)`,再补一份 `fixtures/` 样本和 `test/sources.test.ts`
里的一致性测试。

```bash
node scrollback.ts <command>   # 开发入口,Node 23.6+ type-stripping
npm run build && npm test      # tsc → dist/,全部测试
```

## 许可证

[MIT](LICENSE)
