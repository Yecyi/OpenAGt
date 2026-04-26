# OpenAGt vs CC + Codex + Hermes Agent 技术分析报告

> 报告生成时间：2026-04-21
> 分析对象：`packages/openagt`、`Code Reference/CC Source Code`、`Code Reference/codex`、`Code Reference/hermes-agent`
> 版本：OpenAGt v1.14.17

---

## 第一章：执行摘要

### 1.1 核心结论

本报告通过对 OpenAGt、Claude Code、Codex (Rust) 和 Hermes Agent (Python) 四个项目进行源码级深度调研，从架构设计、Runtime 全链路、上下文管理、工具系统、Agent 能力层、安全模型、多 Agent 协调、Provider 抽象八大维度展开全面技术对比。

**三大核心判断：**

1. **OpenAGt 的正确路线不是"像素级复刻 Claude Code"，也不是"全盘移植 Hermes"，而是以 TypeScript/Effect/Bun 为底座，以 CC 的产品工程纪律为参照，以 Hermes 的长期运行形态为方向，走模块化开源 agent helper 平台路线。**

2. **OpenAGt 当前最具差异化的竞争力是：多 Provider 抽象（15+）、Effect 驱动的模块化架构、Bun 高速启动、Flutter 原生客户端，以及 ACP/MCP 双协议扩展能力。**

3. **当前 OpenAGt 最大技术债是：typecheck 未全绿（~10 处类型不匹配）、session/prompt.ts 职责过重、CLI 端到端 smoke 未完成。**

### 1.2 差异化定位

| 项目             | 定位                                               | 核心竞争力                                                            |
| ---------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| **OpenAGt**      | 开源、多 Provider、可多端接入的模块化 agent helper | TypeScript 生态、Effect 架构、多端客户端、MCP/ACP 双协议              |
| **Claude Code**  | 商业级闭源 CLI 工具（Anthropic）                   | 产品工程成熟度、Session Memory、Cache-safe Prompt、12 项 Harness 机制 |
| **Codex**        | 企业级 Rust 原生 CLI + 桌面应用（OpenAI）          | 性能最优、多层 OS 沙箱、两阶段记忆系统、短 Prompt 压缩                |
| **Hermes Agent** | 长期运行 Python agent + 多渠道 Gateway             | Gateway 多入口、离线轨迹压缩、Skills Hub、SessionDB FTS               |

---

## 第二章：技术架构对比总览

### 2.1 架构形态对比

```
┌────────────────────────────────────────────────────────────────────┐
│                           OpenAGt (TypeScript/Bun)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │   CLI    │  │   Web    │  │ Desktop  │  │ Flutter  │           │
│  │(TUI/STDIO│  │ (SolidJS)│  │ (Tauri)  │  │  Mobile  │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │              │              │              │                   │
│  ┌────▼──────────────▼──────────────▼──────────────▼────┐         │
│  │              Hono HTTP Server + SSE                     │         │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │         │
│  │  │ Session │ │  Tool    │ │ Provider │ │Compaction│ │         │
│  │  │Manager  │ │ Registry │ │ Manager  │ │  Engine  │ │         │
│  │  └─────────┘ └──────────┘ └──────────┘ └──────────┘ │         │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │         │
│  │  │   Bus   │ │   MCP    │ │   ACP    │ │  Plugin  │ │         │
│  │  │(PubSub) │ │ Manager  │ │ Protocol │ │ System   │ │         │
│  │  └─────────┘ └──────────┘ └──────────┘ └──────────┘ │         │
│  └──────────────────────┬───────────────────────────────┘         │
│                         │                                            │
│              ┌──────────▼──────────┐                              │
│              │   SQLite (Drizzle)  │                              │
│              │    WAL Mode         │                              │
│              └─────────────────────┘                               │
└────────────────────────────────────────────────────────────────────┘
```

```
┌────────────────────────────────────────────────────────────────────┐
│                      Claude Code (TypeScript/Bun)                    │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │              Single Bundled CLI (cli.js ~12MB)             │    │
│  │  ┌──────────────────────────────────────────────────────┐ │    │
│  │  │                    Query Loop                         │ │    │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │ │    │
│  │  │  │ Feature  │ │ System   │ │ Tool     │ │ Cache  │ │ │    │
│  │  │  │  Gates   │ │ Prompt  │ │ Router   │ │Manager │ │ │    │
│  │  │  └──────────┘ └──────────┘ └──────────┘ └────────┘ │ │    │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │ │    │
│  │  │  │ Session  │ │Compact/ │ │Sub-agent │ │Remote  │ │ │    │
│  │  │  │ Memory   │ │Memory   │ │  Fork    │ │ Bridge │ │ │    │
│  │  │  └──────────┘ └──────────┘ └──────────┘ └────────┘ │ │    │
│  │  └──────────────────────────────────────────────────────┘ │    │
│  │                     (108 missing internal modules)        │    │
│  └────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

```
┌────────────────────────────────────────────────────────────────────┐
│                          Codex (Rust Native)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │   CLI    │  │  Desktop  │  │ app-server│  │exec-server│        │
│  │ (Native) │  │   App    │  │ (Cloud)   │  │ (Local)   │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │              │              │              │                │
│  ┌────▼──────────────▼──────────────▼──────────────▼────┐         │
│  │              Sandbox Engine (Native)                   │         │
│  │  Seatbelt(macOS) │ Landlock(Linux) │ RestrictedToken  │         │
│  └────────────────────────┬───────────────────────────────┘         │
│                           │                                        │
│  ┌────────────────────────▼───────────────────────────────┐         │
│  │  memories 两阶段 │ compact.rs │ OAuth (ChatGPT)      │         │
│  └─────────────────────────────────────────────────────┘          │
└────────────────────────────────────────────────────────────────────┘
```

```
┌────────────────────────────────────────────────────────────────────┐
│                    Hermes Agent (Python/Async)                       │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                      Gateway (Multi-Channel)               │    │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │    │
│  │  │   CLI   │ │ Slack  │ │Discord │ │Webhook │ │Scheduler│ │    │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ │    │
│  └──────────────────────────┬───────────────────────────────┘    │
│                             │                                        │
│  ┌──────────────────────────▼───────────────────────────────┐      │
│  │              Agent Loop (Python asyncio)                │      │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │      │
│  │  │ Skills   │ │  Memory  │ │ Context  │ │  Tool   │  │      │
│  │  │ Registry │ │ System   │ │Compressor│ │Registry │  │      │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │      │
│  └──────────────────────────┬───────────────────────────────┘    │
│                             │                                        │
│  ┌──────────────────────────▼───────────────────────────────┐      │
│  │  Trajectory Saver → Offline MapReduce Compression      │      │
│  └────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键维度矩阵

| 维度             | OpenAGt                 | Claude Code             | Codex              | Hermes Agent                 |
| ---------------- | ----------------------- | ----------------------- | ------------------ | ---------------------------- |
| **主语言**       | TypeScript              | TypeScript              | Rust               | Python                       |
| **运行时**       | Bun/Node                | Bun                     | Native             | CPython                      |
| **架构形态**     | 模块化 runtime + server | 产品化 CLI 单体         | Native CLI + cloud | Long-running agent + gateway |
| **上下文压缩**   | 三层（Micro/Auto/Full） | 分层压缩 + memory       | 短 prompt + remote | context_compressor           |
| **工具系统**     | Registry + MCP          | 内置 40+ 工具           | 沙箱隔离           | Skills system                |
| **Agent 通信层** | ACP 协议 + 多渠道       | 无                      | 无                 | Gateway 多入口               |
| **MCP 集成**     | 原生支持                | 无                      | MCP                | 无                           |
| **Skills 系统**  | @openagt/skill 工作流   | 无                      | 无                 | Skills hub                   |
| **文件管理**     | 工具层 read/write       | 内置工具                | 沙箱文件系统       | 内置                         |
| **插件架构**     | Plugin 系统             | Feature flags           | 无                 | 无                           |
| **Provider**     | 15+                     | Anthropic only          | OpenAI only        | Multiple                     |
| **安全模型**     | 基础权限 + 注入防护     | Feature gates           | 多层 OS 沙箱       | Process sandbox              |
| **记忆系统**     | Full compaction 摘要    | Session memory + memdir | memories 模块      | SessionDB + FTS              |
| **客户端**       | CLI/Web/Desktop/Flutter | CLI only                | CLI + Desktop App  | Multi-platform gateway       |
| **可扩展性**     | Plugin + MCP            | Feature flags           | MCP                | Skills hub                   |
| **会话持久化**   | SQLite WAL + Event      | 内存 + transcript       | session 持久化     | SessionDB + FTS              |
| **模型推理**     | Effect + AI SDK         | query loop              | Codex API          | async Python                 |
| **结果推送**     | SyncEvent + SSE         | 流式输出                | code + file output | formatted response           |

---

## 第三章：Runtime 全链路深度对比

### 3.1 OpenAGt Runtime 全链路

```
用户输入
    │
    ▼
[输入扫描] → injection guard (security/injection.ts)
    │       → 零宽字符、经典注入短语、控制字符检测
    ▼
[Session 管理] → SQLite WAL 持久化
    │           → SyncEvent 事件溯源
    ▼
[Prompt 装配] → system prompt + environment + skills + history
    │           → 分层 TXT 模板 + prompt.ts 循环逻辑
    ▼
    ├──► [MicroCompact] → 时间阈值折叠（无 LLM 调用）
    │                   → 5分钟前工具结果折叠，保留最近3个
    ├──► [AutoCompact] → token 预算评估 + 规则裁剪
    │                   → buffer 13k, maxOutput 20k, circuitBreaker 3
    └──► [FullCompact] → LLM 摘要生成
                        → Goal/Instructions/Discoveries 九段式模板
    ▼
[Provider Fallback Chain] → 主 provider → fallback provider(s)
    │                      → 429/5xx 重试逻辑
    ▼
[模型推理] → Effect runtime → AI SDK → LLM API
    │         → 25+ provider 支持
    ▼
[工具解析] → ToolCallItem[]
    │
    ├──► [Safe Tools] → 并发执行（read/glob/grep 等）
    └──► [Unsafe Tools] → 串行执行（bash/edit/write 等）
    │
    ├──► [路径冲突检测] → 等待 blocker 完成
    └──► [执行结果收集]
    │
    ▼
[事件发布] → SyncEvent → Bus publish → SSE 推送
    │         → step.started / text.delta / tool.called 等
    ▼
[输出响应] → Text delta / Tool result / Step summary
```

**关键技术细节：**

- **Effect 框架的 Layer/Context 依赖注入模式**：所有服务通过 `Context.Service` 定义，`Layer.effect` 实现，以 `yield*` 注入依赖
- **SQLite WAL 模式**：高并发读写，写操作不阻塞读操作
- **SyncEvent 事件溯源**：每个 session 有独立的 sequence number，保证单写者事务语义
- **AI SDK provider 抽象层**：统一接口支持 25+ provider，通过 `@ai-sdk/*` 包接入

### 3.2 Claude Code Runtime 全链路

