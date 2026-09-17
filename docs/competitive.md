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

---

# 第二批调研 — 协同/编排侧竞品 + 营销打法

调研日期：2026-09-17（补 gilded-edam session 挂掉的那轮）。范围从 recall 扩到 channel 对标的三层：**mailbox（agent 间消息）、orchestration/admin（管理台）、forward-memory（hooks 捕获）**。

## 格局总览

```
recall 读历史        deja-vu(领跑) casr txcript mem-search trellis-mem
mailbox 消息         mcp_agent_mail · agent-mailbox-mcp · A2A(企业层)
编排/管理台          Gas Town · Vibe Kanban · Conductor · Nimbalyst · Omnara
forward-memory      claude-mem（hooks 捕获+AI 压缩+注入）
```

**关键判断：「跨平台管理员」这个位置有人正在逼近，但没人占住。** deja-vu 从 recall 向"自动注入"走（hooks），mcp_agent_mail 占了 mailbox 语义，Gas Town 占了重型编排叙事——但"recall ∪ live coordination 同一个 store、同一个查询界面"这个合并形态是空的。

## Mailbox 层

### mcp_agent_mail（Dicklesworthstone）— 最强直接对手

<https://github.com/Dicklesworthstone/mcp_agent_mail> · <https://mcpagentmail.com/>

- HTTP-only FastMCP server；给 agent 发"记不住但好玩"的身份名（GreenCastle 式）
- inbox/outbox + 线程化 Markdown 消息 + 附件；**Git 存消息正文（人类可审计）+ SQLite FTS5 检索**
- **file reservations**：glob 级 advisory lease + TTL + 可绕过的 pre-commit guard——防两个 agent 改同一文件的 killer feature
- thread_id 直接映射 bead ID——**和 Beads 生态位绑定**，借它的任务图谱
- "Overseer" 概念：人类以高优先级消息介入 steering
- 已有商业化配套：iOS app + fleet 编排（host automation）
- 出口：static mailbox bundle 导出 + 签名 + age 加密（审计叙事）

### agent-mailbox-mcp（lleontor705）— 功能全但单薄

<https://github.com/lleontor705/agent-mailbox-mcp>

- SQS 式 mailbox + A2A task delegation（状态机+artifact+SSE 流）+ advisory resource leasing + DLQ + web dashboard
- 叙事是"MCP(agent→tools) + A2A(agent→agent) 合一"——覆盖面宽，但缺 killer demo

### A2A 协议（Google→Linux Foundation）— 不同层，但抢走叙事

- 一周年 150+ 组织、v1.0 GA、Azure AI Foundry / Bedrock AgentCore 生产部署
- 定位是**跨系统/跨厂商**的自治 agent RPC（agent card、签名、多租户）——和我们"同一台机器、同一个用户、本地 first"不同层
- 风险：它把"agent 跟 agent 说话"这件事的**公众认知**拿走了；我们的叙事必须明确是"你机器上的 worker 协作"，不是企业 federated agents

## 编排/管理台层

| 产品 | 定位语 | 形态 | 值得注意 |
|---|---|---|---|
| **Gas Town**（steveyegge/gastownhall） | "Kubernetes and Temporal had an ugly baby" / 20-30 个 Claude Code 并行 | tmux UI + Beads 数据层 | 角色体系 Mayor/Polecat/Witness/Refinery/Deacon；**agent 即数据**（identity/CV/hook 全落 git，session 是 cattle）；Kilo 出 hosted 版已 GA（2026-05）；Wasteland 做千镇联邦 |
| **Vibe Kanban** | "The new bottleneck is planning and review" | kanban + worktree 隔离 + PR 式 review | bloop 死后转社区 Apache-2.0；话术把人类重定位成"规划+评审者" |
| **Conductor** | macOS 原生并行 agent 桌面 app | 闭源商业 | 只 mac、只 Claude/Codex，但打磨最深 |
| **Nimbalyst** | 多 agent 视觉工作台 | 开源 | 营销靠**对比页**（vs Conductor vs VK 逐个列表）——SEO 抢"X vs Y"搜索 |
| **Omnara** | "Command center for AI coding agents"→"open-source alternative to Claude Managed Agents" | 手机/Web 遥控 + Postgres 状态 + RBAC + 沙箱机池 | 从"手机上盯 Claude Code"起家，已 pivot 成 managed agents 平台（给别家的 agent 做运行时托管）；curl install + voice mode 是钩子 |

## Forward-memory 层（另一条路线）

**claude-mem**（thedotmack，AGPL）：和 recall 派相反——不读存量历史，用 PostToolUse hook **向前捕获** tool 调用 → Agent SDK 压缩成 observation → SessionStart 注入。卖点 "Never lose what Claude learned"，28 语言 README，走 plugin marketplace 分发，带本地 worker + web viewer（localhost:37777 实时 memory stream）。

