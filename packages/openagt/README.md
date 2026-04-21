# OpenAGt Core Package

核心 AI 编程智能体引擎，基于 TypeScript/Bun + Effect Framework 构建的函数式架构。

---

## 目录

- [架构概览](#架构概览)
- [核心模块](#核心模块)
  - [Session 模块](#session-模块)
  - [Provider 模块](#provider-模块)
  - [Tool 模块](#tool-模块)
  - [Security 模块](#security-模块)
  - [Bus 模块](#bus-模块)
  - [SyncEvent 模块](#syncevent-模块)
  - [Sandbox 模块](#sandbox-模块)
  - [Storage 模块](#storage-模块)
  - [Config 模块](#config-模块)
  - [Effect 集成](#effect-集成)
- [三层压缩算法](#三层压缩算法)
- [工具并发分区](#工具并发分区)
- [开发](#开发)
- [相关文档](#相关文档)

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Session Layer                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Session   │  │   Message   │  │ Compaction  │  │   System    │    │
│  │   Service   │  │   V2       │  │   Engine   │  │   Prompt    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Provider Layer                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  25+ LLM   │  │  Fallback  │  │   Error     │  │   Models    │    │
│  │  Providers  │  │   Chain    │  │  Handling   │  │  Database   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Tool Layer                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  Partition  │  │  Registry  │  │  Truncate  │  │   LSP      │    │
│  │             │  │             │  │             │  │  MCP/MCP   │    │
│  │ Safe/Unsafe │  │ Tool defs   │  │ Result cut  │  │  External  │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Infrastructure Layer                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │     Bus    │  │    Sync     │  │  Sandbox    │  │   Config    │    │
│  │  (PubSub) │  │   Event     │  │   Broker   │  │   Service   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  Storage   │  │ Permission  │  │   Server    │  │    CLI      │    │
│  │  SQLite   │  │   Engine    │  │  Hono+SSE  │  │  Commands   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 核心模块

### Session 模块

管理会话状态、消息和上下文压缩，是 Agent 的核心驱动模块。

| 文件 | 描述 |
|------|------|
| `session.ts` | Session Service，CRUD 操作 |
| `message-v2.ts` | 消息模型，Part/Info 类型系统 |
| `message.ts` | 消息基础类型定义 |
| `schema.ts` | Session 相关 Schema 定义 |
| `prompt.ts` | 主循环：模型调用、工具调度、压缩触发 |
| `processor.ts` | 消息处理器 |
| `compaction.ts` | 压缩调度器 |
| `compaction/micro.ts` | MicroCompact — 时间阈值压缩 |
| `compaction/auto.ts` | AutoCompact + CircuitBreaker |
| `compaction/full.ts` | Full Compact — LLM 摘要 |
| `compaction/importance.ts` | 工具重要性计算 |
| `summary.ts` | 会话摘要生成 |
| `retry.ts` | 请求重试逻辑 |
| `overflow.ts` | 上下文溢出处理 |
| `task-runtime.ts` | Task 工具运行时 |
| `system.ts` | 系统配置加载 |
| `system-prompt.ts` | 系统提示词构建 |
| `memory.ts` / `memory-service.ts` | 记忆管理 |
| `memory-context.ts` | 记忆上下文注入 |
| `instruction.ts` | 指令管理 |
| `run-state.ts` | 运行状态追踪 |
| `status.ts` | Session 状态 |
| `projectors.ts` | 事件投影器 |
| `todo.ts` | Todo 列表管理 |
| `revert.ts` | 修改回退 |

**关键类型：**
```typescript
type Info = User | Assistant
type Part = TextPart | ReasoningPart | ToolPart | FilePart | SnapshotPart | CompactionPart | StepFinishPart
```

### Provider 模块

支持 25+ LLM Provider 的动态加载和降级。

| 文件 | 描述 |
|------|------|
| `provider.ts` | Provider 初始化、模型加载 |
| `fallback.ts` | 旧版降级链 |
| `fallback-service.ts` | 新版 Fallback Service 实现 |
| `error.ts` | API 错误解析 |
| `schema.ts` | Provider/Model 类型定义 |
| `models.ts` | 内置模型数据库 |
| `index.ts` | 导出入口 |

**支持 Provider：**
- Anthropic, OpenAI, Google Vertex, Amazon Bedrock
- Azure, OpenRouter, GitLab, Cloudflare Workers AI
- Mistral, Groq, DeepInfra, Cerebras, Cohere
- xAI, TogetherAI, Perplexity, Vercel AI, Alibaba
- GitHub Copilot (自定义加载器)
- Venice AI, 等等 (见 `BUNDLED_PROVIDERS`)

### Tool 模块

工具注册、执行和并发控制。

| 文件 | 描述 |
|------|------|
| `index.ts` | 工具导出入口 |
| `registry.ts` | 工具定义注册表 |
| `tool.ts` | 工具执行器 |
| `partition.ts` | Safe/Unsafe 工具分区 (并发控制) |
| `path-overlap.ts` | 路径冲突检测 |
| `truncate.ts` | 工具结果截断 |
| `truncation-dir.ts` | 目录级截断策略 |
| `bash.ts` | Bash 工具实现 |
| `edit.ts` | Edit 工具实现 |
| `write.ts` | Write 工具实现 |
| `read.ts` | Read 工具实现 |
| `glob.ts` | Glob 工具实现 |
| `grep.ts` | Grep 工具实现 |
| `codesearch.ts` | 代码搜索工具 |
| `webfetch.ts` | WebFetch 工具 |
| `websearch.ts` | WebSearch 工具 |
| `task.ts` / `task_list.ts` / `task_get.ts` / `task_stop.ts` / `task_wait.ts` | Task 工具族 |
| `lsp.ts` | LSP 工具 |
| `question.ts` | Question 工具 |
| `skill.ts` | Skill 工具 |
| `plan.ts` | Plan 工具 |
| `todo.ts` | Todo 工具 |
| `apply_patch.ts` | Patch 应用工具 |
| `multiedit.ts` | 多文件编辑 |
| `mcp-exa.ts` | MCP 集成 |
| `invalid.ts` | 无效工具处理 |
| `external-directory.ts` | 外部目录支持 |

**工具分类：**
- **Safe (可并发)**：`read`, `glob`, `grep`, `codesearch`, `webfetch`, `websearch`, `lsp`, `question`, `skill`
- **Unsafe (需串行)**：`bash`, `edit`, `write`, `task`, `todo`, `plan`, `apply_patch`, `multiedit`

### Security 模块

Shell 命令安全分析，防护 prompt injection 和命令注入攻击。

| 文件 | 描述 |
|------|------|
| `shell-security.ts` | Shell 命令安全分析入口 |
| `command-classifier.ts` | 风险模式匹配分类器 |
| `wrapper-stripper.ts` | Wrapper 移除 (noglob, semicolons 等) |
| `injection.ts` | Prompt injection 扫描与净化 |
| `dangers.ts` | 危险命令定义 |
| `dangerous-command-detector.ts` | 危险命令检测器 |
| `shell-review.ts` | Shell 审查逻辑 |
| `validators.ts` | 输入验证器 |
| `env-sanitizer.ts` | 环境变量净化 |
| `powershell.ts` | PowerShell 命令分析 |
| `powershell-ast.ts` | PowerShell AST 分析 |

**检测类别：**
- `injection` — 注入攻击
- `obfuscation` — 命令混淆
- `parse_integrity` — 解析完整性破坏
- `interpreter_escalation` — 解释器升级
- `filesystem_destruction` — 文件系统破坏
- `network_exfiltration` — 网络渗出
- `sandbox_escape` — 沙箱逃逸
- `environment_hijack` — 环境劫持

**防护分级：**
| 级别 | 处理方式 |
|------|---------|
| high | 阻断，抛出 `ContextOverflowError` |
| medium | 净化内容 + 警告 |
| low | 净化，不阻断执行 |

### Bus 模块

基于 PubSub 的进程内事件总线。

| 文件 | 描述 |
|------|------|
| `index.ts` | Bus Service 定义与 Layer |
| `bus-event.ts` | 事件定义 |
| `global.ts` | GlobalBus 全局事件 |

```typescript
// 发布事件
yield* Bus.publish(SessionCreated, { sessionID, info })

// 订阅事件
yield* Bus.subscribe(SessionCreated)

// 全局事件
yield* GlobalBus.publish(Event)
```

### SyncEvent 模块

事件溯源实现，支持多设备同步和会话回放。

```typescript
// 定义事件
const Created = SyncEvent.define({
  type: "session.created",
  version: 1,
  aggregate: "sessionID",
  schema: z.object({ sessionID, info })
})

// 运行事件
SyncEvent.run(Created, { sessionID, info })

// 重放事件
SyncEvent.replay(serializedEvent)

// 批量重放
SyncEvent.replayAll(events)
```

详见 [SyncEvent 详细文档](./src/sync/README.md)。

### Sandbox 模块

隔离的命令执行，通过 IPC Broker 实现进程级沙箱。

| 文件 | 描述 |
|------|------|
| `broker.ts` | IPC Broker — 进程间通信管理 |
| `broker-main.ts` | Broker 主进程入口 |
| `policy.ts` | 沙箱策略解析 |
| `protocol.ts` | 通信协议定义 |
| `types.ts` | 类型定义 |
| `backends.ts` | 后端支持 |
| `process-sandbox.ts` | 进程沙箱实现 |

### Storage 模块

SQLite 数据库管理，使用 Drizzle ORM。

| 文件 | 描述 |
|------|------|
| `storage.ts` | Storage Service |
| `schema.ts` | Schema 类型定义 |
| `schema.sql.ts` | Drizzle SQL Schema |
| `db.ts` | 数据库初始化 |
| `db.bun.ts` | Bun SQLite 实现 |
| `db.node.ts` | Node.js SQLite 实现 |
| `index.ts` | 导出入口 |
| `json-migration.ts` | JSON 迁移工具 |

### Config 模块

配置管理，支持 `opencode.json` 和环境变量。

| 文件 | 描述 |
|------|------|
| `config.ts` | 主配置入口 |
| `agent.ts` | Agent 配置 |
| `provider.ts` | Provider 配置 |
| `command.ts` | 命令配置 |
| `model-id.ts` | 模型 ID 类型 |
| `permission.ts` | 权限配置 |
| `lsp.ts` | LSP 配置 |
| `mcp.ts` | MCP 配置 |
| `skills.ts` | Skills 配置 |
| `formatter.ts` | 格式化器配置 |
| `keybinds.ts` | 快捷键配置 |
| `parse.ts` | 配置解析 |
| `index.ts` | 导出入口 |

### Effect 集成

使用 Effect Framework 实现函数式依赖注入。

```typescript
// 定义 Service
export class SessionService extends Context.Service<SessionService>()("@opencode/Session") {}

// 实现 Layer
export const layer = Layer.effect(
  SessionService,
  Effect.gen(function* () {
    const db = yield* Database
    const bus = yield* BusService
    return Service.of({
      create: (input) => Effect.gen(function* () {
        const session = yield* Effect.promise(() => db.insert(...))
        yield* bus.publish(SessionCreated, { sessionID: session.id })
        return session
      })
    })
  })
)

// 使用
yield* SessionService
```

**关键模式：**
- `makeRuntime` — 创建 Effect 运行时
- `InstanceState` — 每实例作用域状态
- `MemoMap` — Layer 去重缓存
- `Effect.cached` — 结果去重
- `Instance.bind` — ALS 上下文捕获

---

## 三层压缩算法

OpenAGt 实现渐进式上下文压缩，在保证关键信息不丢失的同时最大化 Token 节省：

```
Token 使用量
│
│ 100% ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
│
│                                    ████████████████████████████
│ 0%  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
│     Micro    Auto        Full          Blocking
│     Compact  Compact     Compact       Limit
│     ($0)     ($0)       (~$0.03-0.09)
│     简单丢弃  内存瑶佺       LLM 摘要
```

| 层级 | 触发条件 | 成本 | 描述 |
|------|---------|------|------|
| **MicroCompact** | 工具结果超过 5 分钟 | $0 | 基于时间阈值丢弃旧结果 |
| **AutoCompact** | 剩余 token < bufferTokens | $0 | 基于 token 预算评估，电路熔断器保护 |
| **Full Compact** | 压缩比 > 1 (溢出) | ~$0.03-0.09 | LLM 摘要，需重建时重新读取 |

**压缩优先级公式：**
```
priority = log(age_minutes + 1) × (11 - importance) + contentWeight × 0.5
```

---

## 工具并发分区

```
工具调用序列: [read, glob, edit, bash, grep, write]
                      │
                      ▼
        ┌─────────────────────────┐
        │     ToolPartition        │
        │ partitionToolCalls()     │
        └───────────┬─────────────┘
                    │
      ┌─────────────┴─────────────┐
      ▼                           ▼
┌───────────┐              ┌───────────┐
│Safe Batch │              │ Unsafe    │
│(并行执行)  │              │(串行执行)  │
│ ┌───────┐ │              │ ┌───────┐ │
│ │read   │ │              │ │edit   │ │
│ │glob   │ │              │ │bash   │ │
│ │grep   │ │              │ │write  │ │
│ └───────┘ │              │ │task   │ │
└───────────┘              └───────────┘
```

**路径冲突检测：**
- 提取工具输入中的文件路径
- 检测同目录或相同文件的访问冲突
- 冲突的 unsafe 工具等待 blocker 完成

---

## 开发

```bash
# 类型检查 (从包目录运行)
bun typecheck

# 运行测试 (从包目录运行)
bun test packages/openagt

# 构建
bun build ./src/index.ts --outdir ./dist --target bun
```

---

## 相关文档

- [Effect Framework](../effect/README.md) — Effect 框架集成
- [ACP 协议](../acp/README.md) — Agent Client Protocol 实现
- [SyncEvent 事件溯源](../sync/README.md) — 会话同步与事件溯源
- [LLM Provider](../provider/README.md) — 多 Provider 抽象与降级链
- [Bus 事件总线](../bus/README.md) — 进程内 PubSub 事件总线
- [MCP 管理器](../mcp/README.md) — MCP 服务器连接与 OAuth 认证
- [LSP 语言服务](../lsp/README.md) — LSP 服务器与诊断
- [根目录 README](../../README.md) — 项目概览
