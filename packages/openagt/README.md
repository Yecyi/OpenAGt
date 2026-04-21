# OpenCode Core Package

核心 AI 编程智能体引擎，实现基于 Effect Framework 的函数式架构。

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
  - [Effect 集成](#effect-集成)
- [开发](#开发)
- [相关文档](#相关文档)

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Session Layer                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │
│  │   Session   │  │   Message   │  │ Compaction  │                   │
│  │   Service   │  │   V2       │  │   Engine    │                   │
│  └─────────────┘  └─────────────┘  └─────────────┘                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                           Provider Layer                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │
│  │  25+ LLM    │  │  Fallback   │  │   Error    │                   │
│  │  Providers  │  │   Chain     │  │  Handling  │                   │
│  └─────────────┘  └─────────────┘  └─────────────┘                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                           Tool Layer                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │
│  │  Partition  │  │  Registry   │  │  Truncate   │                   │
│  │             │  │             │  │             │                   │
│  │ Safe/Unsafe │  │ Tool defs   │  │ Result cut  │                   │
│  └─────────────┘  └─────────────┘  └─────────────┘                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                      Infrastructure Layer                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │     Bus     │  │   Sync      │  │  Sandbox    │  │   Config    │ │
│  │   (PubSub) │  │   Event     │  │   Broker    │  │   Service   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## 核心模块

### Session 模块

管理会话状态、消息和上下文压缩。

| 文件 | 描述 |
|------|------|
| `session.ts` | Session Service，CRUD 操作 |
| `message-v2.ts` | 消息模型，Part/Info 类型系统 |
| `compaction/auto.ts` | AutoCompact + CircuitBreaker |
| `compaction/importance.ts` | 工具重要性计算 |

**关键类型：**
```typescript
type Info = User | Assistant
type Part = TextPart | ReasoningPart | ToolPart | FilePart | ...
```

### Provider 模块

支持 25+ LLM Provider 的动态加载和降级。

| 文件 | 描述 |
|------|------|
| `provider.ts` | Provider 初始化、模型加载 |
| `fallback.ts` | 降级链状态机 |
| `error.ts` | API 错误解析 |
| `schema.ts` | Provider/Model 类型定义 |

**支持 Provider：**
- Anthropic, OpenAI, Google Vertex, Amazon Bedrock
- Azure, OpenRouter, GitLab, Cloudflare Workers AI
- 等等 (见 `BUNDLED_PROVIDERS`)

### Tool 模块

工具注册、执行和并发控制。

| 文件 | 描述 |
|------|------|
| `partition.ts` | Safe/Unsafe 工具分区 |
| `registry.ts` | 工具定义注册表 |
| `tool.ts` | 工具执行器 |
| `truncate.ts` | 结果截断 |

### Security 模块

Shell 命令安全分析。

| 文件 | 描述 |
|------|------|
| `shell-security.ts` | 风险分析、决策 |
| `command-classifier.ts` | 模式匹配分类器 |
| `wrapper-stripper.ts` | Wrapper 移除 |

**检测类别：**
- `injection` - 注入攻击
- `obfuscation` - 混淆
- `parse_integrity` - 解析完整性
- `interpreter_escalation` - 解释器升级
- `filesystem_destruction` - 文件系统破坏
- `network_exfiltration` - 网络渗出
- `sandbox_escape` - 沙箱逃逸
- `environment_hijack` - 环境劫持

### Bus 模块

基于 PubSub 的事件系统。

```typescript
// 发布事件
yield* Bus.publish(SessionCreated, { sessionID, info })

// 订阅事件
yield* Bus.subscribe(SessionCreated)
```

### SyncEvent 模块

事件溯源实现。

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
```

### Sandbox 模块

隔离的命令执行。

| 文件 | 描述 |
|------|------|
| `broker.ts` | IPC Broker 进程管理 |
| `policy.ts` | 沙箱策略解析 |
| `types.ts` | 类型定义 |

### Effect 集成

使用 Effect Framework 实现函数式依赖注入。

```typescript
// 定义 Service
export class SessionService extends Context.Service<SessionService>()("@opencode/Session") {}

// 实现 Layer
export const layer = Layer.effect(
  SessionService,
  Effect.gen(function* () {
    // ...
    return Service.of({ /* impl */ })
  })
)

// 使用
yield* SessionService
```

**关键模式：**
- `makeRuntime` - 创建运行时
- `InstanceState` - 每实例状态
- `Effect.cached` - 去重
- `Instance.bind` - ALS 上下文捕获

## 开发

```bash
# 类型检查
bun typecheck

# 运行测试
bun test packages/opencode

# 构建
bun build ./src/index.ts --outdir ./dist --target bun
```

## 相关文档

- [Effect 框架指南](./src/effect/README.md)
- [ACP 协议实现](./src/acp/README.md)
- [Sync 事件系统](./src/sync/README.md)