```
用户输入
    │
    ▼
[Feature Gate] → feature() 检查 → 启用/禁用模块
    │            → 108 个 feature-gated 模块（DCE 删除）
    ▼
[Prompt 组装] → getSystemPromptParts() → 三层分段
    │
    ├──► [Static Section] → 可缓存（SYSTEM_PROMPT_DYNAMIC_BOUNDARY 前）
    │                      → session-stable cache（tool schema 参与 key）
    └──► [Dynamic Section] → 不可缓存（会话特有）
    │
    ├──► [Session Memory] → 后台 fork 子代理周期性更新
    │                    → token 阈值 + 工具调用间隔触发
    ├──► [memdir] → MEMORY.md 加载
    └──► [History Recall] → FTS 检索
    ▼
[模型推理] → query loop → API 调用
    │         → 流式输出处理
    ▼
[工具执行] → Tool Router → 权限检查 → sandbox
    │
    ├──► [Safe] → 并发执行
    ├──► [Unsafe] → 串行 + 冲突检测
    └──► [Sub-agent] → fork worker
    │
    ├──► [Compact 触发] → Micro → Auto → Full
    └──► [Remote Bridge] → 远程会话保持
    ▼
[输出] → 流式文本 + 工具状态 + 会话状态
```

**关键技术细节：**

- **`feature()` Bun 编译时内联**：108 个模块在编译时被 DCE，无法从 npm 包恢复
- **`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 缓存边界常量**：将 prompt 分为静态（可全局缓存）和动态（会话特有）两段
- **Session memory 后台子代理**：使用 `runForkedAgent()` 和 `createCacheSafeParams()` 确保隔离
- **Tool schema cache key**：使用 `inputJSONSchema` 参与 key 生成，防止 mid-session schema 漂移

### 3.3 Codex Runtime 全链路

```
用户输入
    │
    ▼
[OAuth 认证] → ChatGPT 账号关联
    │          → PKCE 授权码流程
    ▼
[Prompt 构造] → instructions/ + session + turn_context
    │
    ├──► [memories] → 两阶段（phase1 抽取 → phase2 consolidation）
    │               → stage_one_system.md 长规则
    └──► [compact] → 短 prompt + remote compaction
    ▼
[模型推理] → gpt-5.3-codex 等模型
    │          → OpenAI Codex-tuned 模型
    ▼
[Sandbox 执行] → Landlock/Seatbelt/RestrictedToken
    │
    ├──► [Local Mode] → 本地 exec-server + 进程隔离
    │                → 沙箱子进程执行
    └──► [Remote Mode] → 云端 app-server + 容器隔离
    │                  → WebSocket 连接
    │
    ├──► [网络控制] → 无网络 → allowlist → 全网络
    └──► [文件系统] → 作用域限制
    ▼
[输出] → Code 执行结果 + 文件变更 + 终端输出
```

**关键技术细节：**

- **Rust 原生执行性能**：无 JS 运行时开销，冷启动更快
- **多层 OS 级沙箱**：Seatbelt（macOS）、Landlock（Linux）、Windows RestrictedToken
- **短 prompt 压缩策略**：checkpoint handoff 模式，最小化上下文传递
- **Remote compaction 支持**：按 provider 能力走远程压缩路径

### 3.4 Hermes Agent Runtime 全链路

```
用户输入 / Webhook / Schedule Trigger
    │
    ▼
[Gateway] → 统一入口 + 路由 + 鉴权
    │
    ├──► [CLI Channel]
    ├──► [Slack/Discord Channel]
    ├──► [Webhook Channel]
    └──► [Scheduler Channel]
    ▼
[Session Manager] → 长期会话 + SessionDB FTS
    │              → SQLite FTS5 全文检索
    ▼
[Agent Loop] → Python async runtime
    │
    ├──► [Skills Registry] → 技能查找 + 加载
    ├──► [Memory System] → 记忆读取 + 写入
    │                   → 记忆类型分级
    └──► [Context Compressor] → 在线压缩
    ▼
[工具执行] → Tool Registry → dispatcher
    │
    ├──► [Tool Handlers] → 各工具具体实现
    └──► [Check Functions] → 权限/前置条件检查
    │
    ├──► [Trajectory Saver] → 轨迹记录
    └──► [Offline Compression] → 离线 MapReduce 处理
    ▼
[输出] → 格式化响应 + 事件发布
```

**关键技术细节：**

- **Python asyncio 异步运行时**：适合 I/O 密集型操作，但冷启动慢于 Bun
- **多渠道统一接入**：Gateway 模式让 agent 作为长期运行服务
- **Trajectory 轨迹记录**：完整的交互轨迹用于离线分析和回放
- **Skills hub**：技能市场支持搜索、安装、发布、版本管理

### 3.5 四方 Runtime 关键环节逐项对比

| 环节            | OpenAGt                  | Claude Code             | Codex                   | Hermes Agent              |
| --------------- | ------------------------ | ----------------------- | ----------------------- | ------------------------- |
| **输入处理**    | injection scan           | feature gate            | OAuth check             | gateway routing           |
| **Prompt 组装** | 分层 TXT + prompt.ts     | 三层分段 + boundary     | instructions/ + session | prompt builder + skills   |
| **上下文压缩**  | Micro/Auto/Full 三层     | 分层压缩 + memory       | 短 prompt + remote      | context_compressor        |
| **会话持久化**  | SQLite WAL + Event       | 内存 + transcript       | session 持久化          | SessionDB + FTS           |
| **模型推理**    | Effect + AI SDK          | query loop              | Codex API               | async Python              |
| **工具路由**    | ToolRegistry + partition | ToolRouter + permission | sandbox dispatch        | ToolRegistry + dispatcher |
| **执行模型**    | Safe 并发 / Unsafe 串行  | 同上 + sub-agent fork   | 本地/远程沙箱           | handler + check_fn        |
| **结果推送**    | SyncEvent + SSE          | 流式输出                | code + file output      | formatted response        |
| **认证方式**    | 多 provider API key      | Anthropic API key       | ChatGPT OAuth           | gateway auth              |
| **扩展机制**    | Plugin + MCP             | Feature flags           | MCP                     | Skills hub                |

### 3.6 关键常量与阈值对比

| 常量                 | OpenAGt | Claude Code | Codex | Hermes |
| -------------------- | ------- | ----------- | ----- | ------ |
| **时间压缩阈值**     | 5 分钟  | —           | —     | —      |
| **Token 缓冲**       | 13,000  | —           | —     | —      |
| **最大输出 Token**   | 20,000  | ~8,192      | —     | —      |
| **Circuit Breaker**  | 3 次    | —           | —     | —      |
| **摘要最大文件**     | 5 个    | 5 个        | —     | —      |
| **摘要 Token 预算**  | 50,000  | 50,000      | —     | —      |
| **每文件最大 Token** | 5,000   | 5,000       | —     | —      |
| **Keep-alive 间隔**  | —       | 120s        | —     | —      |
| **工具并发上限**     | —       | 10          | —     | —      |

---

## 第四章：上下文管理与压缩策略

### 4.1 Prompt 组装架构对比

#### OpenAGt：分层 TXT + 运行时循环

OpenAGt 的 Prompt 组装采用多文件分层策略：

```
session/prompt.ts (主循环)
    │
    ├──► system_prompt.txt → 厂商差异化模板选择
    ├──► environment.txt → 工作目录/git/日期等环境块
    ├──► skills.txt → 技能说明
    └──► agent/prompt/ → plan、结构化输出、子任务等模板
```

**核心代码：**

```typescript
// packages/openagt/src/session/prompt.ts
const [skills, envResult, instructions, modelMsgs] =
  yield *
  Effect.all([
    sys.skills(agent),
    Effect.sync(() => sys.environment(activeModel)),
    instruction.system().pipe(Effect.orDie),
    MessageV2.toModelMessagesEffect(msgs, activeModel),
  ])

const system = [
  ...envResult.static,
  ...envResult.semiStatic,
  ...memorySection, // Session memory for resume
  ...(skills ? [skills] : []),
  ...instructions,
]
```

**现状**：没有类似 CC 的静态/动态边界常量，**重复计费与延迟可能在多轮 + 长工具列表场景下劣于 CC**。

#### Claude Code：SYSTEM_PROMPT_DYNAMIC_BOUNDARY

CC 的 prompt 组装与缓存策略深度绑定：

```typescript
// constants/prompts.ts
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"

// 在 getSystemPrompt() 中：
return [
  // === 静态内容（可全局缓存）===
  getSimpleIntroSection(outputStyleConfig),
  getSimpleSystemSection(),
  getDoingTasksSection(),
  getUsingYourToolsSection(enabledTools),
  getToneAndStyleSection(),
  getOutputEfficiencySection(),
  // === 边界标记 ===
  ...(shouldUseGlobalCacheScope() ? [SYSTEM_PROMPT_DYNAMIC_BOUNDARY] : []),
  // === 动态内容（不可缓存）===
  ...resolvedDynamicSections, // memory, env_info, language, mcp_instructions 等
]
```

**Cache-safe 机制**：tool schema 参与 cache key 生成，防止 mid-session schema 漂移。

#### Codex：极简短 Prompt

Codex 采用"checkpoint handoff"哲学，压缩 Prompt 极简：

```markdown
// templates/compact/prompt.md（数行要点）
Provide a brief handoff summary for the next context window.
Focus on: active goals, pending decisions, recent file changes.
```

**对比**：CC 的压缩 Prompt 约 200+ 行，Codex 仅数行。Codex 依赖模型在常规对话风格下补全。

### 4.2 压缩算法三路对比

#### OpenAGt：三层压缩体系

| 层级      | 触发条件               | LLM 调用 | Token 节省 | 实现文件              |
| --------- | ---------------------- | -------- | ---------- | --------------------- |
| **Micro** | 工具结果 > 5 分钟      | 否       | 最小       | `compaction/micro.ts` |
| **Auto**  | `compressionRatio > 1` | 否       | 30-40%     | `compaction/auto.ts`  |
| **Full**  | context 溢出           | 是       | 40-55%     | `compaction/full.ts`  |

**Micro 压缩（时间阈值）：**

```typescript
export const MICRO_COMPACT_TIME_THRESHOLD_MS = 5 * 60 * 1000
export const DEFAULT_MICRO_COMPACT_CONFIG = {
  timeThresholdMs: 5 * 60 * 1000,
  preserveRecentN: 3,
  compactableTools: new Set(["read", "grep", "glob", "webfetch", "codesearch", "websearch"]),
}
```

**Auto 压缩（Token 预算）：**

```typescript
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

// 优先级公式
const priority = Math.log2(age_minutes + 1) * (11 - importance) + contentWeight * 0.5
```

**Full 压缩（LLM 摘要）：**

```typescript
// 九段式摘要模板
## Goal
## Instructions
## Discoveries
## Accomplished
## Relevant Files
```

#### Claude Code：Micro + Full（verbose）

CC 的压缩策略没有显式的"Auto"层，而是通过优先级规则处理：

```typescript
// NO_TOOLS_PREAMBLE - 强制禁止工具调用
const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.`

// 九段式 summary 结构
1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections
4. Errors and Fixes
5. Problem Solving
6. All User Messages
7. Pending Tasks
8. Current Work
9. Optional Next Step
```

#### Codex：短 Prompt + Remote

Codex 的压缩极简，但支持 remote compaction：

```typescript
// compact.rs
SUMMARIZATION_PROMPT = "checkpoint handoff" // 极短

should_use_remote_compact_task = (provider) => {
  // 按 provider 能力走远程压缩
}
```

### 4.3 记忆系统三路对比

