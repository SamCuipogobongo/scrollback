# 竞品调研 — AI agent 会话历史检索工具

调研日期：2026-09-16。结论先行：**这个赛道已有成熟玩家，不是空白**。三个跨平台竞品 + 若干单平台工具。但 Devin 与国内 IDE（Trae/Qoder/CodeBuddy）无人覆盖，且无人做「装成 skill」的分发。

## 头部竞品

### deja-vu（vshulcz）— 最直接的竞品，Go 实现，822★

<https://github.com/vshulcz/deja-vu> · MIT · `curl | sh` 安装 + npm 包 `@vshulcz/deja-vu`（npm 壳下载二进制）

- **覆盖 25 个平台**：aider, amp, antigravity, claude code(含 Xcode CodingAssistant 变体+cc-mirror), cline, codex(含 Xcode 变体), copilot cli, copilot chat(vscode), cursor(IDE sqlite + CLI agent-transcripts), deepseek harness, gemini, goose, grok build, hermes, kimi-code, omp, openclaw, opencode, continue, crush, pi, prime-agent, qwen, roo, zed
- **架构**：`internal/sources/` 每平台一个 parser 文件；发现/doctor/install/registry 四处接线
- **索引**：本地构建，~10% 语料大小，20ms 中位查询；tiered lexical + 可选 embeddings；**索引时即脱敏**（strip keys/tokens/private key blocks）
- **召回注入**：MCP `recall` 工具 + 各家 hooks（session start / pre-edit / post-fail / post-compaction），`install --auto` 自动探测并接线
- **差异化细节**：
  - 每个 harness 支持 `DEJA_*_ROOT` 环境变量覆盖 root——非标安装 + 测试都靠它
  - `deja stats --card` 终端年度回顾卡片，可导出 SVG（自传播设计）
  - 每平台一个 SEO 落地页（"memory for X" × 22）
  - fixtures/ + conformance test 防上游格式漂移
  - 能力矩阵标注哪些平台的 hooks 上游还没实现（Roo hooks PR 在飞、Zed 无 hook API、Continue hooks 不触发）——诚实标注"becomes work the day upstream ships it"

### casr — cross_agent_session_resumer（Rust，17 providers）

<https://github.com/Dicklesworthstone/cross_agent_session_resumer>

- 覆盖：aider, amp, antigravity, **chatgpt desktop**, claude_code, clawdbot, cline, codex, cursor, factory, gemini, grok, kiro, openclaw, opencode, pi_agent, vibe
- **差异化定位：读 + 写**。不只搜索——能把 codex 会话转成 claude 格式写回 `~/.claude/projects/`，实现 `claude --resume` 续别的平台的会话（跨平台会话接力，真正的 handoff）
- 结构：`model`（canonical IR）→ `providers`（每平台读写）→ `pipeline`（转换编排）→ `responses`（全量 typed JSON 输出，为 MCP 备好）
- 参考点：`Provider` trait 的 read/write 双向设计；canonical IR 作为转换中枢

### txcript（Rust，12+ harnesses）

<https://github.com/skillsynchq/txcript> · Apache-2.0

- 定位是「transcript 格式转换库」而非搜索工具：`Transcript<Common>` 中枢 IR，`convert::<A,B>` 走 A→Common→B
- 值得抄的三个设计：
  - **`Span`**：half-open 消息下标区间，可序列化、可跨进程/网络边界——search/context 返回 "messages 12-18" 这种引用天然适合 MCP 响应
  - **`TextCodec` vs `Store` 分离**：纯格式解析（无 IO、可测试、可 WASM）与「存在哪」分层
  - **`Discovered`**：discover 只产元数据 + 加载方式，按需加载
- harness 文档是全网最细的格式逆向资料（amp/zed/gemini 的 disk shape 写得比官方全）

### 其余

| 工具 | 覆盖 | 特点 |
|---|---|---|
| ccboard(-core) | claude + cursor | Rust parser 库，cursor `state.vscdb` 读取参考实现 |
| toktrack | gemini/qwen 等 6 家 | token/成本统计向，qwen=gemini 格式参数化的先例 |
| cursaves | cursor 专用 | cursor 存储结构文档写得最清楚（2.x vs 3.0 差异） |
| thread-manager-for-amp | amp 专用 | amp threads + 内部 API |
| drift-connectors | cursor | workspace hash→项目路径解析参考 |
| specstory（商业） | cursor/copilot 等 | 实时保存为 md 文件——「导出形态」参考 |