对我们的启示：它证明了"自动捕获+自动注入"路线的吸引力，但也暴露了成本——每条 tool call 都要过一次模型（钱+延迟）。我们读存量 jsonl 是零边际成本；deja 的话术 "starts empty vs starts full" 就是打这个点。

## 营销打法矩阵

| 竞品 | 一句话定位 | 分发/接入钩子 | 增长机制 |
|---|---|---|---|
| deja-vu | "Every memory tool starts empty. **deja starts full.**" | `curl\|sh` + `install --auto` 全自动接 MCP/hooks | 公开 benchmark（LongMemEval 84.9% hit@1）+ 官网 live demo + 22 个 "memory for X" SEO 页 + `stats --card` SVG 年度回顾（自传播） |
| beads | "A memory upgrade for your coding agent" | `bd init` 零配置 + AGENTS.md 加一行 | Yegge 叙事长文（Memento/50 First Dates 类比）+ hash-ID 解决多 agent 撞 ID 的真实痛点 + 反哺 Gas Town |
| gas town | "Kubernetes for agents" | brew/npm/go install 三渠道 | 角色命名宇宙（Mayor/Polecats…）meme 化 + "第四版才成"的坦诚叙事 + Kilo 云托管背书 |
| task-master | "drop into Cursor, Lovable, Windsurf, Roo, and others" | 每个 harness 一行 install + `/plugin marketplace add` | 28k★ 头部占位 + 3 agent 角色 + token 用量透明（"36 tools ~21k tokens"） |
| mcp_agent_mail | "email for your agents" | MCP server + CLI helper | 自动分配花名身份（记忆点）+ Git 可审计叙事 + 绑 Beads 生态 + iOS 商业配套 |
| claude-mem | "Never lose what Claude learned" | plugin marketplace 两命令 | 28 语言 README + 实时 web viewer 截图友好 |
| omnara | "control Claude Code from anywhere" / "open-source alternative to X" | curl install + 手机 app | 蹭大牌对标（vs Claude Managed Agents）+ 移动场景解放叙事 |

## 可抄的营销打法（按杠杆率）

1. **对立式定位语**：deja 的 "starts empty vs starts full" 是最强范式——一句把品类切开。我们需要自己的版本，候选见下。
2. **十秒接入**：`curl|sh` + `--auto` 探测所有 agent 一次接完。我们已有 install，但要做到 deja 的"装完即有用"（index 先建好）。
3. **公开可复现 benchmark**：LongMemEval/LoCoMo 是现成靶子，跑一遍发数字即可（deja 已验证这条路有效）。
4. **README live demo**：deja 官网把"在 16 个假会话里搜索"做成可敲的 widget——我们的对应物是"一眼看你所有 agent 在干嘛"的 workers 表。
5. **蹭大牌对标**："open-source alternative to Claude Managed Agents / Gas Town 的轻量版"——搜索流量是现成的。
6. **生态位绑定**：mcp_agent_mail 绑 beads thread_id；我们可以反过来——`scrollback` 的 channel 事件流天然可以当 beads/gastown 的审计层。
7. **角色/persona 命名**：Gas Town 的 Mayor/Polecat 让抽象架构变得可讲。我们给 worker 自动起名（mcp_agent_mail 的 GreenCastle 式）是零成本 meme。

## 定位候选（合并产品 = recall ∪ channel）

| 候选 | 评 |
|---|---|
| "The admin plane for all your agents" | 准确但偏内部术语，普通人不懂 admin plane |
| "**One log for every agent on this machine — what they did, what they're doing, what they need.**" | 信息全但长，做副标题合适 |
| "Slack for your agents, with total recall" | 借认知最快，但 Slack 隐喻只盖住一半 |
| "**Your agents' shared memory — and their mailbox.**" | 对称、诚实、把两个半边都盖住；推荐做首屏 |
| "The source of truth your agents actually share" | 蹭"source of truth"但抽象 |

我的推荐组合：首屏 **"Your agents' shared memory — and their mailbox."**，副标 "Every session they ever wrote, searchable. Every message between them, durable. One binary, `curl | sh`."

## 对 channel-design.md 的补充判断

- mcp_agent_mail 的 file reservation 确实值得偷（已在 design 里记了 v2）；比它更重要的是**它证明了 agent 愿意用花名身份**——我们 spawn 时自动起名可以直接抄。
- Gas Town 证明了"worker registry + supervisor + interrupt"是重型刚需，但它绑 tmux/Beads/角色宇宙；我们做单机 substrate 是正确的轻量位。
- A2A 不用慌也不用追：不同层。但 README 里要有一句话主动划清——"A2A 是跨厂商 agent 的 RPC；scrollback channel 是你本机 agent 的记事本+信箱"。