| 维度           | OpenAGt              | Claude Code                   | Codex                                 |
| -------------- | -------------------- | ----------------------------- | ------------------------------------- |
| **形态**       | Full compaction 摘要 | Session markdown + 后台子代理 | 两阶段 memories                       |
| **存储**       | 消息持久化           | `MEMORY.md` 文件 + transcript | `memory_summary.md`                   |
| **更新频率**   | context 溢出时       | token/工具调用阈值触发        | phase1 + phase2 异步                  |
| **模型**       | 当前 session 模型    | 后台 fork 子代理              | phase1: gpt-5.4-mini, phase2: gpt-5.4 |
| **结构**       | 九段式摘要           | 固定章节 + 仅 Edit 更新       | 证据链 + no-op gate                   |
| **Token 上限** | 50,000               | —                             | 5,000                                 |

**OpenAGt 缺口**：缺少 CC 的"固定章节会话笔记 + 仅 Edit 更新"流水线，以及 Codex 的两阶段 consolidation 管道。

---

## 第五章：工具系统与调度机制

### 5.1 工具注册与发现

#### OpenAGt：Registry + 多源加载

```typescript
// packages/openagt/src/tool/registry.ts
// 从多个来源加载工具：
// 1. 内置工具（bash, read, glob, grep, edit, write, task, todo 等）
// 2. 自定义工具目录（{tool,tools}/*.{js,ts}）
// 3. MCP Server 工具
// 4. 插件工具

const matches = dirs.flatMap((dir) => Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true }))
```

**内置工具列表**：bash, read, glob, grep, edit, write, task, task_list, task_get, task_wait, task_stop, todo, webfetch, websearch, codesearch, question, lsp, plan, skill, apply_patch, invalid

#### Claude Code：40+ 内置工具

CC 的工具系统更庞大，分为多个类别：

```
文件操作：FileReadTool, FileEditTool, GlobTool, GrepTool
Shell 执行：BashTool, PowerShellTool
Agent 管理：AgentTool, TaskCreateTool, TaskListTool, TaskUpdateTool, TaskOutputTool
系统工具：WebSearchTool, WebFetchTool, MCPTool, ConfigTool
笔记本：NotebookEditTool
Skills：SkillTool
```

**工具可用性按 agent 类型区分**：

```typescript
// 异步 agent 允许的工具 vs 所有 agent 禁止的工具
export const ASYNC_AGENT_ALLOWED_TOOLS = new Set([...])
export const ALL_AGENT_DISALLOWED_TOOLS = new Set([TASK_OUTPUT_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME, ...])
```

### 5.2 工具并发分区

#### OpenAGt：Safe/Unsafe 双轨

```typescript
// packages/openagt/src/tool/partition.ts
export const CONCURRENCY_SAFE_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "webfetch",
  "codesearch",
  "websearch",
  "lsp",
  "question",
  "skill",
  "task_list",
  "task_get",
  "task_wait",
])

export const UNSAFE_PATTERNS = new Set(["bash", "edit", "write", "task", "todo", "plan", "apply_patch"])
```

**执行流程**：

```
工具调用列表
    │
    ├──► Safe batch → 并发执行（Promise.all）
    └──► Unsafe batch → 串行执行（逐个等待）
    │
    └──► 路径冲突检测 → unsafe 等待 blocker 完成
```

#### Claude Code：同样的 Safe/Unsafe 分组

CC 的工具系统实现相同的并发分区逻辑，并额外支持：

- **子代理 fork**：AgentTool 可派生新的 worker
- **Swarm worker 权限转发**：领导节点将权限委托给 worker

### 5.3 路径冲突检测

```typescript
// packages/openagt/src/tool/path-overlap.ts
// 从工具输入中递归提取路径字符串
export function extractPathsFromInput(input: Record<string, unknown>): string[]

// 检测路径是否重叠（同目录或相同文件）
export function pathsOverlap(paths1: string[], paths2: string[]): boolean

// 主检测函数
export function detectPathConflicts(
  calls: Array<{ toolName: string; input: Record<string, unknown> }>,
): Array<{ call1: number; call2: number; reason: string }>
```

### 5.4 危险命令检测

#### Claude Code：跨平台检测

```typescript
// Cross-platform code execution detection
export const CROSS_PLATFORM_CODE_EXEC = [
  "python",
  "python3",
  "node",
  "deno",
  "tsx",
  "ruby",
  "perl",
  "php",
  "lua",
  "npx",
  "bunx",
  "npm run",
  "yarn run",
  "pnpm run",
  "bun run",
  "bash",
  "sh",
  "ssh",
]

export const DANGEROUS_BASH_PATTERNS = [
  ...CROSS_PLATFORM_CODE_EXEC,
  "zsh",
  "fish",
  "eval",
  "exec",
  "env",
  "xargs",
  "sudo",
]
```

**OpenAGt 当前状态**：已实现 `security/injection.ts` 的注入检测，但缺少 `dangerous-command-detector.ts`（规划但未实现）。

---

## 第六章：Agent 能力层

### 6.1 ACP 协议（Agent Communication Protocol）

#### OpenAGt ACP 实现

ACP 是 OpenAGt 的核心通信协议，基于 JSON-RPC over stdio：

```
// packages/openagt/src/acp/
├── server.ts     → JSON-RPC over stdio 的 ACP 服务端
├── types.ts      → 会话、消息、事件类型定义
└── index.ts      → 导出
```

**设计理念**：轻量级 agent 间通信协议，支持：

- Session 管理（create, resume, archive）
- 工具调用（通过 ACP 层代理）
- 事件订阅（SSE over ACP）
- 权限委派（subagent 权限继承）

**与 Hermes Gateway 对比**：

| 维度     | OpenAGt ACP         | Hermes Gateway                      |
| -------- | ------------------- | ----------------------------------- |
| 协议基础 | JSON-RPC over stdio | HTTP/WebSocket                      |
| 多渠道   | 无（单一 stdio）    | CLI/Slack/Discord/Webhook/Scheduler |
| 鉴权     | 通过 ACP 消息头     | Gateway 统一鉴权层                  |
| 消息格式 | JSON-RPC            | 各渠道自定义                        |

### 6.2 MCP（Model Context Protocol）

#### OpenAGt MCP 集成

```typescript
// packages/openagt/src/mcp/
├── manager.ts   → MCP Server 管理、生命周期
├── transport.ts → 多传输支持（stdio/HTTP/SSE）
├── types.ts     → MCP 资源、工具、prompt 类型
└── index.ts     → 导出
```

**关键特性**：

- **多传输支持**：stdio（默认）、HTTP + SSE
- **OAuth 2.0 认证**：支持 Pinterest 等需要 OAuth 的 MCP Server
- **工具映射**：MCP 工具自动映射到 OpenAGt 工具系统
- **资源订阅**：支持 MCP 资源的实时更新推送

**OAuth 实现**：

```typescript
// packages/openagt/src/mcp/oauth.ts
export async function loadOAuthConfig(serverId: string): Promise<OAuth2Config | undefined>
export function createOAuthProvider(config: OAuth2Config): OAuthProvider
export async function refreshTokenIfNeeded(provider: OAuthProvider): Promise<void>
```

### 6.3 Skills 工作流系统

#### OpenAGt Skills

Skills 是 OpenAGt 的技能定义格式，使用 Markdown + frontmatter：

```yaml
---
name: skill-name
description: 技能描述
version: 1.0.0
author: author-name
---

# Skill Name

## Description
技能详细描述...

## Usage
使用说明...

## Examples
代码示例...
```

**发现机制**（按优先级）：

1. 全局 skills 目录（`~/.openagt/skills/`）
2. 项目内 skills 目录（`./.openagt/skills/`）
3. 配置路径（`openagt.skills`）
4. 远程 URL（GitHub raw content）
5. MCP Server 内嵌 skills

**与 Hermes Skills Hub 对比**：

| 维度     | OpenAGt Skills         | Hermes Skills Hub   |
| -------- | ---------------------- | ------------------- |
| 定义格式 | Markdown + frontmatter | 结构化 Python 类    |
| 版本管理 | 基础（version 字段）   | 完整版本 + 依赖     |
| 发布机制 | GitHub URL 分享        | 技能市场 + 安装命令 |
| 测试     | 无                     | 集成测试要求        |
| 生命周期 | 一次性加载             | 可更新/卸载         |

### 6.4 插件架构

#### OpenAGt Plugin 系统

```typescript
// packages/openagt/src/plugin/
├── codex.ts     → OpenAI Codex OAuth 插件
├── types.ts     → PluginManifest, HookDefinition
└── index.ts     → 导出
```

**Plugin Manifest 格式**：

```typescript
interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  hooks?: {
    before_tool_call?: HookFn
    after_tool_call?: HookFn
    before_llm_call?: HookFn
    after_llm_call?: HookFn
    shell_env?: (env: Record<string, string>) => Record<string, string>
  }
  tools?: Record<string, ToolDefinition>
}
```

**Hook 系统**：

```typescript
// 可注入的生命周期钩子
before_tool_call(toolName, input, session) // 工具调用前
after_tool_call(toolName, result, session) // 工具调用后
before_llm_call(messages, model) // LLM 调用前
after_llm_call(response, model) // LLM 调用后
shell_env(env) // Shell 环境变量修改
```

**Codex OAuth 插件案例**：

```typescript
// 支持的 Codex 模型
const CODEX_MODELS = ["gpt-5.1-codex", "gpt-5.2-codex", "gpt-5.3-codex"]

// OAuth 端点
const ISSUER = "https://auth.openai.com"
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
```

### 6.5 文件管理与权限

#### OpenAGt 文件操作

**Scope 控制**：每个文件操作都有权限检查：

```typescript
// 文件读取权限请求
interface ReadPermissionRequest {
  type: "read"
  path: string
  reason: string
  preview?: string
}

// 写入权限请求（包含 diff）
interface WritePermissionRequest {
  type: "write" | "edit"
  path: string
  diff?: string // 统一 diff
  reason: string
  preview?: string
}
```

**Scope 路径**：

```typescript
SCOPE_PATTERNS = {
  "./*": "project", // 当前项目
  "./.*": "project", // 点文件
  "../*": "parent", // 父目录（需额外确认）
  "~/*": "home", // 用户目录（需额外确认）
  "/*": "root", // 根目录（需额外确认）
}
```

**与 Codex 沙箱对比**：

| 维度     | OpenAGt              | Codex                                |
| -------- | -------------------- | ------------------------------------ |
| 文件控制 | 权限请求 + diff      | OS 级沙箱作用域                      |
| 写保护   | .env, .env.\* 需确认 | settings.json 等关键文件保护         |
| Git 保护 | 无                   | bare repo 检测（防 .git/hooks 利用） |

---

## 第七章：安全与沙箱模型

### 7.1 OpenAGt 注入防护

#### security/injection.ts

```typescript
// 注入检测模式
export const INJECTION_PATTERNS: InjectionPattern[] = [
  // 高危
  { pattern: /\u200b|\u200c|\u200d|\ufeff/, severity: "high", description: "零宽字符" },
  { pattern: /ignore previous instructions?/i, severity: "high" },
  { pattern: /disregard (?:all )?(?:previous|prior) (?:instructions?|commands?)/i, severity: "high" },
  { pattern: /(?:api|secret|key|password|token)\s*[:=]\s*['"]?[a-zA-Z0-9_-]{20,}/i, severity: "high" },
  // 中危
  { pattern: /you (?:are now|have become|must act as) a(?:n)? (?:different|new|other)/i, severity: "medium" },
  // 低危
  { pattern: /<!--[\s\S]*?-->/, severity: "low" }, // HTML 注释
]

// 处理策略
export function handleInjectedContent(content: string, source: string): HandleResult {
  const scan = scanForInjection(content)
  if (scan.clean) return { action: "allow", content }

  const high = scan.issues.filter((issue) => issue.severity === "high")
  if (high.length > 0) {
    return { action: "block", content: `[Blocked content from ${source}...]` }
  }

  const sanitized = sanitizeContent(content)
  return { action: "sanitize", content: sanitized.sanitized, removed: sanitized.removed }
}
```

