# scrollback

**每一个编程 Agent 的开源管理平面(admin plane)。**

[English](README.md) · **简体中文**

[![npm](https://img.shields.io/npm/v/sam-scrollback?style=flat-square)](https://www.npmjs.com/package/sam-scrollback)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![agents](https://img.shields.io/badge/agents-22-green?style=flat-square)](#为什么是-scrollback)
[![node](https://img.shields.io/badge/node-%3E%3D22.13-lightgrey?style=flat-square)](https://nodejs.org)

一个搜索框,检索你跑过的所有 agent —— Claude Code、Codex、Devin、
OpenCode、Qwen Code、Gemini CLI、Kimi Code、Factory Droid、Continue、
Copilot CLI、Cursor、Zed、Copilot Chat、Cline/Roo/Kilo、Trae、Qoder、
CodeBuddy、Aider、Goose、Antigravity。

本地优先:不上传、无守护进程、无索引——查询时原地扫描各存储,
密钥在读取时即被脱敏。

<p align="center">
  <img src="assets/demo.gif" alt="scrollback 演示" width="720">
</p>

## 为什么是 scrollback

| | scrollback | deja-vu | claude-mem | agent mail |
|---|---|---|---|---|
| 读取已有会话 | ✓ | ✓ | ✗(只能向前捕获) | ✗ |
| 需要索引/守护进程 | ✗(原地扫描) | 需要索引 | 索引 + 每次调用 LLM | — |
| Devin · Trae · Qoder · CodeBuddy | ✓ | ✗ | ✗ | ✗ |
| 自动接入所有 agent | ✓ `install` | 部分 | 手动 | 手动 |
| Agent↔Agent 通信 | ✓ `channel` | ✗ | ✗ | ✓ |

赛道不同,存储同一份:既能召回 agent 已经写下的历史,
也有一条持久频道承载它们接下来要说的话。

## 安装

```bash
npm i -g sam-scrollback    # 需要 Node >= 22.13(node:sqlite)
scrollback install         # 自动把 skills + MCP 写入检测到的 agent
```

`scrollback install` 检测本机装了哪些 agent,往它们的 skills 目录写一份
`SKILL.md`,并在配置格式已知的 agent 里加一条 `mcpServers.scrollback`
—— 所有 agent 即刻获得召回能力,无需手动配置。可用 `--dry-run` 预览。

对原生支持 MCP 的 agent:

```json
{ "mcpServers": { "scrollback": { "command": "scrollback", "args": ["--mcp"] } } }
```

## 命令

```bash
scrollback doctor                              # 检测到的源 + 会话数
scrollback projects [--since YYYY-MM-DD]       # 按活跃度给项目 cwd 排名
scrollback list [--global|--cwd p] [--since D] # 列出会话
scrollback search "<keywords>" [--global] [--platform p]
scrollback context <id> [--grep kw] [--turns N] [--around N] [--from N --to N]
scrollback extract <id> [--grep kw] [--json]
scrollback --mcp                               # stdio 上的 MCP server
```

召回是两步下钻:

```bash
scrollback search "landing page" --global --since 2026-08-01
scrollback context 94aa7e8b --grep "landing" --turns 3
```

会话 id 接受任意唯一前缀。每个存储根目录都可以用
`SCROLLBACK_<PLATFORM>_ROOT` 覆盖(多个路径用 `:` 分隔)。

频道(channel)—— 管理平面本体,`~/.scrollback/channels`:

```bash
scrollback channel create <name> [--global] [--desc d] [--type chat|forum]
scrollback channel send <name> "<body>" [--to w] [--by b] [--kind k] [--key k]
scrollback channel read|watch|wait <name> [--from seq] [--kinds a,b]
scrollback inbox <worker> [--channel c] [--all] [--mark]
scrollback workers [--alive]                 # fleet 视图:各 worker 状态
scrollback spawn <claude|codex> "<task>" [--channel c]
```

## 路线图

- **fleet** —— 所有 agent 同屏可见

设计与竞品笔记:[docs/channel-design.md](docs/channel-design.md) ·
[docs/competitive.md](docs/competitive.md)

## 贡献

新增平台支持 = `src/sources/` 里一个 adapter 文件,实现
`roots()` + `sessions(root)`,外加 `fixtures/` 下的样本和
`test/sources.test.ts` 里的一致性测试。

```bash
node scrollback.ts <command>   # 开发入口,Node 23.6+ type-stripping
npm run build && npm test      # tsc → dist/,17 个一致性测试
```

## License

[MIT](LICENSE)
