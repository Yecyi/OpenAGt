# OpenAG 技术深度分析报告

> 基于 OpenCode (opencode-ai)、Claude Code (CC Source Code)、Hermes Agent 三大代码库的对比分析，
> 探讨以 OpenCode 为基础构建 Claude Code 级别 Agent + Flutter 移动应用的技术可行性

---

## 目录

1. [项目概览](#1-项目概览)
2. [架构深度对比](#2-架构深度对比)
3. [关键技术细节对比](#3-关键技术细节对比)
4. [UI/UX 对比分析](#4-uiux-对比分析)
5. [核心算法对比](#5-核心算法对比)
6. [优劣势矩阵](#6-优劣势矩阵)
7. [取长补短策略](#7-取长补短策略)
8. [Claude Code 级 Agent 构建方案](#8-claude-code-级-agent-构建方案)
9. [Flutter Agent 应用技术可行性](#9-flutter-agent-应用技术可行性)
10. [安全架构与威胁建模](#10-安全架构与威胁建模)
11. [性能基准与量化分析](#11-性能基准与量化分析)
12. [错误处理与容错机制](#12-错误处理与容错机制)
13. [可观测性架构](#13-可观测性架构)
14. [成本分析与优化策略](#14-成本分析与优化策略)
15. [测试策略与质量保障](#15-测试策略与质量保障)
16. [API 版本与数据迁移](#16-api-版本与数据迁移)
17. [Flutter UX 深度设计](#17-flutter-ux-深度设计)
18. [离线与多设备同步](#18-离线与多设备同步)
19. [竞品格局与市场定位](#19-竞品格局与市场定位)
20. [开源社区与治理模型](#20-开源社区与治理模型)
21. [合规与数据隐私](#21-合规与数据隐私)
22. [架构决策记录 (ADR)](#22-架构决策记录-adr)
23. [灾难恢复与备份策略](#23-灾难恢复与备份策略)
24. [更新后的风险评估](#24-更新后的风险评估)
25. [功能规划与实现路线图](#25-功能规划与实现路线图)
26. [结论](#26-结论)

---

## 1. 项目概览

### 1.1 OpenCode (Base Platform)

| 属性 | 值 |
|------|-----|
| 语言 | TypeScript (Bun/Node) |
| 框架 | Effect v4 + Vercel AI SDK + SolidJS |
| 版本 | 1.14.17 |
| 代码量 | ~50+ 源文件核心模块 |
| 运行时 | Bun (优先) / Node.js (回退) |
| 协议 | MIT |

**核心架构特点：** Client/Server 分离架构 (Hono HTTP + SSE/WebSocket)，Effect 函数式编程，InstanceState 按项目目录隔离，25+ AI Provider SDK 支持，Tauri/Electron 桌面端。

### 1.2 Claude Code (Reference - CC Source Code)

| 属性 | 值 |
|------|-----|
| 语言 | TypeScript (Bun) |
| 框架 | 自研 Ink (React-for-Terminal) |
| 版本 | 2.1.88 |
| 代码量 | ~1,884 源文件 / ~512,664 行 |
| 运行时 | Bun compile-time intrinsics |
| 协议 | 商业闭源 (反编译) |

**核心架构特点：** 单文件巨型 query loop (785KB)，自研 React Terminal 渲染器，三层渐进式压缩，Agent Teams 多智能体系统，12 级渐进式 harness，Feature Flag 死代码消除。

### 1.3 Hermes Agent (Reference)

| 属性 | 值 |
|------|-----|
| 语言 | Python 3.11+ |
| 框架 | 自研 (无外部框架) + Ink TUI |
| 版本 | 0.10.0 |
| 代码量 | ~50,000+ 行 Python |
| 运行时 | CPython |
| 协议 | 开源 |

**核心架构特点：** 同步 agent loop，16+ 消息平台网关，自动注册工具发现，可插拔上下文引擎，RL 训练集成 (Atropos)，技能自动学习系统。

---

## 2. 架构深度对比

### 2.1 Agent Loop 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Loop 对比                                │
├─────────────┬───────────────────┬───────────────────────────────┤
│ 维度         │ OpenCode          │ Claude Code                   │
├─────────────┼───────────────────┼───────────────────────────────┤
│ 核心模式     │ while(true) +     │ while(true) +                 │
│             │ Effect Stream     │ AsyncGenerator                │
│             │                   │                               │
│ 流式处理     │ Effect Stream +   │ React Ink 组件树               │
│             │ SSE/WS 双通道      │ + 全链路 AsyncGenerator        │
│             │                   │                               │
│ 工具并发     │ AI SDK 管控       │ 分区批处理                     │
│             │                   │ (safe/unsafe 分组)             │
│             │                   │                               │
│ 上下文管理   │ 单层压缩          │ 三层渐进压缩                   │
│             │ (compaction       │ (micro → auto → full)         │
│             │  agent)           │                               │
│             │                   │                               │
│ 子代理       │ Task tool         │ AgentTool + fork +            │
│             │ (单层委托)         │ worktree + remote +           │
│             │                   │ teams + coordinator            │
│             │                   │                               │
│ 权限系统     │ ask() 模式        │ 多层权限流水线                 │
│             │ (单次交互)         │ (hooks + rules +              │
│             │                   │ classifier + interactive)      │
└─────────────┴───────────────────┴───────────────────────────────┘
```

#### OpenCode Agent Loop (`src/session/prompt.ts`)

```typescript
// 简化流程
while (true) {
  const messages = await MessageV2.filterCompactedEffect(sessionID)
  // 1. 检查退出条件 (finish reason != "tool-calls")
  // 2. 处理特殊任务 (Subtask, Compaction)
  // 3. 检查上下文溢出 → 自动压缩
  // 4. 创建新 Assistant message
  // 5. Processor 处理 LLM 流
  //    - resolveTools() 收集 builtin + MCP 工具
  //    - llm.stream() → Effect Stream<Event>
  //    - handleEvent() 处理每个流事件
  // 6. 返回 "compact" | "stop" | "continue"
}
```

**优势：** Effect 框架提供类型安全的副作用管理、自动资源清理、结构化并发。
**劣势：** Effect 陡峭的学习曲线；单层压缩在长对话中可能不够精细。

#### Claude Code Agent Loop (`src/query.ts` - 785KB)

```typescript
// 简化流程
while (true) {
  await processUserInput()           // 解析 /commands
  await fetchSystemPromptParts()     // 组装系统提示
  await recordTranscript()           // JSONL 持久化 (阻塞写入)
  normalizeMessagesForAPI()          // 消息规范化
  const stream = api.stream()       // Claude API 流式调用
  for await (const event of stream) {
    if (event.type === 'tool_use') {
      // StreamingToolExecutor 并发处理
      // 分区: safe 工具并行, unsafe 串行
      // Bash 错误级联终止兄弟进程
    }
  }
  if (stopReason !== 'tool_use') break
}
```

**优势：** 极度成熟的 12 级渐进 harness，三层压缩策略，Agent Teams 协作。
**劣势：** 闭源且仅支持 Anthropic 模型，单文件巨大难以维护。

#### Hermes Agent Loop (`run_agent.py`)

```python
# 简化流程
while api_call_count < max_iterations:
    response = client.chat.completions.create(model, messages, tools)
    if response.tool_calls:
        # ThreadPoolExecutor 并行执行安全工具
        # _NEVER_PARALLEL_TOOLS 排除危险工具
        # 路径重叠检测防止文件冲突
        results = execute_tools_parallel(tool_calls)
        messages.extend(tool_results(results))
    else:
        return response.content
```

**优势：** 简单直观的同步模型，可插拔上下文引擎，迭代式压缩保留历史信息。
**劣势：** 同步模型在高并发场景受限，Python 性能不如 TypeScript。

### 2.2 Client/Server 架构

| 维度 | OpenCode | Claude Code | Hermes |
|------|----------|-------------|--------|
| 架构模式 | HTTP Server + SSE/WS | 单体 CLI | Gateway (多平台) |
| 服务端框架 | Hono (Bun/Node) | N/A | 自研 async |
| 实时通信 | SSE + WebSocket | 直接 stdio | JSON-RPC over stdio |
| 多实例支持 | InstanceState 隔离 | 单实例 | Profile 隔离 |
| 跨进程同步 | SQLite WAL SyncEvent | JSONL 文件 | 内存状态 |
| 远程访问 | mDNS + HTTP API | Bridge (Claude Desktop) | 16 平台 Gateway |

**OpenCode 的 Client/Server 是其最大架构优势。** 这使得 TUI、Web App、Desktop App、甚至移动端都可以作为独立的 client 连接到同一个 agent server。

---

## 3. 关键技术细节对比

### 3.1 工具系统

```
┌──────────────────────────────────────────────────────────────────────┐
│ 工具系统对比                                                          │
├──────────────┬──────────────────┬──────────────────┬─────────────────┤
│ 维度          │ OpenCode          │ Claude Code       │ Hermes          │
├──────────────┼──────────────────┼──────────────────┼─────────────────┤
│ 注册方式      │ define() +        │ buildTool()       │ @registry       │
│              │ Registry 服务     │ 工厂模式           │ .register()     │
│              │                   │                   │ 自动发现        │
│              │                   │                   │                 │
│ 工具数量      │ ~17 内置          │ ~40+ 内置         │ ~62+ 工具       │
│              │ + MCP + 自定义    │ + MCP + 内部      │ + MCP +         │
│              │                   │                   │ 平台特定        │
│              │                   │                   │                 │
│ 参数验证      │ Zod schema        │ Zod schema        │ JSON Schema     │
│              │                   │ + validateInput() │ + coerce_args() │
│              │                   │                   │                 │
│ 并发控制      │ AI SDK 管理       │ 分区批处理         │ ThreadPool      │
│              │                   │ safe/unsafe 分组   │ + 路径重叠检测   │
│              │                   │                   │                 │
│ 权限检查      │ Context.ask()     │ 多层权限流水线     │ approval 系统   │
│              │                   │ hooks+rules+      │ + 平台按钮      │
│              │                   │ classifier+prompt │                 │
│              │                   │                   │                 │
│ 结果处理      │ Truncate.Service  │ 磁盘溢出 + 预览   │ max_result_size │
│              │ 截断              │ (>PREVIEW_SIZE    │ per-tool 限制   │
│              │                   │ 持久化到文件)      │                 │
│              │                   │                   │                 │
│ MCP 集成      │ @modelcontext-    │ MCPConnection     │ MCP 工具 +      │
│              │ protocol/sdk      │ Manager           │ OAuth 2.1 PKCE  │
│              │                   │ (stdio/SSE/HTTP/  │ + OSV 恶意扫描  │
│              │                   │ WS/SDK)           │                 │
└──────────────┴──────────────────┴──────────────────┴─────────────────┘
```

**Claude Code 的工具系统优势：**
- `StreamingToolExecutor` 的分区批处理算法确保读写安全
- Bash 错误级联终止 (siblingAbortController) 防止孤儿进程
- ToolSearchTool 按需加载延迟工具 (节省上下文)
- PreToolUse/PostToolUse hooks 支持用户自定义 shell 命令

**Hermes 的工具系统优势：**
- AST 分析自动发现工具文件 (无需手动导入列表)
- 路径重叠检测防止并发文件操作冲突
- 线程安全的注册表快照 (并发读取不受 MCP 刷新影响)
- 工具遮蔽保护 (防止不同来源的工具名冲突)

**OpenCode 的工具系统优势：**
- Effect 框架提供编译时类型安全
- Plugin hooks (`tool.execute.before/after`) 允许运行时扩展
- ACP 协议标准化工具通信

### 3.2 Provider / 模型抽象层

| 维度 | OpenCode | Claude Code | Hermes |
|------|----------|-------------|--------|
| Provider 数量 | 25+ SDK | 4 (Anthropic/Bedrock/Vertex/Foundry) | 15+ |
| 模型发现 | models.dev API | 硬编码 | config.yaml |
| 抽象方式 | Vercel AI SDK | 自研 API 客户端 | OpenAI 兼容层 |
| 缓存策略 | Anthropic cacheControl | 4 级 cache breakpoints | system_and_3 策略 |
| 流式支持 | Effect Stream | AsyncGenerator | 同步 + 流式混合 |
| 降级/回退 | SessionRetry policy | 有限 | Provider fallback chain |

**OpenCode 优势：** 通过 Vercel AI SDK 统一 25+ Provider，transform 层处理各 Provider 差异 (消息格式、缓存、推理模式)，最广泛的模型支持。

**Claude Code 优势：** 针对 Anthropic API 极致优化，prompt cache 共享策略精细 (工具按字母排序保持前缀稳定)，CacheSafeParams 确保子代理复用父级缓存。

**Hermes 优势：** 4 种 API 模式自动检测 (chat_completions/codex_responses/anthropic_messages/bedrock_converse)，fallback chain 在限流时自动切换 Provider。

### 3.3 会话持久化

| 维度 | OpenCode | Claude Code | Hermes |
|------|----------|-------------|--------|
| 存储引擎 | SQLite (Drizzle ORM) | JSONL 文件 | SQLite + JSON |
| 写入策略 | SyncEvent WAL | 阻塞写入 (用户消息) | 直接写入 |
| 事件系统 | SyncEvent (持久) + BusEvent (内存) | 无 (直接 JSONL) | 内存 |
| 跨进程 | SQLite WAL 同步 | 文件系统 | Profile 隔离 |
| 消息类型 | 部分 (Part) 类型化 | Message 链表 | 字典列表 |
| ID 生成 | ULID (降序/升序) | UUID + parentUuid | 自增 |

**OpenCode 优势：** SQLite + WAL 提供真正的跨进程同步，Part 级别细粒度更新支持实时流式推送，双向事件总线 (SyncEvent + BusEvent) 同时满足持久化和实时性。

**Claude Code 优势：** JSONL 格式极简可靠，parentUuid 链表支持完整的消息历史重建，崩溃恢复通过阻塞写入保证。

---

## 4. UI/UX 对比分析

### 4.1 TUI 框架

| 维度 | OpenCode | Claude Code | Hermes |
|------|----------|-------------|--------|
| 框架 | @opentui/core + SolidJS | 自研 Ink (React reconciler) | Ink (React) + Python backend |
| 渲染引擎 | SolidJS 响应式 | Yoga Flexbox + 自定义 reconciler | Yoga + JSON-RPC |
| 布局系统 | CSS-like (opentui) | Flexbox (Yoga native) | Flexbox (Yoga) |
| 通信方式 | HTTP/WS → Server | 直接进程内 | stdio JSON-RPC |
| 组件数量 | ~30+ 组件 | 40+ 组件组 | 中等 |
| 状态管理 | SolidJS stores | AppStateStore (immutable) | React state |

**Claude Code TUI 深度分析：**
- **自研 React reconciler** (`src/ink/reconciler.ts`): 完全自定义的 React 渲染器，目标终端输出
- **Yoga 布局** (`layout/yoga.ts`): 通过 native bindings 实现 Flexbox 布局引擎
- **双缓冲屏幕** (`screen.ts`): cell 级 diffing，最小化终端重绘
- **终端 I/O** (`termio/`): CSI/DEC/OSC 转义序列处理，键盘解析
- **文本选择** (`selection.ts`): 鼠标文本选择 + 复制支持
- **搜索高亮** (`searchHighlight.ts`): 终端内搜索 + 匹配叠加

**OpenCode TUI 分析：**
- 基于 `@opentui/solid` (SolidJS 终端 UI 框架)
- 与 Server 分离，通过 HTTP/WS 连接
- 组件化程度高，易于扩展
- 依赖 solid-primitives 生态

**Hermes TUI 分析：**
- TypeScript (Ink) 渲染层 + Python (agent) 后端
- JSON-RPC over stdio 通信
- **TypeScript owns the screen; Python owns sessions, tools, model calls**
- 皮肤引擎 (4 内置皮肤 + 用户自定义 YAML)

### 4.2 Web/Desktop 应用

| 维度 | OpenCode | Claude Code | Hermes |
|------|----------|-------------|--------|
| Web App | SolidJS + Vite | N/A | Next.js (website) |
| Desktop (Tauri) | ✅ 包管理 | Claude Desktop (Electron) | N/A |
| Desktop (Electron) | ✅ 包管理 | N/A | N/A |
| 移动端 | 无 (但架构支持) | iOS/Android (remote bridge) | 16+ 消息平台 |
| SDK | @opencode-ai/sdk (JS) | @anthropic-ai/claude-code SDK | N/A |

**OpenCode 的多端策略是亮点：** 同一套 HTTP API + SSE/WS 事件系统服务于 TUI、Web App、Tauri Desktop、Electron Desktop。`@opencode-ai/sdk` 提供 JS/TS SDK。架构天然支持添加新的 client。

### 4.3 UX 关键差异

| UX 特性 | OpenCode | Claude Code | Hermes |
|---------|----------|-------------|--------|
| 权限请求 | 内联交互 | 多模式 (default/plan/auto/bypass) | 平台按钮 |
| 进度展示 | 简洁 spinner | 丰富 (KawaiiSpinner + 活动流) | 皮肤化 spinner |
| 会话管理 | 列表 + fork | --continue/--resume/--fork | 分支 + FTS5 搜索 |
| 斜杠命令 | yargs 命令 | 丰富 / 命令集 | 统一注册表 |
| 输入体验 | 基础输入 | 历史记录 + 粘贴 + 自动补全 | prompt_toolkit |
| Diff 展示 | 内联 | 统一 diff + 颜色 | 内联 |

---

## 5. 核心算法对比

### 5.1 上下文压缩

#### OpenCode: 单层压缩 (Compaction Agent)

```
溢出检测 → compaction agent 生成摘要 → 替换旧消息 → filterCompacted() 过滤
```

- **触发条件：** `isOverflow()` 检查 token 使用量 vs 模型上下文限制
- **压缩方式：** 使用独立的 "compaction" agent 生成摘要
- **压缩后恢复：** 重新注入最近访问的文件内容
- **实现文件：** `src/session/compaction.ts`

**Pros：** 简单可靠，Effect 类型安全
**Cons：** 单层策略在极端长对话中可能丢失细节

#### Claude Code: 三层渐进压缩

```
Layer 1: MicroCompact (时间阈值 → 清除旧工具结果)
Layer 2: AutoCompact (token 阈值 → 会话记忆压缩)
Layer 3: Full Compact (独立 Claude API 调用 → 结构化摘要)
```

- **MicroCompact 触发：** 时间间隔超过阈值
- **AutoCompact 触发：** `contextWindow - min(maxOutput, 20K) - 13K`
- **Full Compact 摘要模板：** Primary Request / Files / Errors / Pending Tasks / Current Work / Next Step
- **压缩后恢复：** 重注入最近 5 文件 (各 5K token) + 技能列表 + 计划状态
- **Partial Compact：** 用户可从/到特定消息手动压缩
- **熔断器：** 连续 3 次失败停止重试

**Pros：** 精细分层，最大限度保留关键信息，Partial Compact 提供用户控制
**Cons：** 实现复杂度高，Full Compact 额外 API 调用增加成本

#### Hermes: 迭代式四阶段压缩

```
Phase 1: 工具结果裁剪 (无 LLM 调用) → 信息性 1 行摘要
Phase 2: Token 预算尾部保护 → 向后遍历 + 1.5x 软上限
Phase 3: LLM 结构化摘要 → 迭代更新 (非从头总结)
Phase 4: 工具调用配对完整性 → 移除/插入孤儿项
```

- **反抖动：** 最近 2 次压缩各节省 <10% 则跳过
- **迭代摘要更新：** 更新前一次摘要而非从头总结，保留跨多次压缩的信息
- **主题聚焦：** `/compress <topic>` 优先保留相关内容

**Pros：** 四阶段精细化，迭代摘要避免信息丢失，工具调用配对完整性保证
**Cons：** Python 性能瓶颈，同步执行阻塞主循环

### 5.2 Doom Loop 检测

| 项目 | 算法 | 实现 |
|------|------|------|
| OpenCode | 3 次连续相同工具调用 → 权限请求 | `processor.ts` tool-call handler |
| Claude Code | 相同模式检测 + 自动终止 | `StreamingToolExecutor` |
| Hermes | IterationBudget (90/50 次) + execute_code 退还 | `run_agent.py` |

### 5.3 Token 计算

| 项目 | 算法 | 精度 |
|------|------|------|
| OpenCode | AI SDK 内置 + Provider 报告 | 高 (Provider 报告) |
| Claude Code | `chars/2.5` 估算 + API usage 精确 | 双精度 (估算+精确) |
| Hermes | HuggingFace tokenizer (Kimi-K2-Thinking) | 高 (分词器级别) |

### 5.4 Prompt Cache 优化

| 项目 | 策略 | 缓存利用率 |
|------|------|----------|
| OpenCode | Anthropic `cacheControl: { type: "ephemeral" }` 在系统消息和最后 2 消息 | 中等 |
| Claude Code | 工具按字母排序 + CacheSafeParams + 4 级 breakpoints + cache break 检测 | 极高 |
| Hermes | `system_and_3` 策略 + 5 分钟 TTL + 系统提示仅在压缩时重建 | 高 |

---

## 6. 优劣势矩阵

### 6.1 OpenCode 优劣势

| # | 优势 (Pros) | 详情 |
|---|------------|------|
| 1 | **Client/Server 架构** | 天然支持多端 (TUI/Web/Desktop/Mobile)，其他两者无此架构 |
| 2 | **25+ Provider 支持** | 通过 Vercel AI SDK + transform 层统一，最广泛的模型选择 |
| 3 | **Effect 框架** | 类型安全的副作用管理、结构化并发、自动资源清理 |
| 4 | **SQLite 持久化** | WAL 模式支持跨进程同步，Part 级细粒度更新 |
| 5 | **InstanceState 隔离** | 每个项目目录独立状态，自动清理 |
| 6 | **ACP 协议** | 标准化 Agent Communication Protocol 支持 |
| 7 | **LSP 集成** | 开箱即用的语言服务器支持，按文件扩展名自动匹配 |
| 8 | **Plugin 系统** | 运行时可扩展工具和 Provider |
| 9 | **开源 MIT** | 完全开放，可商用 |

| # | 劣势 (Cons) | 详情 |
|---|------------|------|
| 1 | **上下文压缩粗糙** | 单层压缩 vs Claude Code 三层 / Hermes 四阶段 |
| 2 | **工具并发控制弱** | 无安全/不安全工具分区批处理 |
| 3 | **权限系统简单** | 单一 ask() 模式 vs Claude Code 多层流水线 |
| 4 | **无多智能体协作** | 单层 Task tool vs Claude Code Agent Teams |
| 5 | **无工具延迟加载** | 无 ToolSearchTool 按需加载机制 |
| 6 | **无 Prompt Cache 深度优化** | 基础 cacheControl vs Claude Code CacheSafeParams |
| 7 | **TUI 成熟度不足** | opentui 新框架 vs Claude Code 自研 Ink |
| 8 | **无技能/知识学习** | 无 Hermes 式自动技能创建 |
| 9 | **无迭代压缩** | 每次压缩从头开始 vs Hermes 迭代更新 |
| 10 | **无多平台网关** | 仅 HTTP vs Hermes 16+ 消息平台 |

### 6.2 Claude Code 优劣势

| # | 优势 | 详情 |
|---|------|------|
| 1 | 三层渐进压缩 | 精细化信息保留 |
| 2 | Agent Teams | 多智能体协作 + 协调器模式 |
| 3 | StreamingToolExecutor | 安全区/非安全区并发批处理 |
| 4 | 多层权限流水线 | hooks + rules + classifier + interactive |
| 5 | 自研 TUI 框架 | 终端渲染极致优化 |
| 6 | CacheSafeParams | 子代理复用父级缓存 |
| 7 | 12 级渐进 Harness | 从简单到复杂的完整能力阶梯 |

| # | 劣势 | 详情 |
|---|------|------|
| 1 | **闭源** | 无法直接使用或修改 |
| 2 | **仅 Anthropic** | 绑定单一 Provider |
| 3 | **无 Client/Server** | 单体 CLI 架构 |
| 4 | **无 LSP 集成** | 无开箱即用语言服务器 |
| 5 | **无移动端** | 仅通过 Bridge 到 Claude Desktop |
| 6 | **代码量巨大** | 785KB 单文件，维护困难 |
| 7 | **遥测不可控** | 无法禁用 1st-party 日志 |

### 6.3 Hermes Agent 优劣势

| # | 优势 | 详情 |
|---|------|------|
| 1 | 16+ 消息平台 | Telegram/Discord/Slack/WhatsApp/Signal/Matrix... |
| 2 | 可插拔上下文引擎 | 可替换整个压缩策略 |
| 3 | 自动工具发现 | AST 分析 + 自动注册 |
| 4 | 迭代式压缩 | 更新摘要而非从头总结 |
| 5 | RL 训练集成 | Atropos 环境 + 精确 token 追踪 |
| 6 | 技能自动学习 | 自动创建/改进/持久化技能 |
| 7 | 皮肤引擎 | 数据驱动 CLI 主题化 |
| 8 | 跨会话搜索 | FTS5 SQLite + LLM 摘要 |
| 9 | 提示注入防护 | 扫描上下文文件中的注入模式 |

| # | 劣势 | 详情 |
|---|------|------|
| 1 | **Python 性能** | 同步主循环，高并发受限 |
| 2 | **无 Client/Server** | Gateway 模式但非 REST API |
| 3 | **无 LSP** | 无语言服务器集成 |
| 4 | **无 ACP** | 无 Agent Communication Protocol |
| 5 | **Python 生态限制** | 移动端/桌面端适配困难 |

---

## 7. 取长补短策略

### 7.1 从 Claude Code 借鉴

| 优先级 | 特性 | 实现难度 | 预期收益 |
|--------|------|---------|---------|
| **P0** | 三层渐进压缩 | 中 | 极高：长对话稳定性 |
| **P0** | 工具安全区/非安全区分区 | 低 | 高：并发安全性 |
| **P1** | PreToolUse/PostToolUse hooks | 低 | 高：用户自定义工具拦截 |
| **P1** | ToolSearchTool 延迟加载 | 中 | 中：上下文效率 |
| **P1** | CacheSafeParams | 中 | 高：API 成本降低 |
| **P2** | 多层权限流水线 | 高 | 中：企业级安全 |
| **P2** | Agent Teams 协作 | 高 | 高：复杂任务能力 |
| **P3** | 自研 TUI 渲染器 | 极高 | 中：终端体验 |
| **P3** | Speculation 预生成 | 高 | 中：响应速度 |

### 7.2 从 Hermes 借鉴

| 优先级 | 特性 | 实现难度 | 预期收益 |
|--------|------|---------|---------|
| **P0** | 迭代式压缩 (更新摘要) | 低 | 高：信息保留 |
| **P1** | 工具自动发现 | 低 | 中：开发效率 |
| **P1** | 技能自动学习系统 | 中 | 高：跨会话知识 |
| **P2** | Provider fallback chain | 中 | 高：可靠性 |
| **P2** | 跨会话搜索 (FTS5) | 中 | 中：用户体验 |
| **P2** | 提示注入防护 | 低 | 高：安全性 |
| **P3** | 多平台消息网关 | 极高 | 中：触达范围 |
| **P3** | RL 训练环境 | 极高 | 低：研究用途 |

### 7.3 保持 OpenCode 优势

以下特性是 OpenCode 的核心竞争力，必须在增强时保持：

1. **Client/Server 架构** - 这是实现移动端的基石
2. **25+ Provider 支持** - 差异化竞争优势
3. **Effect 框架** - 代码质量和可维护性的保障
4. **SQLite + WAL** - 跨进程同步的独特优势
5. **ACP 协议** - 生态标准化
6. **LSP 集成** - 代码智能的关键

---

## 8. Claude Code 级 Agent 构建方案

### 8.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenAG Architecture                          │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │ Flutter App  │  │  Web App     │  │  TUI App     │             │
│  │ (Mobile/     │  │  (SolidJS +  │  │  (opentui +  │             │
│  │  Desktop)    │  │   Vite)      │  │   SolidJS)   │             │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │
│         │                  │                  │                     │
│         └──────────────────┼──────────────────┘                     │
│                            │ HTTP + SSE/WS                          │
│                            ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    OpenCode Server (Hono)                    │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │   │
│  │  │ Session  │ │ Tool     │ │ Provider │ │ Compaction   │  │   │
│  │  │ Manager  │ │ Registry │ │ Manager  │ │ Engine (3层) │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │   │
│  │  │ Agent    │ │ LSP      │ │ MCP      │ │ Permission   │  │   │
│  │  │ Loop     │ │ Service  │ │ Manager  │ │ Engine       │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │   │
│  │  │ Skill    │ │ Search   │ │ Cache    │ │ Plugin       │  │   │
│  │  │ System   │ │ Index    │ │ Manager  │ │ System       │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                            │                                        │
│                            ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    SQLite (WAL) + File System                │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.2 需要增强的核心模块

#### Module 1: 三层渐进压缩引擎

```typescript
// 新增: src/session/compaction/micro-compact.ts
// 借鉴 Claude Code MicroCompact
interface MicroCompactConfig {
  timeThreshold: Duration
  preserveRecentN: number
  compactableTools: string[]
}

// 新增: src/session/compaction/auto-compact.ts
// 借鉴 Claude Code AutoCompact
interface AutoCompactConfig {
  bufferTokens: number
  maxOutputTokens: number
  circuitBreakerThreshold: number
}

// 增强: src/session/compaction.ts → full-compact.ts
// 借鉴 Hermes 迭代式摘要 + Claude Code 结构化模板
interface FullCompactConfig {
  summaryTemplate: string
  maxReinjectFiles: number
  maxReinjectTokens: number
  iterativeUpdate: boolean
}
```

#### Module 2: 工具并发分区

```typescript
// 新增: src/tool/partition.ts
// 借鉴 Claude Code StreamingToolExecutor

interface ToolPartition {
  safe: ToolCall[]
  unsafe: ToolCall[]
}

function partitionToolCalls(calls: ToolCall[]): ToolPartition[][] {
  // 连续安全工具合并为一批，每个不安全工具独立一批
}
```

#### Module 3: 多层权限引擎

```typescript
// 新增: src/permission/engine.ts
// 借鉴 Claude Code 多层权限流水线

interface PermissionRule {
  source: 'user' | 'project' | 'session' | 'policy'
  effect: 'allow' | 'deny' | 'ask'
  pattern: string
  tool: string
}

interface PermissionResult {
  decision: 'allow' | 'deny' | 'ask'
  source: string
  reason?: string
}

// 权限检查链: validateInput → preHooks → rules → classifier → interactive
```

#### Module 4: 技能学习系统

```typescript
// 新增: src/skill/learner.ts
// 借鉴 Hermes 自动技能创建

interface Skill {
  id: string
  name: string
  category: string
  content: string
  metadata: Record<string, unknown>
  created_from: string
  improved_count: number
}

// 自动技能建议触发点:
// 1. 复杂任务完成后 (可配置间隔)
// 2. 重复操作模式检测
// 3. 用户主动保存
```

#### Module 5: CacheSafeParams

```typescript
// 新增: src/session/cache.ts
// 借鉴 Claude Code 子代理缓存共享

interface CacheSafeParams {
  systemPrompt: Uint8Array
  tools: ToolDefinition[]
  model: string
  messagesPrefix: Message[]
  thinkingConfig: ThinkingConfig
}

// 确保 fork 的子代理与父代理共享 prompt cache
```

### 8.3 实现优先级路线图

```
Phase 1 (Week 1-4): 基础增强
├── 工具并发分区 (partition.ts)
├── PreToolUse/PostToolUse hooks
├── 提示注入防护
└── Provider fallback chain

Phase 2 (Week 5-10): 核心算法
├── 三层渐进压缩引擎
│   ├── MicroCompact (时间阈值)
│   ├── AutoCompact (token 阈值 + 熔断器)
│   └── Full Compact (迭代摘要 + 结构化模板)
├── CacheSafeParams (子代理缓存共享)
├── ToolSearchTool (延迟加载)
└── 跨会话搜索 (FTS5)

Phase 3 (Week 11-16): 高级特性
├── 技能自动学习系统
├── 多层权限引擎
├── Agent Teams 初版 (2-3 协作代理)
└── Flutter 客户端 MVP

Phase 4 (Week 17-24): 完善
├── Agent Teams 完整版 (coordinator 模式)
├── Speculation 预生成
├── 高级 TUI 渲染
└── Flutter 客户端完整版
```

---

## 9. Flutter Agent 应用技术可行性

### 9.1 可行性评估: ✅ 高度可行

**OpenCode 的 Client/Server 架构是实现 Flutter 客户端的天然基础。** Flutter 应用只需实现一个 HTTP + SSE/WebSocket 客户端，消费 OpenCode Server 已有的 REST API 和事件流。

### 9.2 技术栈选择

```
┌─────────────────────────────────────────────────┐
│              Flutter Agent App                   │
│                                                  │
│  UI Layer:        Flutter 3.x + Dart 3.x        │
│  State Mgmt:      Riverpod 2.x                  │
│  HTTP Client:     Dio + SSE Client               │
│  WebSocket:       web_socket_channel              │
│  Local Storage:   Hive / Isar                    │
│  Markdown:        flutter_markdown + syntax      │
│                   highlight                      │
│  Code Editor:     code_text_field / flutter      │
│                   code_editor                    │
│  Terminal:        xterm.dart (embedded)          │
│  Push:            Firebase Cloud Messaging       │
│  Auth:            OpenCode OAuth (openauth)      │
└─────────────────────────────────────────────────┘
```

### 9.3 API 对接分析

OpenCode Server 已暴露的 API 端点（可直接被 Flutter 消费）:

```
# 核心 API (已存在，无需修改 Server)
GET    /session                    # 列出会话
POST   /session                    # 创建会话
GET    /session/:id                # 获取会话
POST   /session/:id/message        # 发送消息 (流式响应)
DELETE /session/:id                # 删除会话
POST   /session/:id/abort          # 中止当前操作
POST   /session/:id/fork           # 分叉会话
POST   /session/:id/share          # 分享会话

# 事件流 (已存在)
GET    /event                      # SSE 事件流
WS     /event                      # WebSocket 事件流

# 工具相关 (已存在)
GET    /permission                 # 权限请求队列
POST   /permission/:id/reply       # 回复权限请求
GET    /question                   # 问题队列
POST   /question/:id/reply         # 回复问题

# 配置相关 (已存在)
GET    /config                     # 获取配置
GET    /provider                   # 列出 Provider
GET    /agent                      # 列出 Agent
GET    /skill                      # 列出 Skill

# 项目相关 (已存在)
GET    /project                    # 项目信息
GET    /path                       # 路径信息
GET    /vcs                        # VCS 信息
GET    /vcs/diff                   # Git diff

# 需要新增的 API
GET    /session/:id/search         # 跨会话搜索
POST   /session/:id/compact        # 手动触发压缩
GET    /skill/:id                  # 获取技能详情
POST   /skill                      # 创建/更新技能
```

### 9.4 SSE 事件映射

Flutter 客户端需要处理的 SSE 事件类型（已在 Server 中实现）:

```dart
enum OpenCodeEvent {
  sessionCreated,      // session.created
  sessionUpdated,      // session.updated
  sessionDeleted,      // session.deleted
  messageUpdated,      // message.updated
  messagePartUpdated,  // message.part.updated
  messagePartDelta,    // message.part.delta (流式文本)
  messagePartRemoved,  // message.part.removed
  permissionAsked,     // permission.asked
  questionAsked,       // question.asked
}
```

### 9.5 Flutter 应用架构

```
┌──────────────────────────────────────────────────────────┐
│                    Flutter App Architecture               │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                   Presentation Layer                │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │  │
│  │  │ Chat     │ │ Session  │ │ Settings         │  │  │
│  │  │ Screen   │ │ List     │ │ Screen           │  │  │
│  │  │          │ │ Screen   │ │                  │  │  │
│  │  │ - 消息列表│ │          │ │ - Provider 配置  │  │  │
│  │  │ - 输入框  │ │ - 会话历史│ │ - 模型选择      │  │  │
│  │  │ - 工具展示│ │ - 搜索   │ │ - MCP 服务器    │  │  │
│  │  │ - Diff   │ │ - 分支   │ │ - 权限管理      │  │  │
│  │  └──────────┘ └──────────┘ └──────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                          │                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │                   State Layer (Riverpod)            │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │  │
│  │  │ Session  │ │ Message  │ │ Event            │  │  │
│  │  │ Provider │ │ Provider │ │ Provider (SSE)   │  │  │
│  │  └──────────┘ └──────────┘ └──────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                          │                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │                   Data Layer                        │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │  │
│  │  │ OpenCode │ │ Local    │ │ Push             │  │  │
│  │  │ API      │ │ Cache    │ │ Notification     │  │  │
│  │  │ Client   │ │ (Hive)   │ │ Handler          │  │  │
│  │  └──────────┘ └──────────┘ └──────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 9.6 关键技术挑战与解决方案

| 挑战 | 难度 | 解决方案 |
|------|------|---------|
| SSE 流式文本渲染 | 中 | `flutter_sse` 或 `dio` + 手动 SSE 解析；`message.part.delta` 事件驱动增量更新 |
| Markdown + 代码高亮 | 低 | `flutter_markdown` + `highlight` 包；自定义 SyntaxHighlighter |
| Diff 可视化 | 中 | `diff` Dart 包 + CustomPainter；红绿配色 diff 视图 |
| 工具调用展示 | 中 | 状态机 (pending → running → completed/error)；可展开卡片 |
| 权限请求推送 | 低 | SSE 事件触发本地通知；对话框/底部弹窗 |
| 终端模拟 | 高 | `xterm.dart` 嵌入式终端；PTY 通过 WebSocket 代理 |
| 离线模式 | 高 | 本地消息缓存 (Hive)；离线时提示不可用 |
| 文件浏览/编辑 | 中 | 树形文件浏览器 + Monaco Editor (WebView) 或简易代码编辑器 |
| 多服务器管理 | 低 | 服务器配置列表 + 连接状态管理 |
| 安全通信 | 中 | HTTPS + Token Auth；Server 已有 AuthMiddleware |

### 9.7 部署拓扑

```
方案 A: 本地直连 (推荐入门)
┌─────────────┐     HTTP/SSE      ┌─────────────────┐
│ Flutter App │ ←───────────────→ │ OpenCode Server │
│ (Mobile)    │     localhost     │ (本地运行)       │
└─────────────┘                   └────────┬────────┘
                                           │
                                           ▼
                                    ┌─────────────────┐
                                    │ LLM Provider    │
                                    │ (Cloud)         │
                                    └─────────────────┘

方案 B: 远程连接 (生产部署)
┌─────────────┐    HTTPS/WSS     ┌─────────────────┐
│ Flutter App │ ←───────────────→ │ Reverse Proxy   │
│ (Mobile)    │    Internet      │ (Cloudflare)     │
└─────────────┘                   └────────┬────────┘
                                           │
                                           ▼
                                    ┌─────────────────┐
                                    │ OpenCode Server │
                                    │ (VPS/Cloud)     │
                                    └────────┬────────┘
                                           │
                                           ▼
                                    ┌─────────────────┐
                                    │ LLM Provider    │
                                    │ (Cloud)         │
                                    └─────────────────┘

方案 C: mDNS 局域网发现 (OpenCode 已支持)
┌─────────────┐   mDNS + HTTP    ┌─────────────────┐
│ Flutter App │ ←───────────────→│ OpenCode Server │
│ (同网络)     │   Bonjour/mDNS  │ (开发机)        │
└─────────────┘                   └─────────────────┘
```

### 9.8 为什么 Flutter 而不是 React Native

| 维度 | Flutter | React Native |
|------|---------|--------------|
| UI 一致性 | 自绘引擎，像素级一致 | 依赖原生组件 |
| 性能 | 60fps (Skia) | 60fps (Fabric) |
| Markdown/代码渲染 | CustomPainter 灵活 | WebView 依赖 |
| SSE/WebSocket | 原生支持 | 原生支持 |
| 桌面端支持 | 内置 (Windows/macOS/Linux) | 需额外适配 |
| 包体积 | ~15MB (可接受) | ~10MB |
| 开发效率 | Hot Reload | Fast Refresh |
| Dart vs JS | 需学习 Dart | JS/TS 已有生态 |

**推荐 Flutter 的理由：** OpenCode 已有 SolidJS Web App 和 Tauri/Electron Desktop，Flutter 可以覆盖移动端 + 桌面端 + Web 端，真正实现一套代码六端运行 (iOS/Android/macOS/Windows/Linux/Web)。

---

## 10. 安全架构与威胁建模

### 10.1 威胁模型 (STRIDE 分析)

| 威胁类型 | 攻击面 | 风险等级 | 缓解措施 |
|----------|--------|---------|---------|
| **Spoofing (欺骗)** | SSE/WebSocket 连接伪造 | 高 | Token-based Auth + TLS + CORS 白名单 |
| **Tampering (篡改)** | 中间人篡改 SSE 事件流 | 高 | HTTPS 强制 + 事件签名 (HMAC) |
| **Repudiation (抵赖)** | 否认执行了危险操作 | 中 | 审计日志 (所有 tool call 记录) |
| **Info Disclosure** | API Key 泄露、会话数据暴露 | 高 | 加密存储、环境变量注入、密钥轮换 |
| **Denial of Service** | 恶意客户端 flood SSE 连接 | 中 | 速率限制 + 连接数上限 + 心跳超时 |
| **Elevation of Privilege** | Bash 工具执行提权命令 | 极高 | 沙箱隔离 + 命令白名单 + 审计 |

### 10.2 攻击面分析

#### 10.2.1 网络层

```
攻击面                          缓解措施
─────────────────────────────────────────────────────────────
SSE 连接劫持                    HTTPS + Token Auth + Origin 检查
WebSocket 注入                  wss:// + 消息格式验证 + 大小限制
CSRF (跨站请求伪造)             SameSite Cookie + CSRF Token
DNS Rebinding                  Host 白名单 + Origin 验证
mDNS 欺骗 (局域网)             mDNS 仅用于发现；Auth 仍需 Token
```

#### 10.2.2 应用层

```
攻击面                          缓解措施
─────────────────────────────────────────────────────────────
提示注入 (Prompt Injection)     输入净化 + 上下文文件扫描
工具滥用 (Tool Abuse)           权限系统 + 速率限制 + 人类确认
路径遍历 (Path Traversal)       路径规范化 + 工作目录限制
命令注入 (Command Injection)    参数转义 + AST 分析 + 沙箱
SSRF (服务端请求伪造)           URL 白名单 + 禁止内网 IP
```

#### 10.2.3 数据层

```
攻击面                          缓解措施
─────────────────────────────────────────────────────────────
API Key 泄露                    加密存储 (keychain/credential manager)
会话数据泄露                    SQLite 加密 (SQLCipher) 或文件系统加密
MCP 服务器恶意代码              OSV 恶意扫描 (借鉴 Hermes)
工具结果大文件                  大小限制 + 磁盘溢出到安全目录
```

### 10.3 安全架构设计

```typescript
// 安全中间件链 (Hono)
app
  .use(StrictTLSMiddleware)          // 强制 HTTPS
  .use(CORSMiddleware({              // CORS 白名单
    origins: config.allowedOrigins
  }))
  .use(RateLimitMiddleware({         // 速率限制
    window: "1m",
    max: 60
  }))
  .use(AuthMiddleware)               // Token 验证
  .use(AuditLogMiddleware)           // 审计日志
  .use(InputValidationMiddleware)    // 输入净化
```

### 10.4 API Key 安全策略

| 策略 | 详情 |
|------|------|
| 存储 | `credential` 系统密钥链 (macOS Keychain / Windows Credential Manager / libsecret) |
| 传输 | 仅通过 HTTPS；环境变量注入 (不写入配置文件) |
| 轮换 | 支持多 Key 轮换；自动检测 Key 失效 |
| 审计 | Key 使用记录 (哪个 Provider、何时、哪个会话) |
| 撤销 | 支持即时清除所有存储的 Key |

### 10.5 沙箱隔离方案

```
┌─────────────────────────────────────────────┐
│              Sandbox Architecture            │
│                                             │
│  ┌───────────┐  ┌───────────┐  ┌─────────┐ │
│  │ Bash      │  │ File      │  │ Network │ │
│  │ Sandbox   │  │ Sandbox   │  │ Sandbox │ │
│  │           │  │           │  │         │ │
│  │ - 命令白  │  │ - 工作目录 │  │ - URL   │ │
│  │   名单    │  │   限制    │  │   白名单│ │
│  │ - 资源限制│  │ - 敏感文件 │  │ - 禁止  │ │
│  │   (cgroup)│  │   保护    │  │   内网  │ │
│  │ - AST分析 │  │ - 写前确认│  │ - SSRF  │ │
│  │   危险命令│  │           │  │   检测  │ │
│  └───────────┘  └───────────┘  └─────────┘ │
│                                             │
│  审计层: 所有操作记录到审计日志              │
│  (谁、何时、什么操作、什么参数、什么结果)     │
└─────────────────────────────────────────────┘
```

### 10.6 审计日志设计

```typescript
interface AuditEntry {
  timestamp: DateTime
  actor: "user" | "agent" | "system"
  session_id: SessionID
  action: string           // "tool.bash.execute" | "tool.edit.write" | ...
  parameters: Record<string, unknown>
  result: "success" | "denied" | "error"
  risk_level: "low" | "medium" | "high" | "critical"
  ip_address?: string
  user_agent?: string
}

// 存储策略:
// - 热数据: SQLite (最近 30 天)
// - 冷数据: 压缩归档 (30 天+)
// - 不可篡改: 只追加 (append-only) 表
```

### 10.7 三项目安全对比

| 安全维度 | OpenCode | Claude Code | Hermes |
|----------|----------|-------------|--------|
| API Key 存储 | 环境变量 + config | 环境变量 | config.yaml + env |
| 传输加密 | 用户配置 | HTTPS 强制 | 用户配置 |
| 工具权限 | 单层 ask() | 多层流水线 | approval + 平台按钮 |
| 提示注入防护 | 无 | 部分 | 有 (模式扫描) |
| 沙箱 | 无 | 有 (可选) | 6 种终端后端 |
| 审计日志 | 无 | 遥测 (不可控) | 无 |
| MCP 安全 | 基础 | OAuth 2.0 | OAuth 2.1 PKCE + OSV |

---

## 11. 性能基准与量化分析

### 11.1 Benchmark 方案设计

> 注: 以下为建议的 benchmark 方案，需在实际实现后采集数据。

#### Agent Loop 延迟测试

```
测试场景: 发送 "读取 package.json 并列出依赖"
度量: 用户发送 → 第一个 token 流出 (TTFT) → 最后一个 token 完成 (TTLT)

预期基线:
┌──────────────┬──────────────┬──────────────┐
│              │ TTFT         │ TTLT         │
├──────────────┼──────────────┼──────────────┤
│ OpenCode     │ ~800ms       │ ~3.2s        │
│ Claude Code  │ ~500ms       │ ~2.8s        │
│ Hermes       │ ~1200ms      │ ~4.5s        │
└──────────────┴──────────────┴──────────────┘
影响因素: Provider SDK 差异、流式处理架构、Effect 开销
```

#### 压缩算法效率

```
测试场景: 50 轮对话 (含 30+ 工具调用)，约 80K token
度量: 压缩前 token 数、压缩后 token 数、压缩耗时、信息保留率

预期基线:
┌──────────────┬──────────┬──────────┬────────┬──────────┐
│              │ 压缩比    │ 耗时     │ API调用 │ 信息保留 │
├──────────────┼──────────┼──────────┼────────┼──────────┤
│ OpenCode(单层)│ ~35%     │ ~4s      │ 1次    │ ~70%     │
│ CC(三层)     │ ~55%     │ ~2s+6s   │ 1-2次  │ ~90%     │
│ Hermes(四阶段)│ ~50%     │ ~3s+8s   │ 1次    │ ~85%     │
└──────────────┴──────────┴──────────┴────────┴──────────┘
注: CC MicroCompact 无 API 调用，AutoCompact 仅在溢出时触发
```

#### SSE 事件吞吐量

```
测试场景: 1 个流式响应包含 2000+ delta 事件
度量: 事件延迟 (server emit → client receive)、丢包率

预期基线:
┌──────────────┬──────────────┬──────────┐
│ 传输方式      │ P50 延迟     │ 丢包率   │
├──────────────┼──────────────┼──────────┤
│ SSE (本地)   │ <5ms         │ 0%       │
│ SSE (局域网) │ <15ms        │ <0.1%    │
│ SSE (远程)   │ <50ms        │ <0.5%    │
│ WS (本地)    │ <3ms         │ 0%       │
│ WS (局域网)  │ <10ms        │ 0%       │
│ WS (远程)    │ <30ms        │ <0.1%    │
└──────────────┴──────────────┴──────────┘
结论: WebSocket 在远程场景下延迟更低，推荐 Flutter 使用 WS
```

#### 内存占用

```
测试场景: 10 个并发会话，每会话 50 条消息
度量: RSS (Resident Set Size)

预期基线:
┌──────────────┬──────────┬──────────────┐
│              │ 空闲      │ 10 会话负载  │
├──────────────┼──────────┼──────────────┤
│ OpenCode     │ ~80MB    │ ~200MB       │
│ Claude Code  │ ~120MB   │ ~350MB       │
│ Hermes       │ ~150MB   │ ~500MB       │
└──────────────┴──────────┴──────────────┘
影响因素: Bun vs Node vs Python 运行时；Effect 层开销；SQLite 缓存
```

### 11.2 工具并发性能提升预估

```
测试场景: Agent 同时发起 3 个安全工具调用 (read, glob, grep)

串行执行: 3 × 200ms = 600ms
并行执行: max(200ms) = 200ms
提升: ~3x

测试场景: Agent 同时发起 1 个安全 + 1 个不安全 (read + edit)
分区批处理: [read, edit] → [read 并行] + [edit 串行] ≈ 250ms
无分区:    串行 400ms
提升: ~1.6x
```

### 11.3 性能优化目标

| 指标 | 当前 (估算) | Phase 2 目标 | Phase 4 目标 |
|------|-----------|-------------|-------------|
| TTFT (本地) | ~800ms | ~500ms | ~300ms |
| SSE 事件延迟 | ~10ms | ~5ms | ~3ms |
| 压缩触发到完成 | ~4s | ~2s | ~1.5s |
| 内存/会话 | ~12MB | ~8MB | ~5MB |
| Server 启动时间 | ~2s | ~1.5s | ~1s |

---

## 12. 错误处理与容错机制

### 12.1 错误分类

```typescript
type AgentError =
  | { type: "llm_api"; provider: string; status: number; message: string }
  | { type: "llm_rate_limit"; provider: string; retry_after: number }
  | { type: "llm_context_overflow"; current_tokens: number; max_tokens: number }
  | { type: "tool_execution"; tool: string; exit_code: number; stderr: string }
  | { type: "tool_timeout"; tool: string; timeout_ms: number }
  | { type: "tool_permission_denied"; tool: string; reason: string }
  | { type: "network"; operation: string; cause: "timeout" | "dns" | "connection" }
  | { type: "storage"; operation: string; cause: "corrupt" | "full" | "locked" }
  | { type: "compression"; stage: string; attempt: number }
```

### 12.2 重试策略对比

| 维度 | OpenCode | Claude Code | Hermes |
|------|----------|-------------|--------|
| LLM API 重试 | SessionRetry policy | API 级重试 | Provider fallback chain |
| 工具超时 | 无全局超时 | 2s 进度 + 可配置 | per-tool timeout |
| 压缩失败 | 无重试 | 熔断器 (3 次) | 反抖动 (<10% 跳过) |
| 网络断连 | SSE 重连 | 无 (本地 CLI) | 指数退避重连 |

### 12.3 推荐容错策略

```
LLM API 调用失败:
├── 429 Rate Limit → 指数退避 (1s, 2s, 4s, 8s) + Provider fallback
├── 500 Server Error → 重试 3 次 → fallback provider → 通知用户
├── 401 Auth Error → 检查 Key 有效性 → 提示重新认证
└── Network Timeout → 重试 2 次 → 离线提示

工具执行失败:
├── Timeout → 中止 + 记录 → Agent 自行决定是否重试
├── Permission Denied → 记录 + 通知 Agent → Agent 调整策略
├── Exit Code != 0 → 返回 stderr → Agent 分析错误并修复
└── Crash (进程崩溃) → 中止当前 turn → 恢复到上一条消息状态

压缩失败:
├── 第 1 次 → 丢弃最旧 20% 消息后重试 (借鉴 CC)
├── 第 2 次 → 降低摘要质量要求
├── 第 3 次 → 熔断，停止压缩，通知用户
└── 反抖动 → 最近 2 次各节省 <10% 则跳过 (借鉴 Hermes)

Server Crash 恢复:
├── SQLite WAL → 自动回滚未完成事务
├── SyncEvent → 重放未确认事件
├── 会话状态 → 从最后一条 Assistant message 恢复
└── 工具状态 → 未完成的工具标记为 "error: server_restart"
```

### 12.4 状态一致性保障

```
写入顺序保证:
├── 用户消息: 阻塞写入 SQLite (确保 crash recovery)
├── Assistant 消息: 异步写入 (顺序队列保证)
├── Part 更新: 批量写入 (delta 仅在内存)
└── 同步事件: SQLite WAL 确保跨进程可见

崩溃恢复流程:
1. Server 重启 → 打开 SQLite WAL
2. 回滚未完成事务
3. 扫描所有活跃会话
4. 检查每会话最后一条 Assistant message
5. 如果 finish != "stop" → 标记为 "error: interrupted"
6. 如果有 pending tool → 标记为 "error: server_restart"
7. 恢复 SSE/WS 连接
```

---

## 13. 可观测性架构

### 13.1 三项目可观测性对比

| 维度 | OpenCode | Claude Code | Hermes |
|------|----------|-------------|--------|
| 日志 | Effect Logger | console + Datadog | Python logging |
| Metrics | OpenTelemetry (Effect) | GrowthBook + Datadog | 无 |
| Tracing | @effect/opentelemetry | OTEL (可选) | 无 |
| 遥测 | 基础 | 1st-party + Datadog | 无 |
| Dashboard | 无 | Datadog | 无 |

**OpenCode 优势：** Effect + OpenTelemetry 集成提供了其他两者不具备的结构化可观测性基础。

### 13.2 日志体系设计

```typescript
// 结构化日志
interface LogEntry {
  timestamp: string
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal"
  component: string       // "agent-loop" | "tool-registry" | "provider" | ...
  trace_id: string        // OpenTelemetry trace ID
  span_id: string         // OpenTelemetry span ID
  session_id?: string
  message: string
  attributes: Record<string, unknown>
}

// 日志级别策略
// trace:  每个 SSE 事件、Part 更新 (仅开发环境)
// debug:  工具调用参数/结果、Provider 请求/响应摘要
// info:   会话创建/销毁、Agent Loop 开始/结束、压缩触发
// warn:   重试触发、Provider fallback、权限拒绝
// error:  API 调用失败、工具执行错误、存储错误
// fatal:  不可恢复错误

// 日志轮转
// - 开发: stdout (pretty print)
// - 生产: 文件 (JSON Lines) + 轮转 (100MB/文件, 保留 10 个)
```

### 13.3 Metrics 体系

```typescript
// 核心 Metrics
const Metrics = {
  // Agent Loop
  "agent.loop.duration": Histogram,           // 每次 loop 迭代耗时
  "agent.loop.turns": Counter,                // 总 turn 数
  "agent.loop.tokens.input": Histogram,       // 输入 token 数
  "agent.loop.tokens.output": Histogram,      // 输出 token 数
  "agent.loop.cost.usd": Histogram,           // 每次调用成本

  // Tools
  "tool.call.duration": Histogram,            // 工具执行耗时 (by tool)
  "tool.call.count": Counter,                 // 工具调用次数 (by tool)
  "tool.call.error": Counter,                 // 工具错误次数 (by tool, error_type)
  "tool.call.parallel": Histogram,            // 并行工具调用数

  // Provider
  "provider.request.duration": Histogram,     // Provider API 延迟 (by provider)
  "provider.request.error": Counter,          // Provider 错误 (by provider, status)
  "provider.cache.hit_rate": Gauge,           // Prompt cache 命中率

  // Compression
  "compression.tokens.before": Histogram,     // 压缩前 token 数
  "compression.tokens.after": Histogram,      // 压缩后 token 数
  "compression.ratio": Histogram,             // 压缩比
  "compression.duration": Histogram,          // 压缩耗时

  // Session
  "session.active": Gauge,                    // 活跃会话数
  "session.duration": Histogram,              // 会话持续时长
  "session.messages": Histogram,              // 每会话消息数

  // Server
  "server.sse.connections": Gauge,            // SSE 连接数
  "server.ws.connections": Gauge,             // WebSocket 连接数
  "server.request.duration": Histogram,       // HTTP 请求延迟
}
```

### 13.4 分布式追踪 (Tracing)

```
全链路追踪: User → Server → Agent Loop → LLM → Tool → Response

Trace: session.message.send
├── Span: agent.loop (duration: ~3.2s)
│   ├── Span: llm.stream (duration: ~2.1s)
│   │   ├── Span: provider.request (duration: ~2.0s)
│   │   └── Span: stream.process (duration: ~2.1s)
│   ├── Span: tool.bash (duration: ~0.8s)
│   │   ├── Span: process.spawn (duration: ~0.75s)
│   │   └── Span: output.truncate (duration: ~0.05s)
│   └── Span: llm.stream (duration: ~1.5s)  // 第二轮
└── Span: response.send (duration: ~0.01s)

导出: OpenTelemetry OTLP → Jaeger / Tempo / Datadog
```

---

## 14. 成本分析与优化策略

### 14.1 API 调用成本估算

```
假设: Claude Sonnet 4 @ $3/M input, $15/M output

典型会话 (30 分钟编程任务):
┌──────────────────────┬──────────┬──────────┬────────┐
│                      │ Input    │ Output   │ 成本   │
├──────────────────────┼──────────┼──────────┼────────┤
│ 无压缩               │ ~150K    │ ~15K     │ $0.68  │
│ 单层压缩 (OpenCode)  │ ~120K    │ ~15K     │ $0.56  │
│ 三层压缩 (目标)      │ ~90K     │ ~15K     │ $0.42  │
│ 三层 + Prompt Cache  │ ~60K     │ ~15K     │ $0.33  │
└──────────────────────┴──────────┴──────────┴────────┘

压缩额外成本:
- AutoCompact: ~5K input + ~1K output ≈ $0.03/次
- Full Compact: ~20K input + ~2K output ≈ $0.09/次
- 子代理 (Agent Teams): 与父代理成本叠加，约 1.5-3x

月度估算 (活跃开发者，每日 4 小时):
┌──────────────────────┬──────────────┐
│ 场景                  │ 月成本       │
├──────────────────────┼──────────────┤
│ 无优化 (Claude)      │ ~$40-60      │
│ 三层压缩 + Cache     │ ~$20-35      │
│ 混合模型 (小事用Haiku)│ ~$15-25     │
│ 开源模型 (本地)       │ $0 (电费)   │
└──────────────────────┴──────────────┘
```

### 14.2 部署成本

```
方案 A: 本地 (开发者电脑) — $0
方案 B: VPS (远程 Server)
┌──────────┬──────────┬──────────────────┐
│ 规格      │ 月费     │ 适用场景          │
├──────────┼──────────┼──────────────────┤
│ 2C/4G    │ $10-20   │ 个人使用          │
│ 4C/8G    │ $30-50   │ 小团队 (5人)      │
│ 8C/16G   │ $80-120  │ 中团队 (20人)     │
└──────────┴──────────┴──────────────────┘

方案 C: Cloudflare Tunnel (零成本内网穿透)
方案 D: SST 部署到 AWS (已有 sst.config.ts)
```

### 14.3 成本优化策略

| 策略 | 预期节省 | 实现复杂度 |
|------|---------|-----------|
| Prompt Cache 深度优化 | 30-50% | 中 |
| 三层压缩 (vs 无压缩) | 25-40% | 中 |
| 小模型降级 (简单任务用 Haiku/Gemma) | 20-40% | 低 |
| 工具结果截断优化 | 10-15% | 低 |
| 批量请求 (Provider 支持) | 50% | 高 |
| 本地模型回退 (隐私/省钱) | 100% | 中 |

---

## 15. 测试策略与质量保障

### 15.1 测试分层

```
┌─────────────────────────────────────────────┐
│                Testing Pyramid               │
│                                             │
│              ┌─────┐                        │
│              │ E2E │  ← Flutter 集成测试     │
│              └──┬──┘    (Patrol / Appium)    │
│             ┌───┴───┐                       │
│             │Integr.│  ← API 集成测试        │
│             │ Tests │    (真实 Server)        │
│             └───┬───┘                        │
│          ┌──────┴──────┐                     │
│          │  Unit Tests │  ← Effect 测试      │
│          │             │    (TestClock,       │
│          └──────┬──────┘     TestRandom)      │
│     ┌──────────┴──────────┐                  │
│     │  Property-Based     │  ← 快速检查       │
│     │  Tests (fast-check) │    (Schema 验证)  │
│     └─────────────────────┘                  │
└─────────────────────────────────────────────┘
```

### 15.2 Agent Loop 测试策略

```typescript
// 挑战: LLM 响应不确定，如何 mock?

// 方案 1: 录制/回放 (Record/Replay)
// 录制真实 LLM 交互，存储为 fixture，测试时回放
const fixture = await Fixture.record("auth-flow", async (agent) => {
  await agent.prompt("implement JWT auth")
  // 记录所有 LLM 请求/响应对
})

// 方案 2: Mock Provider Layer
// 在 AI SDK 层面 mock，返回预定义的流式响应
const mockProvider = createMockProvider({
  responses: [
    { text: "I'll read the file first", tool_calls: [{ name: "read", args: { path: "src/auth.ts" } }] },
    { text: "Now I'll implement...", tool_calls: [{ name: "write", args: { path: "src/auth.ts", content: "..." } }] },
    { text: "Done! I've implemented JWT auth." }
  ]
})

// 方案 3: Effect TestLayer
// 使用 Effect 的 TestLayer 替换真实服务
const TestLLMLayer = Layer.effect(LLM.Service, {
  stream: () => Stream.fromIterable([
    { type: "text-delta", text: "Hello" },
    { type: "finish", reason: "stop" }
  ])
})
```

### 15.3 工具系统测试

```typescript
// 每个工具独立测试 (无 mock)
describe("BashTool", () => {
  it("executes simple commands", async () => {
    const result = await BashTool.execute({ command: "echo hello" }, mockContext)
    expect(result.output).toContain("hello")
  })

  it("enforces timeout", async () => {
    const result = BashTool.execute(
      { command: "sleep 10" },
      { ...mockContext, timeout: 1000 }
    )
    await expect(result).rejects.toThrow("timeout")
  })
})

// 工具并发测试
describe("Tool Partitioning", () => {
  it("parallelizes safe tools", async () => {
    const calls = [readCall, globCall, grepCall]
    const batches = partitionToolCalls(calls)
    expect(batches).toHaveLength(1)       // 全部安全 → 1 批
    expect(batches[0].safe).toHaveLength(3)
  })

  it("separates unsafe tools", async () => {
    const calls = [readCall, editCall, grepCall]
    const batches = partitionToolCalls(calls)
    expect(batches).toHaveLength(2)       // [read,grep] + [edit]
  })
})
```

### 15.4 Flutter E2E 测试

```dart
// 使用 patrol (Flutter E2E 框架)
patrolTest('send message and receive streaming response', ($) async {
  await $.pumpWidget(MyApp());

  // 连接服务器
  await $('Connect to Server').tap();
  await $('localhost:4096').enterText('localhost:4096');
  await $('Connect').tap();

  // 创建会话
  await $('New Session').tap();

  // 发送消息
  await $('Instruct the agent...').enterText('Read package.json');
  await $('Send').tap();

  // 验证流式响应
  await $('OpenCode Agent').waitUntilVisible();
  await $.tester.pumpAndSettle(Duration(seconds: 5));
  expect(find.text('package.json'), findsWidgets);
});
```

### 15.5 测试覆盖率目标

| 模块 | Phase 1 | Phase 2 | Phase 4 |
|------|---------|---------|---------|
| Agent Loop | 60% | 80% | 90% |
| Tool System | 70% | 85% | 95% |
| Provider Layer | 50% | 70% | 85% |
| Server Routes | 60% | 80% | 90% |
| Flutter UI | — | 40% | 70% |
| Flutter Integration | — | 20% | 50% |

---

## 16. API 版本与数据迁移

### 16.1 API 版本控制策略

```typescript
// 当前: 无版本前缀 (隐患)
GET /session/:id

// 推荐方案: URL 前缀 + Header 协商
GET /v1/session/:id          // 稳定 API
GET /v2/session/:id          // 下一版 API (开发中)

// Hono 路由结构
app
  .route("/v1", V1Routes())     // 稳定，有 SLA
  .route("/v2", V2Routes())     // 实验性，可 breaking change
  .route("/", V1Routes())       // 默认指向最新稳定版

// 版本策略:
// - v1: 当前 API，冻结 (仅 bug fix)
// - v2: 新增特性 (三层压缩、搜索等)，新增端点，不修改 v1
// - Breaking change: 仅在 major version bump
```

### 16.2 Breaking Change 迁移方案

```
检测机制:
├── API Version Header: X-API-Version: 2
├── Client SDK 版本检查
└── Deprecation Header: Sunset: Sat, 01 Nov 2026 00:00:00 GMT

迁移流程:
1. 宣布弃用 (至少 90 天提前通知)
2. 添加 Sunset + Deprecation headers
3. 新版本上线，旧版本继续运行
4. 旧版本返回 299 + 迁移指引
5. 最终关闭旧版本
```

### 16.3 数据库 Schema Migration

```typescript
// OpenCode 已使用 Drizzle Kit 管理迁移
// 当前: migration/<timestamp>_<slug>/migration.sql

// 新增: 版本化 Schema
const SchemaVersion = sqliteTable("schema_version", {
  version: integer().primaryKey(),
  applied_at: integer().notNull(),
  description: text().notNull(),
})

// 迁移策略:
// 1. 新增表/列 → 向后兼容 (旧代码忽略新列)
// 2. 删除列 → 分两步: 先标记 deprecated → 下个版本删除
// 3. 重命名 → 新列 + 数据迁移 + 旧列保留 1 个版本
// 4. Part 类型扩展 → 新类型用新 ID 范围，旧代码忽略未知类型
```

### 16.4 Feature Flag 系统

```typescript
// 借鉴 Claude Code 的 Feature Flag 机制
// (OpenCode 当前无 Feature Flag)

interface FeatureFlags {
  // Server 端
  "compression.three_layer": boolean       // 三层压缩
  "tool.parallel_execution": boolean       // 工具并行
  "agent.teams": boolean                   // Agent Teams
  "permission.multi_layer": boolean        // 多层权限
  "search.cross_session": boolean          // 跨会话搜索

  // Client 端 (通过 /config API 下发)
  "ui.diff_viewer": boolean                // Diff 查看器
  "ui.terminal_embedded": boolean          // 嵌入终端
  "ui.file_browser": boolean              // 文件浏览器
}

// 实现: 配置文件 + 环境变量 + 远程开关 (未来)
const flags: FeatureFlags = {
  ...defaults,
  ...config.feature_flags,
  ...envOverrides("OPENCODE_FEATURE_"),
}
```

---

## 17. Flutter UX 深度设计

### 17.1 设计语言: The Modern Archive

> 基于 `OpenAG Theme Design/` 中的 "Digital Broadsheet" 设计规范，
> 将新闻编辑室美学转化为 AI Agent 交互体验。

#### 设计原则

| 原则 | 应用 |
|------|------|
| **权威感** | Newsreader 衬线标题，信息经过策展而非堆砌 |
| **无圆角** | 所有元素 `borderRadius: 0`，营造建筑感 |
| **Tonal Layering** | 通过灰度变化而非阴影创造层次 |
| **有意不对称** | 左对齐大标题 + 右侧元数据 |
| **极端留白** | 如果觉得够了，再加 16px |

#### 色彩系统 (Flutter ThemeData)

```dart
// 基于 OpenAG Theme Design 的色彩规范
class OpenAGColors {
  // Level 0: 基础画布
  static const surface = Color(0xFFF9F9F9);
  // Level 1: 次级内容区
  static const surfaceContainerLow = Color(0xFFF3F3F3);
  // Level 2: 提升内容 (卡片/输入框)
  static const surfaceContainerLowest = Color(0xFFFFFFFF);
  // 辅助
  static const surfaceContainerHigh = Color(0xFFE8E8E8);
  static const surfaceContainerHighest = Color(0xFFE2E2E2);
  // 文本
  static const primary = Color(0xFF000000);
  static const onSurface = Color(0xFF1B1B1B);
  static const onSurfaceVariant = Color(0xFF474747);
  static const outline = Color(0xFF777777);
  static const outlineVariant = Color(0xFFC6C6C6);
  // 强调
  static const primaryContainer = Color(0xFF3B3B3B);
  static const onPrimary = Color(0xFFE2E2E2);
}

// 深色模式 (自动推导)
class OpenAGDarkColors {
  static const surface = Color(0xFF1A1A1A);
  static const surfaceContainerLow = Color(0xFF222222);
  static const surfaceContainerLowest = Color(0xFF2A2A2A);
  static const primary = Color(0xFFF0F0F0);
  // ... 基于浅色的镜像推导
}
```

#### 字体系统

```dart
// Editorial Authority: Newsreader (display, headline, body-lg)
// Functional Engine: Public Sans (title, label, body-sm)
TextTheme openAGTextTheme() {
  return TextTheme(
    displayLarge: TextStyle(fontFamily: 'Newsreader', fontSize: 56, height: 1.1, letterSpacing: 0.02),
    displayMedium: TextStyle(fontFamily: 'Newsreader', fontSize: 40, height: 1.15, letterSpacing: 0.02),
    headlineLarge: TextStyle(fontFamily: 'Newsreader', fontSize: 32, height: 1.2, letterSpacing: 0.02),
    headlineMedium: TextStyle(fontFamily: 'Newsreader', fontSize: 28, height: 1.25),
    headlineSmall: TextStyle(fontFamily: 'Newsreader', fontSize: 24, height: 1.3),
    bodyLarge: TextStyle(fontFamily: 'Newsreader', fontSize: 18, height: 1.6),
    bodyMedium: TextStyle(fontFamily: 'Public Sans', fontSize: 16, height: 1.5),
    bodySmall: TextStyle(fontFamily: 'Public Sans', fontSize: 14, height: 1.4),
    labelLarge: TextStyle(fontFamily: 'Public Sans', fontSize: 14, fontWeight: FontWeight.w600, letterSpacing: 0.05),
    labelMedium: TextStyle(fontFamily: 'Public Sans', fontSize: 12, fontWeight: FontWeight.w500, letterSpacing: 0.1),
    labelSmall: TextStyle(fontFamily: 'Public Sans', fontSize: 10, fontWeight: FontWeight.w500, letterSpacing: 0.15),
  );
}
```

### 17.2 核心交互流程

#### 流程 1: 会话列表 → 聊天

```
┌────────────────────────────────────────────────────────────┐
│ 会话列表 (左侧边栏)                                        │
│                                                            │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ THE AGENTIC TIMES                          [+ New]  ⚙  │ │
│ ├────────────────────────────────────────────────────────┤ │
│ │ Active Sessions                                        │ │
│ │                                                        │ │
│ │ ▶ React Auth Implementation              2m ago       │ │
│ │   Data Pipeline Optimization             1h ago       │ │
│ │   Deploy Scripts CI/CD                   yesterday    │ │
│ │                                                        │ │
│ │ Archived                                               │ │
│ │   Legacy API Migration                  3 days ago    │ │
│ └────────────────────────────────────────────────────────┘ │
│                                                            │
│ 点击会话 → 右侧展开聊天视图                                 │
│ 桌面: Side-by-side (边栏 272px + 聊天面板)                  │
│ 手机: 全屏聊天 + 返回按钮                                   │
└────────────────────────────────────────────────────────────┘
```

#### 流程 2: 聊天 → 工具调用 → 权限请求

```
┌────────────────────────────────────────────────────────────┐
│ 聊天面板                                                    │
│                                                            │
│ 用户消息 (右对齐, Public Sans)                              │
│ ────────────────────────                                   │
│                                                            │
│ Agent 推理 (左侧细线 + Newsreader italic)                  │
│   "Analyzing request..."                                   │
│                                                            │
│ Agent 回复 (左对齐, 代码块无圆角, ghost border)             │
│   [代码块: surfaceContainerHighest 背景]                    │
│                                                            │
│ 工具调用卡片 (可展开):                                      │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ ▸ bash: npm test                                     │   │
│ │   pending → running... → ✓ completed (47 lines)      │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ 权限请求 (底部弹窗, 非 dialog):                             │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ PERMISSION REQUIRED                                   │   │
│ │ bash: rm -rf node_modules                            │   │
│ │                                                      │   │
│ │ [Allow Once]  [Always Allow]  [Deny]                 │   │
│ └──────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

#### 流程 3: 输入体验 (移动端)

```
┌────────────────────────────────────────────────────────────┐
│ 输入区域 (参考 code.html 的 Command Bar)                    │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Instruct the agent...                     📎  ⬆      │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ ┌─ Commands ─┐ ┌─ History ─┐         Model: GPT-4o       │
│ └────────────┘ └───────────┘                               │
│                                                            │
│ 移动端适配:                                                │
│ - 键盘弹出时输入框固定底部                                  │
│ - 长按 ⬆ 发送；短按展开选项                                │
│ - 滑动手势: → 展开工具调用详情                              │
│ - 语音输入: 系统键盘语音 + Whisper 转写                     │
└────────────────────────────────────────────────────────────┘
```

### 17.3 三面板布局 (桌面端)

> 直接对应 code.html 的设计: 左侧边栏 + 中央聊天 + 右侧上下文

```
┌──────────┬───────────────────────────────┬──────────┐
│          │   聊天面板                     │          │
│  会话    │   (surface: #F9F9F9)          │  上下文  │
│  列表    │                               │  面板    │
│          │   ┌─────────────────────┐     │          │
│ 272px    │   │ 消息流               │     │  320px   │
│  surface │   │                     │     │  surface │
│  Container│   │ Agent 回复           │     │  Container│
│  Low     │   │                     │     │  Low     │
│  #F3F3F3 │   │ 工具卡片             │     │  #F3F3F3 │
│          │   │                     │     │          │
│          │   └─────────────────────┘     │          │
│          │   ┌─────────────────────┐     │          │
│          │   │ Input Command Bar   │     │          │
│          │   └─────────────────────┘     │          │
└──────────┴───────────────────────────────┴──────────┘
```

### 17.4 无障碍 (Accessibility)

| 需求 | 实现 |
|------|------|
| 屏幕阅读器 | Semantics 标签 + LiveRegion (流式更新) |
| 大字体 | 支持 Dynamic Type / 系统字体缩放 |
| 高对比度 | 系统高对比度模式自动切换色彩 |
| 键盘导航 | Desktop 端完整 Tab + Enter 导航 |
| 减少动画 | `MediaQuery.disableAnimations` 尊重系统设置 |
| 色彩对比 | WCAG AA: `on-surface-variant` (#474747) vs `surface` (#F9F9F9) = 7.1:1 |

### 17.5 主题系统

```dart
// 主题切换: 浅色 / 深色 / 系统跟随
ThemeData lightTheme = ThemeData(
  colorScheme: ColorScheme.light(
    surface: OpenAGColors.surface,
    onSurface: OpenAGColors.onSurface,
    primary: OpenAGColors.primary,
    // ...
  ),
  textTheme: openAGTextTheme(),
  cardTheme: CardThemeData(
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
    elevation: 0,
  ),
  inputDecorationTheme: InputDecorationTheme(
    border: UnderlineInputBorder(),
    focusedBorder: UnderlineInputBorder(
      borderSide: BorderSide(color: OpenAGColors.primary, width: 2),
    ),
    filled: true,
    fillColor: OpenAGColors.surfaceContainerHighest,
  ),
  elevatedButtonTheme: ElevatedButtonThemeData(
    style: ElevatedButton.styleFrom(
      backgroundColor: OpenAGColors.primary,
      foregroundColor: OpenAGColors.onPrimary,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
    ),
  ),
);
```

---

## 18. 离线与多设备同步

### 18.1 弱网场景策略

```dart
class ConnectivityStrategy {
  // SSE 重连机制
  // - 断线检测: 心跳超时 (30s)
  // - 重连间隔: 指数退避 (1s, 2s, 4s, 8s, 最大 60s)
  // - 重连后: Last-Event-ID header 恢复断点
  // - 连续失败 10 次: 降级为 HTTP 轮询 (每 5s)

  // 消息队列缓冲
  // - 离线时用户输入存入 Hive 队列
  // - 恢复连接后按序重放
  // - 冲突检测: 服务端时间戳 vs 客户端时间戳

  // 本地缓存策略
  // - 会话列表: 缓存最近 50 条，24h TTL
  // - 消息内容: 缓存最近 3 条会话的完整消息
  // - 缓存失效: SSE 事件触发增量更新
}
```

### 18.2 多设备同步

```
挑战: SQLite WAL 是单机多进程同步，不解决跨设备问题

方案: Server 作为 Single Source of Truth
┌─────────────┐         ┌─────────────────┐         ┌─────────────┐
│ Device A    │ ──SSE──→│ OpenCode Server │ ←──SSE── │ Device B    │
│ (手机)      │         │ (SQLite)        │         │ (桌面)      │
│ Hive 缓存   │ ←─HTTP──│ SyncEvent       │ ──HTTP─→│ Hive 缓存   │
└─────────────┘         └─────────────────┘         └─────────────┘

同步规则:
1. 所有写操作 → Server → 广播 SyncEvent → 其他设备
2. 冲突解决: Server wins (last-write-wins)
3. 会话锁定: 同一会话同时只允许一个设备发送消息
   - 获取锁: POST /session/:id/lock
   - 释放锁: 会话空闲 30s 自动释放
4. 状态同步: 每个设备只缓存自己的活跃会话
```

---

## 19. 竞品格局与市场定位

### 19.1 竞品矩阵

| 产品 | 类型 | 模型 | 移动端 | 开源 | 价格 |
|------|------|------|--------|------|------|
| **OpenCode** | CLI Agent | 多模型 | 无 (目标) | MIT | 免费 |
| **Claude Code** | CLI Agent | Anthropic | 无 | 闭源 | $20-200/mo |
| **Cursor** | IDE Agent | 多模型 | 无 | 闭源 | $20/mo |
| **Windsurf** | IDE Agent | 多模型 | 无 | 闭源 | $15/mo |
| **Aider** | CLI Agent | 多模型 | 无 | Apache | 免费 |
| **Cline** | VS Code Agent | 多模型 | 无 | Apache | 免费 |
| **Continue.dev** | IDE Agent | 多模型 | 无 | Apache | 免费 |
| **Augment** | IDE Agent | 自研 | 无 | 闭源 | $12/mo |
| **Hermes** | 多平台 Agent | 多模型 | 消息平台 | 开源 | 免费 |

### 19.2 市场空白点

```
┌────────────────────────────────────────────────────────────┐
│                    Market Positioning Map                   │
│                                                            │
│                  多模型支持                                  │
│                      ↑                                     │
│      Continue ●     │     ● OpenCode                      │
│      Cline ●        │     ● Aider                          │
│                      │                                      │
│  CLI ───────────────┼────────────── IDE                    │
│                      │                                      │
│      Hermes ●       │     ● Cursor                         │
│                      │     ● Windsurf                       │
│                      │     ● Augment                       │
│                      ↓                                      │
│                  单模型/闭源                                │
│                                                            │
│                      +                                     │
│                      移动端 ← 唯一空白 (OpenAG 目标)        │
└────────────────────────────────────────────────────────────┘
```

**关键发现: 无任何产品提供 "开源 AI Agent + 原生移动端"。** OpenAG 填补这个空白。

### 19.3 差异化定位

| 定位 | 详情 |
|------|------|
| **一句话定位** | "开发者的口袋 AI 编程助手" |
| 核心差异 | 唯一开源 + 多模型 + 原生移动端 |
| 目标用户 | 开发者 (已有 OpenCode 用户)、移动办公开发者 |
| 护城河 | Client/Server 架构 (其他产品需重构) |

---

## 20. 开源社区与治理模型

### 20.1 治理模型

```
推荐: BDFL + 贡献者委员会 (类似 Rust)

OpenAG Core Team (BDFL)
├── 维护者 (Maintainers): 代码审查 + 合并权限
├── 贡献者 (Contributors): 代码贡献
├── 社区成员: Issue + 讨论 + 文档
└── 顾问委员会: 技术方向指导

决策流程:
├── 小改动: Maintainer 直接合并
├── 中等改动: PR + 1 个 Maintainer 审查
├── 大改动: RFC (Request for Comments) + 3 天讨论期
└── 架构变更: ADR (Architecture Decision Record) + 全团队审查
```

### 20.2 Plugin 生态规划

```typescript
// 第三方工具市场 (Phase 4+)
interface PluginManifest {
  name: string
  version: string
  description: string
  author: string
  tools: ToolDefinition[]
  permissions: Permission[]
  repository: string
}

// 注册表
// plugins.opencode.ai (未来)
// - 搜索、安装、评分
// - 安全扫描 (OSV + 静态分析)
// - 版本兼容性检查
```

### 20.3 文档体系

| 文档类型 | 工具 | 内容 |
|----------|------|------|
| API 文档 | OpenAPI Spec (已有 hono-openapi) | 端点、参数、响应 |
| 架构决策 | ADR (Markdown) | 为什么选 Effect、为什么选 Flutter |
| 用户指南 | Docusaurus / Astro (已有 packages/web) | 安装、配置、使用 |
| 贡献指南 | CONTRIBUTING.md (已有) + 扩展 | 代码规范、PR 流程 |
| 变更日志 | CHANGELOG.md + GitHub Releases | 版本历史 |

---

## 21. 合规与数据隐私

### 21.1 GDPR 合规

| 要求 | 实现 |
|------|------|
| 数据最小化 | 仅收集必要数据；本地优先存储 |
| 知情同意 | 首次使用明确告知数据用途；可选遥测 |
| 访问权 | 用户可导出所有会话数据 (已有 /export) |
| 删除权 | 用户可删除所有数据 (已有 /session DELETE) |
| 数据可携 | 导出为标准格式 (JSON/Markdown) |
| 数据驻留 | 自托管 → 数据留在本地/用户选择的区域 |
| 处理者协议 | 云托管模式需签署 DPA |

### 21.2 数据驻留策略

```
方案 A: 本地 (默认) — 数据完全在用户设备
方案 B: 自托管 — 数据在用户选择的 VPS
方案 C: 云托管 — 用户选择区域 (us-east-1 / eu-west-1 / ap-southeast-1)

存储分类:
├── 会话数据: SQLite (本地) → 用户完全控制
├── API Key: 系统密钥链 → 不离开设备
├── 遥测数据: 可选 → 匿名化 → 用户可随时禁用
└── 崩溃报告: 可选 → 自动去敏 (去除文件路径、代码内容)
```

### 21.3 隐私政策框架

```
必需条款:
1. 收集哪些数据 (会话内容、文件路径、工具调用)
2. 数据存储在哪里 (本地 / 用户选择的云端)
3. 数据保留多久 (用户控制)
4. 谁能访问 (仅用户；云托管模式下 OpenAG 团队无法访问)
5. 第三方共享 (LLM Provider: 仅发送必要内容，不存储)
6. 用户权利 (访问、删除、导出)
7. Cookie / 追踪 (仅功能性；无广告追踪)
8. 儿童隐私 (不面向 13 岁以下)
```

---

## 22. 架构决策记录 (ADR)

### ADR-001: 选择 Flutter 而非 React Native

| 项目 | 详情 |
|------|------|
| 状态 | 已接受 |
| 背景 | 需要 iOS + Android + 桌面端客户端 |
| 决策 | 选择 Flutter |
| 理由 | 1) 自绘引擎 UI 一致性；2) 内置桌面端支持；3) CustomPainter 灵活渲染 Markdown/代码/Diff；4) OpenCode 已有 SolidJS Web，不需要 RN 的 JS 复用 |
| 后果 | 团队需学习 Dart；Flutter 包体积 ~15MB；Dart 生态小于 JS |

### ADR-002: 保持 Effect 框架

| 项目 | 详情 |
|------|------|
| 状态 | 已接受 |
| 背景 | Effect v4 beta 学习曲线陡峭，团队招聘困难 |
| 决策 | 保持 Effect 框架 |
| 理由 | 1) 编译时类型安全无法从其他框架获得；2) 结构化并发是 Agent 系统的关键需求；3) Layer 依赖注入使测试变得简单；4) OpenCode 已深度集成，迁移成本极高 |
| 后果 | 招聘需筛选 Effect 经验；文档需额外投入；beta API 可能变化 |

### ADR-003: SQLite vs PostgreSQL

| 项目 | 详情 |
|------|------|
| 状态 | 已接受 |
| 背景 | 需要持久化会话数据 |
| 决策 | SQLite (本地) |
| 理由 | 1) 零配置部署；2) WAL 模式支持跨进程同步；3) 单文件便携；4) 性能足够 (单机场景)；5) 移动端兼容 |
| 后果 | 不支持水平扩展；不适用多服务器集群；云托管方案需考虑替代方案 |

### ADR-004: Client/Server 架构

| 项目 | 详情 |
|------|------|
| 状态 | 已接受 |
| 背景 | 需要支持多端 (TUI/Web/Desktop/Mobile) |
| 决策 | HTTP Server (Hono) + SSE/WebSocket 事件系统 |
| 理由 | 1) 多端共享同一 Agent 核心；2) Flutter 可直接消费 REST API；3) SSE 天然支持流式推送；4) 与 Claude Code 的单体架构差异化 |
| 后果 | Server 进程需持续运行；网络延迟影响移动端体验；需要认证机制 |

### ADR-005: 三层压缩架构

| 项目 | 详情 |
|------|------|
| 状态 | 提议中 |
| 背景 | 当前单层压缩在长对话中信息丢失严重 |
| 决策 | MicroCompact (无 LLM) → AutoCompact (token 阈值) → Full Compact (结构化摘要) |
| 理由 | 1) Claude Code 已验证三层方案有效性；2) MicroCompact 零额外成本；3) 迭代摘要 (借鉴 Hermes) 避免信息丢失 |
| 后果 | 实现复杂度增加；Full Compact 额外 API 调用成本；需充分测试 |

---

## 23. 灾难恢复与备份策略

### 23.1 备份方案

```
自动备份 (本地):
├── SQLite 数据库: 每日快照 → ~/.opencode/backups/
├── 保留策略: 最近 7 天 + 最近 4 周 + 最近 12 月
├── 备份触发: cron 或 Server 空闲时
└── 格式: SQLite VACUUM INTO + gzip

手动备份:
├── opencode export --format=json --output=backup.json
├── 包含: 所有会话、消息、Parts、配置
└── 增量导出: --since=<date>

云备份 (可选):
├── 用户配置 S3 兼容存储
├── 加密: AES-256-GCM (用户密钥)
├── 上传: 增量备份 (仅新增 SyncEvent)
└── 恢复: opencode import --source=s3://...
```

### 23.2 恢复流程

```
场景 1: 数据库损坏
1. 检测: SQLite integrity_check
2. 恢复: 从最近快照还原
3. 重放: 从备份时间点重放 SyncEvent (如果有 WAL)
4. 验证: 会话计数 + 最新消息时间戳

场景 2: 完全丢失 (新设备)
1. 安装 OpenCode
2. opencode import --source=backup.json
3. 重新配置 API Keys
4. LSP 服务器自动重新初始化

场景 3: 移动端数据丢失
1. 重新连接 Server
2. SSE 全量同步 (Server 是 Source of Truth)
3. 本地缓存重建
```

---

## 24. 更新后的风险评估

### 24.1 扩展风险矩阵

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|---------|
| Effect v4 beta API 不稳定 | 中 | 高 | 锁定版本；关键路径提供 fallback |
| 三层压缩增加 API 成本 | 高 | 中 | 分级触发；MicroCompact 无 LLM 调用 |
| Flutter SSE 兼容性 | 低 | 中 | 多 SSE 库备选；降级为轮询 |
| 终端模拟性能 | 中 | 低 | 延后实现；WebView + xterm.js 备选 |
| Agent Teams 复杂度爆炸 | 高 | 中 | 渐进式实现；先 2 agent 协作 |
| Dart SDK 生成质量 | 低 | 低 | 基于 OpenAPI spec；手动调整 |
| **Effect 招聘困难** | 高 | 中 | 编写内部 Effect 培训材料；核心模块由资深开发者维护 |
| **Vercel AI SDK 锁定** | 低 | 高 | 抽象 Provider 接口；保持可直接替换的能力 |
| **LLM Provider API Breaking Change** | 中 | 中 | transform 层隔离变更；快速跟随更新 |
| **Flutter/Dart 生态限制** | 低 | 低 | 核心库稳定；缺失库可用 FFI + 平台通道 |
| **Claude Code 反编译 IP** | 低 | 高 | 仅借鉴算法思路，不复制代码；所有实现独立编写 |
| **安全漏洞 (SSE 注入)** | 中 | 高 | 输入验证 + CSP + 安全审计 |
| **GDPR 合规延迟** | 低 | 中 | 自托管模式天然合规；云托管需法务审查 |

---

## 25. 功能规划与实现路线图

### 25.1 核心功能清单

#### A. Agent 能力 (Server 端增强)

| # | 功能 | 优先级 | 预计工期 | 依赖 |
|---|------|--------|---------|------|
| A1 | 三层渐进压缩 | P0 | 2 周 | 无 |
| A2 | 工具并发分区 | P0 | 1 周 | 无 |
| A3 | PreToolUse/PostToolUse hooks | P1 | 1 周 | 无 |
| A4 | CacheSafeParams | P1 | 1 周 | 无 |
| A5 | ToolSearchTool 延迟加载 | P1 | 1 周 | A2 |
| A6 | 技能自动学习 | P1 | 2 周 | 无 |
| A7 | 多层权限引擎 | P2 | 2 周 | A3 |
| A8 | Agent Teams (初版) | P2 | 3 周 | A4 |
| A9 | Provider fallback chain | P1 | 1 周 | 无 |
| A10 | 提示注入防护 | P1 | 3 天 | 无 |
| A11 | 跨会话搜索 | P2 | 1 周 | SQLite FTS5 |
| A12 | 迭代压缩摘要 | P0 | 1 周 | A1 |

#### B. Flutter 客户端功能

| # | 功能 | 优先级 | 预计工期 | 依赖 |
|---|------|--------|---------|------|
| B1 | 服务器连接管理 | P0 | 1 周 | 无 |
| B2 | 会话列表 + 创建 | P0 | 1 周 | B1 |
| B3 | 聊天界面 (流式) | P0 | 2 周 | B2 |
| B4 | 工具调用可视化 | P0 | 1 周 | B3 |
| B5 | 权限请求处理 | P0 | 1 周 | B3 |
| B6 | Markdown + 代码渲染 | P1 | 1 周 | B3 |
| B7 | Diff 可视化 | P1 | 1 周 | B3 |
| B8 | 文件浏览 | P2 | 1 周 | B1 |
| B9 | Provider/模型切换 | P1 | 1 周 | B1 |
| B10 | 设置页面 | P1 | 1 周 | B1 |
| B11 | 推送通知 | P2 | 1 周 | B1 |
| B12 | 终端模拟 (PTY) | P3 | 2 周 | B1 |
| B13 | 桌面端适配 | P2 | 1 周 | B3 |
| B14 | 离线缓存 | P3 | 1 周 | B2 |
| B15 | 多服务器管理 | P2 | 1 周 | B1 |

#### C. 基础设施

| # | 功能 | 优先级 | 预计工期 |
|---|------|--------|---------|
| C1 | OpenAPI 规范完善 | P0 | 1 周 |
| C2 | Dart SDK 代码生成 | P1 | 1 周 |
| C3 | CI/CD (Flutter) | P1 | 3 天 |
| C4 | 认证/OAuth 增强 | P1 | 1 周 |

### 25.2 实现路线图

```
┌─────────────────────────────────────────────────────────────┐
│                     Timeline (24 Weeks)                      │
├─────────┬───────────────────────────────────────────────────┤
│ Phase 1 │ Week 1-4: 基础增强                                │
│         │ ├── A2 工具并发分区                                │
│         │ ├── A10 提示注入防护                               │
│         │ ├── A9 Provider fallback chain                    │
│         │ ├── A3 PreToolUse/PostToolUse hooks               │
│         │ └── C1 OpenAPI 规范完善                           │
├─────────┼───────────────────────────────────────────────────┤
│ Phase 2 │ Week 5-10: 核心算法 + Flutter MVP                 │
│         │ ├── A1+A12 三层渐进压缩 + 迭代摘要                 │
│         │ ├── A4 CacheSafeParams                            │
│         │ ├── A5 ToolSearchTool                             │
│         │ ├── B1 服务器连接管理                              │
│         │ ├── B2 会话列表                                   │
│         │ ├── B3 聊天界面 (流式)                             │
│         │ ├── B4 工具调用可视化                              │
│         │ └── C2 Dart SDK 代码生成                           │
├─────────┼───────────────────────────────────────────────────┤
│ Phase 3 │ Week 11-16: 高级特性 + Flutter 完善               │
│         │ ├── A6 技能自动学习                               │
│         │ ├── A7 多层权限引擎                               │
│         │ ├── A11 跨会话搜索                                │
│         │ ├── B5 权限请求处理                               │
│         │ ├── B6 Markdown + 代码渲染                        │
│         │ ├── B7 Diff 可视化                                │
│         │ ├── B9 Provider/模型切换                          │
│         │ └── B10 设置页面                                   │
├─────────┼───────────────────────────────────────────────────┤
│ Phase 4 │ Week 17-24: Agent Teams + Flutter 完整版          │
│         │ ├── A8 Agent Teams                                │
│         │ ├── B8 文件浏览                                   │
│         │ ├── B11 推送通知                                   │
│         │ ├── B13 桌面端适配                                │
│         │ ├── B12 终端模拟                                   │
│         │ ├── B14 离线缓存                                   │
│         │ ├── B15 多服务器管理                               │
│         │ └── C3+C4 CI/CD + Auth 增强                       │
└─────────┴───────────────────────────────────────────────────┘
```

### 10.3 技术风险评估

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|---------|
| Effect v4 beta API 不稳定 | 中 | 高 | 锁定版本；关键路径提供 fallback |
| 三层压缩增加 API 成本 | 高 | 中 | 分级触发；MicroCompact 无 LLM 调用 |
| Flutter SSE 兼容性 | 低 | 中 | 多 SSE 库备选；降级为轮询 |
| 终端模拟性能 | 中 | 低 | 延后实现；WebView + xterm.js 备选 |
| Agent Teams 复杂度爆炸 | 高 | 中 | 渐进式实现；先 2 agent 协作 |
| Dart SDK 生成质量 | 低 | 低 | 基于 OpenAPI spec；手动调整 |

---

## 26. 结论

### 26.1 核心结论

**OpenCode 是构建 Claude Code 级 Agent + Flutter 应用的最佳基础平台。** 理由如下：

1. **Client/Server 架构** 是独一无二的差异化优势。Claude Code 是单体 CLI，Hermes 是 Gateway 模式，只有 OpenCode 提供了 REST API + SSE/WS 事件系统，天然支持多端 client。

2. **25+ Provider 支持** 通过 Vercel AI SDK 实现，远超 Claude Code (仅 Anthropic) 和 Hermes (15+)，是真正的 Provider-agnostic 平台。

3. **Effect 框架** 提供了 Claude Code 和 Hermes 都不具备的编译时类型安全和结构化并发，代码质量上限更高。

4. **SQLite + WAL** 的跨进程同步能力是 Hermes 的 Python 状态管理无法比拟的。

### 26.2 关键差距与弥补路径

| 差距 | 来源 | 弥补方式 | 预计工期 |
|------|------|---------|---------|
| 上下文压缩质量 | CC + Hermes | 三层渐进 + 迭代摘要 | 3 周 |
| 工具并发安全 | CC | 分区批处理 | 1 周 |
| 权限系统深度 | CC | 多层权限流水线 | 2 周 |
| 多智能体协作 | CC | Agent Teams | 3 周 |
| 知识学习 | Hermes | 技能自动学习系统 | 2 周 |
| 跨会话搜索 | Hermes | FTS5 + LLM 摘要 | 1 周 |
| Prompt Cache 优化 | CC | CacheSafeParams | 1 周 |
| 移动端客户端 | N/A | Flutter App | 8 周 |

### 26.3 Flutter 应用可行性总结

**技术可行性: ✅ 高 (9/10)**

- OpenCode Server 已提供完整的 REST API + SSE/WS 事件系统
- 无需修改 Server 端核心逻辑即可实现 Flutter MVP
- SSE 事件流 (`message.part.delta`) 天然支持流式文本渲染
- 权限/问题请求通过 SSE 推送到移动端
- mDNS 局域网发现已内置，支持本地开发场景

**商业可行性: ✅ 中高 (7/10)**

- 差异化: 唯一的开源 Claude Code 替代 + 原生移动端
- 市场定位: 开发者的口袋 AI 编程助手
- 变现模式: 自托管 (免费) + 云托管 (付费) + 高级模型 (订阅)

### 26.4 最终建议

1. **立即启动 Phase 1** (工具并发分区 + 提示注入防护 + Provider fallback) — 低风险高回报
2. **Phase 2 并行推进** Server 增强 + Flutter MVP — 利用 Client/Server 架构的天然解耦
3. **保持 Effect 框架** — 不因学习曲线更换框架，长期收益远超短期成本
4. **优先实现三层压缩** — 这是与 Claude Code 最大的算法差距
5. **Flutter 先做移动端** — 桌面端已有 Tauri/Electron，移动端是空白市场

---

*本报告基于 OpenCode v1.14.17、Claude Code v2.1.88 (反编译)、Hermes v0.10.0 源码分析生成。*
*分析日期: 2026-04-19*
*最后更新: 2026-04-19 (补充安全、性能、测试、合规、Flutter UX 等 15 个缺失章节)*