### 7.2 Claude Code 多层安全

#### 沙箱配置

```typescript
interface SandboxRuntimeConfig {
  network: {
    allowedDomains: string[]
    deniedDomains: string[]
    allowUnixSockets: boolean
    allowLocalBinding: boolean
  }
  filesystem: {
    denyRead: string[]
    allowRead: string[]
    allowWrite: string[]
    denyWrite: string[]
  }
}
```

**关键安全特性**：

- `settings.json` 写保护（防止沙箱逃逸）
- `.claude/skills` 写保护（防止权限提升）
- Git bare repo 检测（防止 `.git/hooks` 利用）
- 平台感知路径解析（`//path` = 绝对路径）

### 7.3 Codex 多层 OS 沙箱

```
┌───────────────────────────────────────┐
│           Seatbelt (macOS)            │
│     Mandatory Access Control profile   │
├───────────────────────────────────────┤
│          Landlock (Linux)            │
│       Linux kernel LSM support        │
├───────────────────────────────────────┤
│   Windows RestrictedToken             │
│      Process token mitigation        │
├───────────────────────────────────────┤
│        Exec Policy Layer              │
│  Command whitelist / dangerous detect │
└───────────────────────────────────────┘
```

**网络访问分级**：无网络 → allowlist → 全网络

### 7.4 安全能力对比

| 安全维度     | OpenAGt                | Claude Code       | Codex             | Hermes          |
| ------------ | ---------------------- | ----------------- | ----------------- | --------------- |
| 注入检测     | 已实现（pattern scan） | 已实现            | 已实现            | 已实现          |
| 危险命令检测 | 规划（未实现）         | 已实现            | 已实现            | 已实现          |
| OS 级沙箱    | 无                     | Seatbelt/Landlock | Seatbelt/Landlock | Process sandbox |
| 文件作用域   | 权限请求               | 沙箱配置          | OS 作用域         | 权限检查        |
| 网络控制     | 无                     | 域名级            | 分级控制          | 无              |
| Git 保护     | 无                     | bare repo 检测    | 无                | 无              |
| 子进程隔离   | 无                     | 有                | 有                | 有              |

---

## 第八章：多 Agent 与协调机制

### 8.1 Claude Code Coordinator 模式

CC 的 subagent 基于 Coordinator 架构：

```typescript
// Coordinator system prompt
export function getCoordinatorSystemPrompt(): string {
  return `You are Claude Code, an AI assistant that orchestrates software engineering tasks across multiple workers.

## Your Role
You are a **coordinator**. Your job is to:
- Help the user achieve their goal
- Direct workers to research, implement and verify code changes
- Synthesize results and communicate with the user
- Answer questions directly when possible

## Your Tools
- **AgentTool** - Spawn a new worker
- **SendMessageTool** - Continue an existing worker
- **TaskStopTool** - Stop a running worker
`
}
```

**子代理隔离机制**：

- 使用 `runForkedAgent()` 创建隔离进程
- `createCacheSafeParams()` 确保不污染父会话 cache
- 权限从父会话继承

### 8.2 OpenAGt subagent

```typescript
// 当前仅支持基本的 subagent
general: {
  name: "general",
  description: `General-purpose agent for researching complex questions...`,
  permission: Permission.merge(defaults, user),
  mode: "subagent",
}
```

**差距**：没有 Coordinator 模式，无法处理需要分工协作的复杂任务。

### 8.3 Hermes Trajectory Fork

Hermes 支持轨迹分叉用于实验性探索：

```python
class TrajectoryFork:
    def create_branch(self, session_id, name):
        """创建分支"""

    def merge_branch(self, source, target):
        """合并分支"""

    def replay(self, trajectory_id):
        """回放历史轨迹"""
```

---

## 第九章：Provider 抽象与 Fallback

### 9.1 OpenAGt Provider 系统

#### Provider Config

```typescript
// packages/openagt/src/config/provider.ts
export class Info extends Schema.Class<Info>("ProviderConfig")({
  fallback: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      chain: Schema.mutable(
        Schema.Array(
          Schema.Struct({
            provider: Schema.String,  // e.g., "anthropic"
            model: Schema.String,     // e.g., "claude-sonnet-4-20250514"
          }),
        ),
      ),
      provider: Schema.optional(Schema.String),
      model: Schema.optional(Schema.String),
      retryOnRateLimit: Schema.optional(Schema.Boolean),
      retryOnServerError: Schema.optional(Schema.Boolean),
      maxRetries: Schema.optional(PositiveInt),
    }),
  ),
})
```

**支持 Provider 列表**（>15 个）：

Anthropic, OpenAI, Google Vertex, Amazon Bedrock, Azure, GitHub Copilot, GitLab, Cohere, Mistral, Groq, Perplexity, Together AI, Cloudflare Workers AI, OpenRouter, Fireworks AI, Novita AI, Hyperbolic, 01 AI, SKYFIRE, Amber, Cloudflare Workers AI, DeepInfra, Lixt, Mandark, Nimbleway, Oia, Proton, Replicate, Together AI, Upstage, Voy, x.ai 等。

#### Fallback 状态机

```typescript
// packages/openagt/src/provider/fallback-service.ts
export interface FallbackState {
  baseProviderID: string
  baseModelID: string
  chain: FallbackEntry[]
  index: number
  attempts: number
  maxRetries: number
  retryOnRateLimit: boolean
  retryOnServerError: boolean
}

// Fallback 触发条件
shouldFallback(error, state): boolean {
  if (parsed.statusCode === 429) return state.retryOnRateLimit
  if (parsed.statusCode >= 500 && parsed.statusCode < 600) return state.retryOnServerError
  if (parsed.message.includes("rate limit")) return state.retryOnRateLimit
  if (parsed.message.includes("overloaded")) return state.retryOnServerError
}
```

### 9.2 Claude Code Provider

CC 仅支持 Anthropic，**无 fallback 机制**。

### 9.3 Provider 能力对比

| 维度           | OpenAGt           | Claude Code | Codex | Hermes   |
| -------------- | ----------------- | ----------- | ----- | -------- |
| Provider 数量  | 15+               | 1           | 1     | Multiple |
| Fallback Chain | 已实现            | 无          | 无    | 部分实现 |
| Retry Logic    | 已实现（429/5xx） | 无          | 无    | 有       |
| 动态模型选择   | 无                | 无          | 无    | 有       |

---

## 第十章：部署与长期运行

### 10.1 OpenAGt 多端架构

```
┌────────────────────────────────────────────────────────────┐
│                        OpenAGt Server                       │
│  Hono HTTP Server (port 18789)                            │
│  ├── /api/sessions/* → Session CRUD                       │
│  ├── /api/events/* → SSE event stream                     │
│  ├── /api/tools/* → Tool registry                        │
│  └── /api/mcp/* → MCP server management                  │
└────────────────────────────────────────────────────────────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────────┐
│   TUI CLI   │    │  Web App    │    │   Flutter       │
│  (SolidJS)  │    │  (SolidJS)  │    │   Mobile       │
│  localhost  │    │  localhost   │    │   Remote       │
└─────────────┘    └─────────────┘    └─────────────────┘
```

**Flutter 客户端**：通过 SSE 连接服务器，订阅事件流，无需复制 agent runtime。

### 10.2 Claude Code 部署

- **本地 CLI**：npm 全局安装 `@anthropic-ai/claude-code`
- **Remote Bridge**：WebSocket + POST hybrid 传输，支持远程会话保持
- **无独立服务端**：所有逻辑打包在单一 `cli.js` 中

### 10.3 Codex 部署

```
Local Mode：
  Codex CLI → exec-server → Sandbox (Landlock)

Remote Mode：
  Codex CLI → WebSocket → app-server (cloud) → Container Sandbox
```

**Codex 的 exec-server** 可独立部署，支持本地隔离执行。

### 10.4 Hermes 部署

```
Gateway (长期运行进程)
    │
    ├── CLI Channel (stdin/stdout)
    ├── Slack/Discord Channel (Webhook)
    ├── Webhook Channel (HTTP POST)
    └── Scheduler Channel (Cron)
```

**Gateway 作为长期运行服务**：适合企业级自动化和团队协作场景。

---

## 第十一章：可继承价值与避免项

### 11.1 Claude Code：应该吸收的部分

#### 11.1.1 工具调度纪律

**CC 的实现**：CC 在 `toolRouter.ts` 中实现了精细的工具分类（`TOOL_SAFE`、`TOOL_UNSAFE`），并通过 `ToolPermissionContext` 在整个调用链中传播权限状态。关键代码位于 `dangerousPatterns.ts`：

```typescript
export const CROSS_PLATFORM_CODE_EXEC = [
  "python",
  "python3",
  "node",
  "deno",
  "tsx",
  "ruby",
  "perl",
  "php",
  "lua",
  "npx",
  "bunx",
  "npm run",
  "yarn run",
  "pnpm run",
  "bun run",
  "bash",
  "sh",
  "ssh",
]

export const DANGEROUS_BASH_PATTERNS = [
  ...CROSS_PLATFORM_CODE_EXEC,
  "zsh",
  "fish",
  "eval",
  "exec",
  "env",
  "xargs",
  "sudo",
]
```

**OpenAGt 现状**：`partition.ts` 已有 Safe/Unsafe 分组，但 `dangerous-command-detector.ts` 仅规划未实现。

**建议**：引入 CC 的 8 类命令替换模式（`COMMAND_SUBSTITUTION_PATTERNS`）、二进制劫持变量检测（`LD_`、`DYLD_`、`PATH$`），以及 23 个 bash security check IDs。

#### 11.1.2 静态/动态 Prompt 边界

**CC 的实现**（`constants/prompts.ts`）：

```typescript
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"

// 关键：tool schema 参与 cache key 生成
export const TOOL_CACHE_KEY_PARTS = [
  globalServerPromptCacheScope ?? "",
  // 确保 tool schema 变化时 cache key 也变化
  ...enabledTools.map((t) => `${t.name}:${t.inputJSONSchema}`).sort(),
]
```

**OpenAGt 现状**：无 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`，所有 prompt 段落在每次请求时都参与 token 计算。

**建议**：在 `prompt.ts` 中引入边界常量，将 `environment.txt`（静态）和 `skills.txt`（半静态）标记为"可缓存"，将 `reminders` 和 session-specific content 标记为"不可缓存"。当前 OpenAGt 的分层 TXT 模板天然支持此改造。

#### 11.1.3 Session Memory

**CC 的实现**（`src/services/SessionMemory/prompts.ts`）：

```typescript
// 九段式 Session Memory 模板
const DEFAULT_SESSION_MEMORY_TEMPLATE = `
# Session Title
_A short and distinctive 5-10 word descriptive title_

# Current State
_What is actively being worked on right now?_

# Task specification
_What did the user ask to build?_

# Files and Functions
_What are the important files? What do they contain?_

# Workflow
_What bash commands are usually run and in what order?_

# Errors & Corrections
_Errors encountered and how they were fixed_

# Learnings
_What has worked well? What to avoid?_
`
```

**触发条件**（`sessionMemoryUtils.ts`）：

- 初始化阈值：`minimumMessageTokensToInit = 6000`
- 更新间隔：`minimumTokensBetweenUpdate = 4000`
- 工具调用次数：`toolCallsBetweenUpdates = 10`

**OpenAGt 现状**：Full compact 生成九段式摘要，但 Session Memory 模板仅为压缩输出，缺少标题、当前状态、工作流等元信息。

**建议**：实现固定章节会话笔记（`session/memory.ts`），与压缩协同但独立存储，支持按章节增量更新而非全量重写。

#### 11.1.4 NO_TOOLS Preamble

**CC 的实现**（`services/compact/prompt.ts`）：

```typescript
const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.
`
```