## 从竞品抄什么（按优先级）

1. **`Span` 概念**（txcript）：search 结果返回可序列化的消息区间，context/extract/MCP 统一用 `session_id + span` 引用
2. **canonical IR + provider 双向读写**（casr）：先读；写预留接口——跨平台 handoff 是第二阶段差异化功能
3. **环境变量覆盖 root**（deja）：`SCROLLBACK_QWEN_ROOT` 等，测试与非标安装必需
4. **索引期脱敏**（deja）：密钥/token 在写进 index 时就剥掉，不只是展示时过滤——把"索引可安全留存"变成卖点
5. **install --auto**（deja）：探测 agent → 自动写 MCP 配置 + skill + hooks；我们的 `install` 命令照这个做
6. **hooks 自动召回**（deja）：session-start / post-compaction 自动注入相关历史——比手动 recall 高一个档次；各家 hook 能力不同（参考 deja 能力矩阵的诚实标注法）
7. **stats 卡片**（deja）：`stats --card` 出 SVG 年度回顾——自传播钩子，且本身就是作品集素材
8. **fixtures + conformance test**（deja）：每个格式存一份合成 fixture，防上游格式漂移
9. **gemini 族的过滤规则**（gemini-cli 源码）：跳过 `kind==='subagent'`、`hasResumableContent===false` 的会话
10. **cursor 双源**（deja）：IDE 走 state.vscdb，**Cursor CLI 走 `~/.cursor/projects/**/agent-transcripts/**/*.jsonl`**——CLI 是 jsonl 反而好读

## 已采集的存储路径速查

```
qwen        ~/.qwen/projects/*/chats/*.jsonl   (deja) | ~/.qwen/tmp/*/chats/session-*.{json,jsonl} (toktrack)
kimi-code   ~/.kimi-code/sessions/*/*/agents/main/wire.jsonl  + session_index.jsonl
kimi-cli旧   ~/.kimi/sessions/<md5>/<sid>/{context.jsonl,state.json}
cursor      ~/Library/Application Support/Cursor/User/{globalStorage,workspaceStorage/*}/state.vscdb
            + ~/.cursor/projects/**/agent-transcripts/**/*.jsonl  (CLI)
copilot-cli ~/.copilot/session-state/*/events.jsonl
copilot-chat <AppSupport>/<Code>/User/workspaceStorage/*/chatSessions/*.{json,jsonl}
cline       ~/.cline/data/sessions/*/*.messages.json | <vscode>/globalStorage/saoudrizwan.claude-dev/tasks/*/api_conversation_history.json
roo         <vscode>/globalStorage/rooveterinaryinc.roo-cline/tasks/*/api_conversation_history.json
continue    ~/.continue/sessions/*.json
zed         ~/Library/Application Support/Zed/threads/threads.db  (sqlite+zstd blob, data_type 字段)
factory     ~/.factory/sessions/<dashed-cwd>/<uuid>.jsonl + .settings.json
gemini      ~/.gemini/tmp/<projHash>/chats/session-*.{json,jsonl} + ~/.gemini/projects.json
goose       ~/.local/share/goose/sessions/*.{jsonl,db}
crush       ~/.local/share/crush/{crush.db,projects.json}
grok        ~/.grok/sessions/**/updates.jsonl
amp         ~/.local/share/amp/threads/T-*.json (新版转服务端,标 legacy)
deepseek    ~/.dsh/sessions/*/session-*/session.v3.jsonl.zstd
antigravity ~/.gemini/antigravity*/brain/*/.system_generated/logs/transcript.jsonl
```

## 我们的差异化（诚实版）

- **Devin**：全部竞品零覆盖（sessions.db + summaries/，SWE2Max 后用户增长期）
- **Trae / Qoder / CodeBuddy**：国产 IDE 三家，零覆盖；vscode-family 发现层 + 逐个逆向
- **skill 自注册分发**：`scrollback install` 往每个探测到的 agent 的 skills 目录写 SKILL.md——deja 有 skill 但分发仍靠插件/手动
- 劣势：deja-vu 领先我们一整代（索引、hooks、25 平台、文档、增长策略）。不要假装空白赛道，做差异化 + 把自家格式做扎实