**OpenAGt 现状**：`full.ts` 的压缩模板无禁止工具调用的声明。

**建议**：在 `full.ts` 模板开头增加 `NO_TOOLS_PREAMBLE`，并在压缩 Prompt 的 system role 中明确"禁止工具调用"。

#### 11.1.5 跨平台 Shell 安全检测

**CC 的实现**（`src/utils/powershell/dangerousCmdlets.ts`）：

```typescript
export const DANGEROUS_CMDS = [
  "Set-ExecutionPolicy",
  "Invoke-Expression",
  "Invoke-Command",
  "Start-Process -Verb RunAs",
  "certutil.exe",
  "bitsadmin.exe",
  "mshta.exe",
  "wscript.exe",
  "cscript.exe",
  "regsvr32.exe",
  "rundll32.exe",
  "powershell -enc",
  "powershell -EncodedCommand",
]
```

**OpenAGt 现状**：树-sitter bash 分析已实现在 `src/security/dangers.ts` 中，涵盖 23 种安全检查，但 PowerShell 检测尚未覆盖。

**建议**：补充 PowerShell cmdlet 安全检测，对齐 CC 的 `DANGEROUS_CMDS` 列表。

#### 11.1.6 Micro-Compact（轻量压缩）

**CC 的实现**（`src/services/compact/microCompact.ts`）：

```typescript
// CC 的 micro compact 策略：保留关键结构 + 压缩次要结果
const KEEP_PATTERNS = [/^(file_)?read/i, /^[A-Z][a-z]+(?:Error|Exception|Warning)/, /diff --git/]
const TRUNCATE_PATTERNS = [/stdout|stderr|output|result/i]
```

**OpenAGt 现状**：`micro.ts` 的 MicroCompact 基于时间阈值，保留最近 3 个工具结果。

**建议**：增加基于模式的 MicroCompact 规则，区分"关键结果"（diff、错误）和"次要结果"（日志、进度），更精细地控制压缩粒度。

### 11.2 Claude Code：不应该照搬的部分

#### 优点（应该吸收）

**11.2.1 工具调度纪律**

**代码段：精细的工具分类与权限传播**

```typescript
// packages/openagt/src/tool/partition.ts
// OpenAGt 已实现的 Safe/Unsafe 分组
export const CONCURRENCY_SAFE_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "webfetch",
  "codesearch",
  "websearch",
  "lsp",
  "question",
  "skill",
  "task_list",
  "task_get",
  "task_wait",
])

export const UNSAFE_PATTERNS = new Set(["bash", "edit", "write", "task", "todo", "plan", "apply_patch"])
```

**代码段：危险命令检测（CC 实现）**

```typescript
// CC 的 dangerousPatterns.ts
export const CROSS_PLATFORM_CODE_EXEC = [
  "python",
  "python3",
  "node",
  "deno",
  "tsx",
  "ruby",
  "perl",
  "php",
  "lua",
  "npx",
  "bunx",
  "npm run",
  "yarn run",
  "pnpm run",
  "bun run",
  "bash",
  "sh",
  "ssh",
]

export const DANGEROUS_BASH_PATTERNS = [
  ...CROSS_PLATFORM_CODE_EXEC,
  "zsh",
  "fish",
  "eval",
  "exec",
  "env",
  "xargs",
  "sudo",
]
```

**11.2.2 静态/动态 Prompt 边界**

**代码段：CC 的缓存边界常量**

```typescript
// constants/prompts.ts - CC 实现
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"

// Tool schema 参与 cache key 生成
export const TOOL_CACHE_KEY_PARTS = [
  globalServerPromptCacheScope ?? "",
  ...enabledTools.map((t) => `${t.name}:${t.inputJSONSchema}`).sort(),
]
```

**11.2.3 Session Memory**

**代码段：九段式会话记忆模板**

```typescript
// CC 的 Session Memory 模板（sessionMemoryUtils.ts）
const DEFAULT_SESSION_MEMORY_TEMPLATE = `
# Session Title
_A short and distinctive 5-10 word descriptive title_

# Current State
_What is actively being worked on right now?_

# Task specification
_What did the user ask to build?_

# Files and Functions
_What are the important files? What do they contain?_

# Workflow
_What bash commands are usually run and in what order?_

# Errors & Corrections
_Errors encountered and how they were fixed_

# Learnings
_What has worked well? What to avoid?_
`

// 触发条件
const minimumMessageTokensToInit = 6000
const minimumTokensBetweenUpdate = 4000
const toolCallsBetweenUpdates = 10
```

**11.2.4 NO_TOOLS Preamble**

**代码段：禁止工具调用的强制声明**

```typescript
// CC 的 services/compact/prompt.ts
const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.
`
```

#### 缺点（不应该照搬）

| 不应该照搬                        | 原因                                                             | 代码段示例                           |
| --------------------------------- | ---------------------------------------------------------------- | ------------------------------------ |
| **巨型单体 query loop**           | CC 的 >3000 行单文件维护成本高，OpenAGt 的 Effect 模块化架构更优 | `src/query-loop.ts` (3000+ lines)    |
| **108 个 feature-gated 内部模块** | 依赖内部基础设施，开源无法等价复现                               | `feature("telemetry")` (108 modules) |
| **Telemetry（遥测）**             | 1P + Datadog 双分析 Sink，隐私争议大，用户明确反对               | `telemetry.track()`                  |
| **Undercover Mode**               | 隐藏模式，适合 Anthropic 内部调试，不适合开源场景                | `process.env.UNDERCOVER`             |
| **Beta Headers 实验**             | GrowthBook A/B 测试基础设施，开源维护成本高                      | `getExperimentValue()`               |

### 11.3 Codex：应该吸收的部分

#### 11.3.1 多层 OS 沙箱

**Codex 的实现**：

| 平台    | 技术            | 描述                             |
| ------- | --------------- | -------------------------------- |
| macOS   | Seatbelt        | Mandatory Access Control profile |
| Linux   | Landlock        | Linux kernel LSM v6.2+ 支持      |
| Windows | RestrictedToken | Process token mitigation         |

**OpenAGt 现状**：无 OS 级沙箱，仅依赖权限规则和 subprocess 隔离。

**建议**：Phase 2 实现 Landlock 集成（Linux 优先），通过 `syscall.Seccomp` 限制可用系统调用。

#### 11.3.2 Network 分级控制

**Codex 的实现**：

```typescript
// sandboxTypes.ts 网络配置
interface NetworkConfig {
  allowedDomains: string[] // 白名单域名
  deniedDomains: string[] // 黑名单域名
  allowUnixSockets: boolean // Unix socket
  allowLocalBinding: boolean // 本地端口绑定
}
```

**OpenAGt 现状**：`webfetch` 和 `websearch` 工具无域名级控制。

**建议**：实现 `network-config.yaml` 配置文件，支持 `allowedDomains`/`deniedDomains` 白名单模式。

#### 11.3.3 两阶段记忆系统

**Codex 的实现**：

| 阶段    | 模型                   | 功能                             |
| ------- | ---------------------- | -------------------------------- |
| Phase 1 | gpt-5.4-mini（低推理） | 原始抽取，高信号优先，支持 no-op |
| Phase 2 | gpt-5.4（中推理）      | 跨 rollout 全局 consolidation    |

**Token 限制**：`memory_summary.md` 最多 5k tokens，证据链格式。

**OpenAGt 现状**：Full compact 使用单阶段摘要，无 consolidation 阶段。

**建议**：评估两阶段是否适合开源形态。短期可实现 Phase1 抽取管道，长期评估 Phase2 consolidation。

#### 11.3.4 Remote Compaction

**Codex 的实现**（`compact.rs`）：

```rust
// 按 provider 能力决定是否走远程压缩
pub fn should_use_remote_compact_task(provider: &Provider) -> bool {
    provider.supports_remote_compaction() &&
    session_length > MIN_REMOTE_COMPACTION_TOKENS
}
```

**OpenAGt 现状**：所有压缩在本地执行。

**建议**：中期评估。当 session 长度 >100k tokens 时，考虑将 Full compact offload 到专用压缩服务。

#### 11.3.5 Sandbox 配置模式

**CC/Codex 的实现**（`sandboxTypes.ts`）：

```typescript
interface SandboxRuntimeConfig {
  filesystem: {
    denyRead: string[]
    allowRead: string[]
    allowWrite: string[]
    denyWrite: string[]
  }
  ignoreViolations: IgnoreViolationsConfig
}
```

**OpenAGt 现状**：`permission/evaluate.ts` 支持通配符匹配，但缺少文件系统级作用域控制。

**建议**：引入 sandbox 配置格式，支持 `.git/` 写保护、`.env` 读保护等企业级场景。

### 11.4 Codex：不应该照搬的部分

#### 优点（应该吸收）

**11.4.1 多层 OS 沙箱**

**代码段：Codex 的跨平台沙箱实现**

```rust
// Codex 的 sandbox.rs - Landlock 实现
pub fn create_landlock_sandbox() -> Result<()> {
    let ruleset = LandlockRuleset::new()
        .create_handle()?;

    // 文件系统规则
    ruleset.add_rule(LandlockAccess::from_access(LandlockAccessFs::Read))?;
    ruleset.add_rule(LandlockAccess::from_access(LandlockAccessFs::Write))?;

    ruleset.restrict_self()?;
    Ok(())
}
```

**代码段：网络分级控制配置**

```typescript
// sandboxTypes.ts - Codex 实现
interface NetworkConfig {
  allowedDomains: string[] // 白名单域名
  deniedDomains: string[] // 黑名单域名
  allowUnixSockets: boolean // Unix socket
  allowLocalBinding: boolean // 本地端口绑定
}

// 网络访问分级
type NetworkLevel = "none" | "allowlist" | "all"
```

**11.4.2 两阶段记忆系统**

**代码段：Phase1/Phase2 分离架构**

```typescript
// memories/consolidation.ts - Codex 实现
interface MemoryPhase {
  phase1: {
    model: "gpt-5.4-mini" // 低推理成本
    maxTokens: 5000
    features: ["extraction", "no-op-gate"]
  }
  phase2: {
    model: "gpt-5.4" // 中推理成本
    consolidation: "cross-rollout"
    evidence: true
  }
}
```

**11.4.3 Remote Compaction**

**代码段：远程压缩决策逻辑**

```rust
// compact.rs - Codex 实现
pub fn should_use_remote_compact_task(provider: &Provider) -> bool {
    provider.supports_remote_compaction() &&
    session_length > MIN_REMOTE_COMPACTION_TOKENS
}

const MIN_REMOTE_COMPACTION_TOKENS: usize = 100_000;
```

#### 缺点（不应该照搬）

| 不应该照搬               | 原因                                                              | 代码段示例             |
| ------------------------ | ----------------------------------------------------------------- | ---------------------- |
| **Rust 重写底座**        | 成本远高于收益，TypeScript/Effect 生态更丰富                      | `compact.rs` (Rust)    |
| **极简压缩 Prompt**      | Codex 的 checkpoint handoff 仅数行，复杂 rollout 可能丢失关键信息 | `SUMMARIZATION_PROMPT` |
| **ChatGPT OAuth 强绑定** | OpenAI OAuth 对开源项目不友好，应保持 provider 中立               | `oauth.rs`             |
| **闭源 exec-server**     | 本地隔离执行可借鉴架构，但无需完全复刻                            | `exec-server/`         |

### 11.5 Hermes：应该吸收的部分

#### 11.5.1 Gateway 多渠道架构

**Hermes 的实现**：

```python
# 统一路由 + 认证 + 转换管道
class GatewayRouter:
    def route(self, request: Request) -> Response:
        # 多渠道鉴权
        auth = self.authenticate(request)
        # 渠道特定转换
        msg = self.transform_request(raw, channel)
        # Agent 处理
        result = self.agent.process(msg)
        # 响应格式化
        return self.transform_response(result, channel)
```

**OpenAGt 现状**：ACP 仅支持 stdio，`bus/global.ts` 有 GlobalBus 但无 HTTP/Webhook 通道。

**建议**：基于现有 GlobalBus 架构，增加 `webhook.ts` 和 `slack.ts` 适配器，实现事件驱动的多渠道接入。

#### 11.5.2 Skills Hub 完整生命周期

**Hermes 的实现**：

```python
class SkillsHub:
    def search(self, query: str) -> List[Skill]: ...
    def install(self, skill_id: str, version?: str) -> InstallResult: ...
    def update(self, skill_id: str) -> UpdateResult: ...
    def publish(self, skill: Skill) -> PublishResult: ...
    def validate(self, manifest: SkillManifest) -> ValidationResult: ...
```

**Skill 定义格式**：

```yaml
---
name: skill-name
version: 1.0.0
dependencies:
  - skill-other@^2.0.0
tests:
  - test_case_1.yaml
  - test_case_2.yaml
---
# Skill content
```

**OpenAGt 现状**：`skill/` 已有 Markdown + frontmatter 格式，但无版本管理、依赖、测试。

**建议**：扩展 `SkillManifest` Schema，增加 `version`、`dependencies`、`tests` 字段，实现 `bunx openagt skill install` 命令。

#### 11.5.3 Trajectory 记录与离线压缩

**Hermes 的实现**：

```python
# MapReduce 风格处理
class TrajectoryCompressor:
    def map_phase(self, trajectories):
        # 按会话/时间窗口分割
        chunks = self.split_by_session(trajectories)
        return chunks

    def reduce_phase(self, chunks):
        # 摘要/聚类
        summaries = [self.summarize(chunk) for chunk in chunks]
        clusters = self.cluster_similar(summaries)
        return self.merge_clusters(clusters)

    def generate_training_data(self, compressed):
        # 生成训练样本
        return [self.extract_examples(chunk) for chunk in compressed]
```

**OpenAGt 现状**：无轨迹记录系统。

**建议**：Phase 3 实现。在 `sync/` 事件溯源基础上，增加 `trajectory/` 模块，支持轨迹导出、回放、和离线压缩管道。

#### 11.5.4 SessionDB FTS5 全文检索

**Hermes 的实现**：

```python
def setup_fts(self):
    self.conn.execute('''
        CREATE VIRTUAL TABLE sessions_fts USING fts5(
            session_id, title, content, metadata,
            tokenize='porter unicode61'
        )
    ''')

def search(self, query: str, limit: int = 10):
    return self.conn.execute('''
        SELECT session_id, title,
               snippet(sessions_fts, 2, '<b>', '</b>', '...', 32)
        FROM sessions_fts
        WHERE sessions_fts MATCH ?
        ORDER BY rank LIMIT ?
    ''', (query, limit)).fetchall()
```

**OpenAGt 现状**：SQLite WAL 已实现，但无 FTS5 索引。

**建议**：在 `storage/` 中增加 FTS5 表，索引 session summary 和 message content，支持 `session search` 命令的语义检索。

#### 11.5.5 Scheduler/Cron 任务调度

**Hermes 的实现**：

```python
class SchedulerChannel:
    def parse_cron(self, expr: str) -> CronExpression:
        # 支持 */5, 1-5, *, 0 等表达式
        parts = expr.split()
        return CronExpression(
            minute=parse_field(parts[0], 0, 59),
            hour=parse_field(parts[1], 0, 23),
            # ...
        )
```

**OpenAGt 现状**：无调度系统。

**建议**：在 `packages/openagt/src/` 中增加 `scheduler/` 模块，解析 cron 表达式，持久化调度任务到 SQLite，支持 `bunx openagt schedule` 命令。

### 11.6 Hermes：不应该照搬的部分

#### 优点（应该吸收）

**11.6.1 Gateway 多渠道架构**

**代码段：统一路由 + 认证 + 转换管道**

```python
# Hermes 的 gateway/router.py
class GatewayRouter:
    def route(self, request: Request) -> Response:
        # 多渠道鉴权
        auth = self.authenticate(request)

        # 渠道特定转换
        msg = self.transform_request(raw, channel)

        # Agent 处理
        result = self.agent.process(msg)

        # 响应格式化
        return self.transform_response(result, channel)
```

**代码段：多渠道支持**

```python
# Hermes 的 gateway/channels.py
class GatewayRouter:
    def route(self, request: Request) -> Response:
        # 多渠道鉴权
        auth = self.authenticate(request)
        # 渠道特定转换
        msg = self.transform_request(raw, channel)
        # Agent 处理
        result = self.agent.process(msg)
        # 响应格式化
        return self.transform_response(result, channel)

# 支持的渠道
CHANNELS = {
    'cli': CLIChannel,
    'slack': SlackChannel,
    'discord': DiscordChannel,
    'webhook': WebhookChannel,
    'scheduler': SchedulerChannel,
}
```

**11.6.2 Skills Hub 完整生命周期**

**代码段：技能市场 API**

```python
# Hermes 的 skills/hub.py
class SkillsHub:
    def search(self, query: str) -> List[Skill]:
        """搜索技能"""
        return self.db.query(Skill).filter(
            Skill.name.like(f'%{query}%')
        ).all()

    def install(self, skill_id: str, version: Optional[str] = None) -> InstallResult:
        """安装技能"""
        skill = self.registry.get(skill_id, version)
        return self.loader.load(skill)

    def update(self, skill_id: str) -> UpdateResult:
        """更新技能"""
        ...

    def publish(self, skill: Skill) -> PublishResult:
        """发布技能"""
        ...

    def validate(self, manifest: SkillManifest) -> ValidationResult:
        """验证技能清单"""
        ...
```

**代码段：Skill 定义格式**

```yaml
# Hermes 的 skill 格式
---
name: skill-name
version: 1.0.0
dependencies:
  - skill-other@^2.0.0
tests:
  - test_case_1.yaml
  - test_case_2.yaml
---
# Skill content
```

**11.6.3 Trajectory 记录与离线压缩**

**代码段：MapReduce 风格处理**

```python
# Hermes 的 trajectory/compressor.py
class TrajectoryCompressor:
    def map_phase(self, trajectories):
        # 按会话/时间窗口分割
        chunks = self.split_by_session(trajectories)
        return chunks

    def reduce_phase(self, chunks):
        # 摘要/聚类
        summaries = [self.summarize(chunk) for chunk in chunks]
        clusters = self.cluster_similar(summaries)
        return self.merge_clusters(clusters)

    def generate_training_data(self, compressed):
        # 生成训练样本
        return [self.extract_examples(chunk) for chunk in compressed]
```

**11.6.4 SessionDB FTS5 全文检索**

**代码段：FTS5 虚拟表**

```python
# Hermes 的 storage/sessiondb.py
def setup_fts(self):
    self.conn.execute('''
        CREATE VIRTUAL TABLE sessions_fts USING fts5(
            session_id, title, content, metadata,
            tokenize='porter unicode61'
        )
    ''')

def search(self, query: str, limit: int = 10):
    return self.conn.execute('''
        SELECT session_id, title,
               snippet(sessions_fts, 2, '<b>', '</b>', '...', 32)
        FROM sessions_fts
        WHERE sessions_fts MATCH ?
        ORDER BY rank LIMIT ?
    ''', (query, limit)).fetchall()
```

**11.6.5 Scheduler/Cron 任务调度**

**代码段：Cron 表达式解析**

```python
# Hermes 的 scheduler/cron.py
class SchedulerChannel:
    def parse_cron(self, expr: str) -> CronExpression:
        # 支持 */5, 1-5, *, 0 等表达式
        parts = expr.split()
        return CronExpression(
            minute=parse_field(parts[0], 0, 59),
            hour=parse_field(parts[1], 0, 23),
            day=parse_field(parts[2], 1, 31),
            month=parse_field(parts[3], 1, 12),
            weekday=parse_field(parts[4], 0, 6),
        )

    def schedule(self, job: Job, cron_expr: str):
        """调度任务"""
        expr = self.parse_cron(cron_expr)
        self.executor.add(expr, job)
```

#### 缺点（不应该照搬）

| 不应该照搬                 | 原因                                                | 代码段示例                  |
| -------------------------- | --------------------------------------------------- | --------------------------- |
| **Python 运行时迁移**      | 成本远高于收益，Bun/TypeScript 启动更快、生态更广   | `runtime/` (Python asyncio) |
| **"自学习叙事"优先级过高** | 应先稳固工程基础，再谈自学习                        | `trajectory/ml.py`          |
| **Monolithic 架构**        | Hermes Gateway 是单体，OpenAGt 应保持 Effect 模块化 | `gateway/main.py`           |
| **重度 ML 集成**           | trajectory 用于训练数据生成，开源项目维护成本高     | `training/*.py`             |

### 11.7 OpenAGt 应新增的技术债识别

以下是从 CC/Codex/Hermes 对比中新发现的技术债：

| 新识别债项                         | 来源   | 优先级 | 建议                                  |
| ---------------------------------- | ------ | ------ | ------------------------------------- |
| **PowerShell cmdlet 安全检测缺失** | CC     | P2     | 补充 `dangerousCmdlets.ts`            |
| **Session Memory 固定章节模板**    | CC     | P2     | 实现 `session/memory.ts`              |
| **静态/动态 Prompt 边界**          | CC     | P2     | 引入 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` |
| **SQLite FTS5 全文检索**           | Hermes | P3     | 索引 session/message                  |
| **Scheduler/Cron 模块**            | Hermes | P3     | 新增 `scheduler/`                     |
| **多渠道 Gateway**                 | Hermes | P3     | webhook/slack 适配器                  |
| **Landlock OS 沙箱**               | Codex  | P3     | Linux 优先实现                        |
| **Network 分级控制**               | Codex  | P3     | 域名白名单配置                        |

---

## 第十二章：OpenAGt 差异化优势与技术债

### 12.1 核心差异化优势

#### 12.1.1 多 Provider 抽象（唯一开源方案）

OpenAGt 是**唯一一个**同时支持 15+ AI provider 的开源 agent 框架：

```typescript
// ProviderID branding（packages/openagt/src/provider/schema.ts）
export const ProviderID = providerIdSchema.pipe(
  withStatics((schema) => ({
    zod: z.string().pipe(z.custom<ProviderID>()),
    opencode: schema.make("opencode"),
    anthropic: schema.make("anthropic"),
    openai: schema.make("openai"),
    google: schema.make("google"),
    googleVertex: schema.make("google-vertex"),
    githubCopilot: schema.make("github-copilot"),
    amazonBedrock: schema.make("amazon-bedrock"),
    azure: schema.make("azure"),
    openrouter: schema.make("openrouter"),
    mistral: schema.make("mistral"),
    gitlab: schema.make("gitlab"),
    cohere: schema.make("cohere"),
    groq: schema.make("groq"),
    perplexity: schema.make("perplexity"),
    togetherAI: schema.make("together-ai"),
    cloudflareWorkersAI: schema.make("cloudflare-workers-ai"),
    fireworksAI: schema.make("fireworks-ai"),
  })),
)
```

对比：

- Claude Code：仅 Anthropic
- Codex：仅 OpenAI
- Hermes：支持多个但非开源

#### 12.1.2 Effect 框架架构（现代函数式 DI）

OpenAGt 是**唯一一个**基于 Effect 框架构建的 agent runtime：

**`makeRuntime` 模式**（`src/effect/runtime.ts`）：

```typescript
export function makeRuntime<I, S, E>(service: Context.Service<I, S>, layer: Layer.Layer<I, E>) {
  let rt: ManagedRuntime.ManagedRuntime<I, E> | undefined
  // memoMap 确保整个 runtime 中每个 service 只实例化一次
  const getRuntime = () => (rt ??= ManagedRuntime.make(Layer.provideMerge(layer, Observability.layer), { memoMap }))
  return {
    runSync: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>) => getRuntime().runSync(service.use(fn)),
    runPromiseExit: <A, Err>(fn, options?) => getRuntime().runPromiseExit(service.use(fn), options),
    // ...
  }
}
```

**InstanceState ScopedCache**（`src/effect/instance-state.ts`）：

```typescript
export const make = <A, E = never, R = never>(init: (ctx: InstanceContext) => Effect.Effect<A, E, R | Scope.Scope>) =>
  Effect.gen(function* () {
    const cache = yield* ScopedCache.make<string, A, E, R>({
      capacity: Number.POSITIVE_INFINITY,
      lookup: () =>
        Effect.gen(function* () {
          return yield* init(yield* context)
        }),
    })
    // 自动按目录失效
    const off = registerDisposer((directory) =>
      Effect.runPromise(ScopedCache.invalidate(cache, directory).pipe(Effect.provide(EffectLogger.layer))),
    )
    yield* Effect.addFinalizer(() => Effect.sync(off))
    return { [TypeId]: TypeId, cache }
  })
```

**优势**：

1. 所有外部 I/O（文件系统、进程、HTTP）都封装在 Effect Service 中，**零 mock 单测**成为可能
2. `Layer.provideMerge` 支持声明式服务组合
3. `memoMap` 在 runtime 层面去重 service 实例化，性能优异

#### 12.1.3 三层压缩体系（Micro/Auto/Full）

OpenAGt 的压缩体系是四者中**最精细化**的：

| 层级      | 触发           | LLM | 覆盖场景                     |
| --------- | -------------- | --- | ---------------------------- |
| **Micro** | 时间 > 5min    | 否  | 快速折叠旧工具结果，零成本   |
| **Auto**  | Token 预算超限 | 否  | 优先级驱动的规则压缩，零成本 |
| **Full**  | context 溢出   | 是  | LLM 摘要，语义保真           |

**Circuit Breaker** 防止压缩死循环：

```typescript
export class CircuitBreaker {
  constructor(
    private threshold: number = 3,
    private cooldownMs: number = 30_000,
  ) {}
  isOpen(): boolean {
    return this.failures >= this.threshold
  }
  canAttempt(): boolean {
    if (this.failures === 0) return true
    return Date.now() - this.lastSuccess > this.cooldownMs
  }
}
```

**优先级算法**（`auto.ts`）：

```typescript
// Priority = log₂(age_minutes + 1) × importance_factor + content_bonus
const ageWeight = Math.log2(age / (60 * 1000) + 1)
const importanceFactor = Math.max(1, 11 - importance) // 10=最高优先级 → factor 1
const priority = ageWeight * importanceFactor + contentWeight * 0.5
```

#### 12.1.4 MCP 多传输协议支持

OpenAGt 是**唯一一个**同时支持 stdio、StreamableHTTP、SSE 三种 MCP 传输的开源方案：

```typescript
// packages/openagt/src/mcp/index.ts
const transports = [
  {
    name: "StreamableHTTP",
    transport: new StreamableHTTPClientTransport(new URL(mcp.url), { authProvider, ... }),
  },
  {
    name: "SSE",
    transport: new SSEClientTransport(new URL(mcp.url), { authProvider, ... }),
  },
]

// 自动按优先级尝试连接，auth error 时停止尝试其他传输
for (const { name, transport } of transports) {
  const result = yield* connectTransport(transport, connectTimeout).pipe(...)
  if (result) return { client: result.client, status: "connected" }
  if (lastStatus?.status === "needs_auth") break  // 不继续尝试其他传输
}
```

#### 12.1.5 权限系统（Wildcard + Deferred Blocking）

OpenAGt 的权限系统结合了 CC 的精细控制和 Hermes 的灵活性：

**Pattern 验证**（`permission/evaluate.ts`）：拒绝裸 `"*"` 模式和未锚定的 `"**"`：

```typescript
function validatePattern(pattern: string) {
  if (pattern === "*") return { valid: false, message: "Bare '*' pattern is too permissive." }
  if (pattern.includes("**") && !pattern.startsWith("**") && !pattern.endsWith("**"))
    return { valid: false, message: "Pattern '**' must be anchored." }
  return { valid: true }
}
```

**Deferred Blocking**：使用 `Deferred.make<void, RejectedError>()` 阻塞直到用户响应：

```typescript
const deferred = yield * Deferred.make<void, RejectedError | CorrectedError>()
pending.set(id, { info, deferred })
yield * bus.publish(Event.Asked, info)
return (
  yield *
  Effect.ensuring(
    Deferred.await(deferred),
    Effect.sync(() => {
      pending.delete(id)
    }),
  )
)
```

#### 12.1.6 事件溯源（SyncEvent + 聚合序列号）

OpenAGt 的事件溯源系统是四者中最**轻量且实用**的：

```typescript
// 聚合级别的 sequence number
Database.transaction(
  (tx) => {
    const row = tx
      .select({ seq: EventSequenceTable.seq })
      .from(EventSequenceTable)
      .where(eq(EventSequenceTable.aggregate_id, agg))
      .get()
    const seq = row?.seq != null ? row.seq + 1 : 0
    const event = { id, seq, aggregateID: agg, data }
    process(def, event, { publish })
  },
  { behavior: "immediate" },
) // IMMEDIATE 事务保证并发安全
```

**幂等回放**：

```typescript
export function replay(event: SerializedEvent, options?: { publish: boolean }) {
  const latest =
    Database.use((db) =>
      db
        .select({ seq: EventSequenceTable.seq })
        .from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, event.aggregateID))
        .get(),
    )?.seq ?? -1
  if (event.seq <= latest) return // 幂等
  if (event.seq !== latest + 1) throw new Error(`Sequence mismatch: expected ${latest + 1}, got ${event.seq}`)
  process(def, event, { publish: !!options?.publish })
}
```

#### 12.1.7 树-sitter 安全检测（23 种模式）

OpenAGt 的 `dangers.ts` 是四者中**最细粒度的命令安全检测**：

**8 类命令替换检测**：

```typescript
export const COMMAND_SUBSTITUTION_PATTERNS = [
  { pattern: /<\(/, message: "process substitution <()" },
  { pattern: /\$\(/, message: "$() command substitution" },
  { pattern: /\$\{/, message: "${} parameter substitution" },
  // Zsh-specific: ${(e)...}, ${(z)...}
]
```

**二进制劫持变量**：`LD_PRELOAD`、`LD_AUDIT`、`DYLD_INSERT_LIBRARIES`、`DYLD_LIBRARY_PATH`、`DYLD_FRAMEWORK_PATH` — 可通过库预加载注入恶意代码。

**23 个 bash security check IDs**（与 CC 对齐）：

```typescript
export const BASH_SECURITY_CHECK_IDS = {
  INCOMPLETE_COMMANDS: 1,
  DANGEROUS_PATTERNS_COMMAND_SUBSTITUTION: 8,
  IFS_INJECTION: 11,
  GIT_COMMIT_SUBSTITUTION: 12,
  PROC_ENVIRON_ACCESS: 13,
  MALFORMED_TOKEN_INJECTION: 14,
  BACKSLASH_ESCAPED_WHITESPACE: 15,
  BINARY_PATH_HIJACK: 16,
  INCOMPLETE_PIPE_CHAIN: 17,
  // ... through 23
}
```

#### 12.1.8 Plugin Hook 系统（Effect-aware）

OpenAGt 的插件钩子是**唯一一个**支持 Effect-aware 异步钩子的开源方案：

```typescript
const trigger = Effect.fn("Plugin.trigger")(function* <Name extends TriggerName>(
  name: Name,
  input: Input,
  output: Output,
) {
  const s = yield* InstanceState.get(state)
  for (const hook of s.hooks) {
    const fn = hook[name] as any
    if (!fn) continue
    // 所有钩子并发执行，失败不影响主流程
    yield* Effect.promise(async () => fn(input, output))
  }
  return output
})
```

所有 Bus 事件也会 forward 到插件：

```typescript
yield *
  bus.subscribeAll().pipe(
    Stream.runForEach((input) =>
      Effect.sync(() => {
        for (const hook of hooks) void hook["event"]?.({ event: input })
      }),
    ),
    Effect.forkScoped,
  )
```

#### 12.1.9 事件总线架构（GlobalBus + SSE）

OpenAGt 的跨进程事件传播是四者中**最轻量的**：

```typescript
// packages/openagt/src/bus/global.ts
export const GlobalBus = new EventEmitter<{ event: [GlobalEvent] }>()

// 事件格式
export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: any
}
```

任何进程 publish 到 GlobalBus，其他进程通过 SSE 接收。Flutter 客户端通过 SSE 订阅所有 session/message 事件，无需复制 runtime。

#### 12.1.10 MDM 企业配置支持

OpenAGt 是**唯一一个**支持 MDM（Mobile Device Management）企业部署的 agent 框架：

```typescript
// packages/openagt/src/config/managed.ts
const MANAGED_PLIST_DOMAIN = "ai.openagt.managed"

function systemManagedConfigDir(): string {
  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/openagt"
    case "win32":
      return path.join(process.env.ProgramData || "C:\\ProgramData", "openagt")
    default:
      return "/etc/openagt"
  }
}
```

macOS 通过 `.plist` 文件、Windows 通过 `admx/adml` 模板实现策略下发。

#### 12.1.11 SQLite WAL + Drizzle ORM

OpenAGt 的数据库层是四者中**类型最安全**的：

- 使用 Drizzle ORM 而非原始 SQL，类型安全的 schema 定义
- WAL 模式保证高并发读写
- `Immediate` 事务保证并发安全
- 支持 `schema.sql.ts` 文件导出

```typescript
// packages/openagt/src/storage/db.bun.ts
export function init(path: string) {
  const sqlite = new Database(path, { create: true })
  const db = drizzle({ client: sqlite })
  return db
}
```

#### 12.1.12 Flutter 原生客户端

OpenAGt 是**唯一一个**拥有 Flutter 原生移动客户端的方案：

- 通过 SSE 订阅所有 session/message 事件
- 无需在移动端复制 agent runtime
- 全 REST API 覆盖：session CRUD、config、providers、agents、permissions、VCS diff

```dart
// packages/openagt_flutter/lib/src/core/sse/sse_client.dart
Stream<SSEEvent> connect({String? sessionId, Map<String, String>? headers}) {
  final url = sessionId != null ? '/event?session=$sessionId' : '/event'
  await _dio.get(url, options: Options(
    responseType: ResponseType.stream,
    headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
  ))
}
```

### 12.2 当前关键技术债

| 债项                             | 严重程度 | 来源        | 修复建议                                                             |
| -------------------------------- | -------- | ----------- | -------------------------------------------------------------------- |
| **typecheck 未全绿**（~10 处）   | P0       | 内部        | 收口 `fallback.ts` vs `fallback-service.ts` 接口、MessageV2 类型收窄 |
| **session/prompt.ts 职责过重**   | P0       | 内部        | 拆分为 scheduler、injection-guard、provider-orch 等独立模块          |
| **CLI 端到端 smoke 缺失**        | P1       | 内部        | 补充 `bun test` 的 CLI smoke 测试                                    |
| **危险命令检测未实现**           | P1       | CC 对比     | 实现 `security/dangerous-command-detector.ts`，对齐 23 种安全检查    |
| **PowerShell cmdlet 安全检测**   | P1       | CC 对比     | 补充 `dangerousCmdlets.ts`，对齐 CC 的 `DANGEROUS_CMDS`              |
| **Session Memory 缺失**          | P1       | CC 对比     | 实现固定章节会话笔记模板（九段式标题/状态/工作流）                   |
| **Flutter 未与 server 稳定耦合** | P2       | 内部        | 等 API 契约冻结后再推进                                              |
| **静态/动态 Prompt 边界**        | P2       | CC 对比     | 引入 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`，支持 provider cache 优化      |
| **PowerShell AST 分析**          | P2       | CC 对比     | 实现 PowerShell 解析器，检测恶意 cmdlet                              |
| **SQLite FTS5 全文检索**         | P3       | Hermes 对比 | 索引 session/message content，支持语义搜索                           |
| **Scheduler/Cron 模块**          | P3       | Hermes 对比 | 新增 `scheduler/`，支持 cron 表达式和定时任务                        |
| **多渠道 Gateway**               | P3       | Hermes 对比 | webhook/slack 适配器，基于现有 GlobalBus                             |
| **Landlock OS 沙箱**             | P3       | Codex 对比  | Linux 优先，限制系统调用                                             |
| **Network 分级控制**             | P3       | Codex 对比  | 域名白名单配置，支持 `webfetch`/`websearch`                          |
| **Trajectory 记录**              | P3       | Hermes 对比 | 基于现有 SyncEvent，增加轨迹导出/回放                                |

### 12.3 优先级路线图

#### Phase 0：类型安全筑基（当前紧急）

| 任务                   | 优先级 | 预期结果                              |
| ---------------------- | ------ | ------------------------------------- |
| 收口 typecheck         | P0     | `bun typecheck` 全绿                  |
| 拆分 session/prompt.ts | P0     | scheduler/injection/provider 边界清晰 |

#### Phase 1：质量筑基（1-3 个月）

| 任务                | 优先级 | 预期结果                                      |
| ------------------- | ------ | --------------------------------------------- |
| CLI smoke 测试      | P1     | `bun test` 端到端验证                         |
| 危险命令检测        | P1     | `security/dangerous-command-detector.ts` 上线 |
| PowerShell 安全检测 | P1     | `dangerousCmdlets.ts` 对齐 CC                 |
| Session Memory      | P1     | 九段式会话笔记 + 触发阈值                     |

#### Phase 2：能力扩展（3-6 个月）

| 任务                       | 优先级 | 预期结果                                    |
| -------------------------- | ------ | ------------------------------------------- |
| 静态/动态 Prompt 边界      | P2     | `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` cache 优化 |
| PowerShell AST             | P2     | PS 解析器替代 regex 检测                    |
| 进程沙箱                   | P2     | subprocess 级别资源限制                     |
| MCP 工具质量               | P2     | 工具映射完善度提升                          |
| Provider Fallback 可观测性 | P2     | fallback hop 指标暴露                       |

#### Phase 3：长期能力（6-12 个月）

| 任务                  | 优先级 | 预期结果                       |
| --------------------- | ------ | ------------------------------ |
| SQLite FTS5           | P3     | 全文检索 `session search` 命令 |
| Scheduler/Cron        | P3     | 定时任务调度                   |
| Multi-Channel Gateway | P3     | Webhook/Slack 渠道             |
| Landlock 沙箱         | P3     | Linux OS 级隔离                |
| Network 分级控制      | P3     | 域名白名单                     |
| Trajectory 记录       | P3     | 离线压缩管道                   |
| 多 Agent Coordinator  | P3     | 复杂任务并行处理               |
| Flutter 客户端        | P2     | 原生移动端控制面板             |

---

## 附录：参考材料索引

### OpenAGt 源码

| 文件                                                          | 用途                                       |
| ------------------------------------------------------------- | ------------------------------------------ |
| `packages/openagt/src/session/prompt.ts`                      | 主循环、Prompt 装配                        |
| `packages/openagt/src/session/compaction.ts`                  | 三层压缩编排                               |
| `packages/openagt/src/session/compaction/micro.ts`            | MicroCompact 实现                          |
| `packages/openagt/src/session/compaction/auto.ts`             | AutoCompact 实现                           |
| `packages/openagt/src/session/compaction/full.ts`             | FullCompact 实现                           |
| `packages/openagt/src/session/compaction/coordinator.ts`      | CompactionCoordinator 决策逻辑             |
| `packages/openagt/src/session/message-v2.ts`                  | MessageV2 类型系统（14 种 Part 类型）      |
| `packages/openagt/src/session/message.ts`                     | Message 类型                               |
| `packages/openagt/src/provider/fallback-service.ts`           | Provider Fallback 状态机                   |
| `packages/openagt/src/provider/schema.ts`                     | 模型 Schema + ProviderID branding          |
| `packages/openagt/src/config/provider.ts`                     | Provider 配置                              |
| `packages/openagt/src/config/agent.ts`                        | Agent 配置（frontmatter markdown）         |
| `packages/openagt/src/config/managed.ts`                      | MDM 企业配置（macOS plist / Windows admx） |
| `packages/openagt/src/tool/partition.ts`                      | 工具并发分区（Safe/Unsafe）                |
| `packages/openagt/src/tool/path-overlap.ts`                   | 路径冲突检测                               |
| `packages/openagt/src/tool/dispatcher.ts`                     | 工具调度器（并发控制）                     |
| `packages/openagt/src/security/injection.ts`                  | 注入防护                                   |
| `packages/openagt/src/security/dangers.ts`                    | 23 种命令安全检查模式                      |
| `packages/openagt/src/security/dangerous-command-detector.ts` | 危险命令检测（规划）                       |
| `packages/openagt/src/permission/evaluate.ts`                 | 权限 Scope 评估（Wildcard 匹配）           |
| `packages/openagt/src/permission/index.ts`                    | 权限系统入口                               |
| `packages/openagt/src/acp/`                                   | ACP 协议实现（session 管理）               |
| `packages/openagt/src/mcp/`                                   | MCP 集成（多传输 + OAuth）                 |
| `packages/openagt/src/plugin/`                                | 插件系统（Hook 钩子）                      |
| `packages/openagt/src/skill/`                                 | Skills 工作流                              |
| `packages/openagt/src/bus/`                                   | 事件总线（PubSub + GlobalBus）             |
| `packages/openagt/src/sync/`                                  | 事件溯源（SyncEvent）                      |
| `packages/openagt/src/v2/session-event.ts`                    | 事件模型                                   |
| `packages/openagt/src/v2/`                                    | V2 API 层（session、message、part CRUD）   |
| `packages/openagt/src/effect/runtime.ts`                      | Effect runtime 封装（memoMap）             |
| `packages/openagt/src/effect/instance-state.ts`               | InstanceState ScopedCache                  |
| `packages/openagt/src/storage/db.bun.ts`                      | SQLite 初始化（Drizzle ORM）               |
| `packages/openagt/src/storage/schema.ts`                      | 数据库 Schema 导出                         |

### Claude Code Reference

| 文件                                                                        | 用途                           |
| --------------------------------------------------------------------------- | ------------------------------ |
| `Code Reference/CC Source Code/src/`                                        | CC v2.1.88 源码（1884 文件）   |
| `Code Reference/CC Source Code/src/constants/prompts.ts`                    | SYSTEM_PROMPT_DYNAMIC_BOUNDARY |
| `Code Reference/CC Source Code/src/services/compact/prompt.ts`              | NO_TOOLS_PREAMBLE + 九段式摘要 |
| `Code Reference/CC Source Code/src/services/compact/microCompact.ts`        | Micro compact 逻辑             |
| `Code Reference/CC Source Code/src/services/SessionMemory/sessionMemory.ts` | Session memory 后台提取        |
| `Code Reference/CC Source Code/src/services/SessionMemory/prompts.ts`       | 九段式 Session Memory 模板     |
| `Code Reference/CC Source Code/src/memdir/memdir.ts`                        | MEMORY.md 管理                 |
| `Code Reference/CC Source Code/src/memdir/memoryTypes.js`                   | Memory 类型定义                |
| `Code Reference/CC Source Code/src/utils/permissions/dangerousPatterns.ts`  | 危险模式检测                   |
| `Code Reference/CC Source Code/src/utils/powershell/dangerousCmdlets.ts`    | PowerShell cmdlet 检测         |
| `Code Reference/CC Source Code/src/utils/sandbox/sandboxTypes.ts`           | 沙箱配置 Schema                |
| `Code Reference/CC Source Code/src/entrypoints/sandboxTypes.ts`             | SandboxRuntimeConfig 接口      |
| `Code Reference/CC Source Code/src/commands/`                               | Slash commands 实现            |
| `Code Reference/CC Source Code/src/hooks/`                                  | Hook 系统                      |
| `Code Reference/CC Source Code/src/services/api/caching.ts`                 | API 缓存策略                   |
| `Code Reference/CC Source Code/src/skills/loadSkillsDir.ts`                 | Skills 发现与加载              |
| `Code Reference/CC Source Code/docs/zh/06-*.md`                             | CC vs Agent Studio 技术对比    |
| `Code Reference/CC Source Code/docs/en/01-*.md`                             | Telemetry 分析                 |
| `Code Reference/CC Source Code/docs/en/02-*.md`                             | Hidden Features 分析           |
| `Code Reference/CC Source Code/docs/en/05-*.md`                             | Future Roadmap                 |

### Codex & Hermes Reference

| 文件                                   | 用途                               |
| -------------------------------------- | ---------------------------------- |
| `packages/openagt/src/plugin/codex.ts` | Codex OAuth PKCE 实现              |
| `docs/PROMPT_MEMORY_COMPARISON.md`     | 三方 Prompt/Memory/Compaction 对比 |
| `docs/OPENAG_DEVELOPMENT_REPORT.md`    | Codex/Hermes 架构分析              |
| `docs/TECHNICAL_ANALYSIS_REPORT.md`    | 现有技术分析（2026-04-19）         |

---

_报告生成时间：2026-04-21_
_分析版本：OpenAGt v1.14.17, Claude Code v2.1.88_
