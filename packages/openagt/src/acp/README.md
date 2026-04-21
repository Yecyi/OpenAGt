# ACP (Agent Client Protocol) 实现

实现遵循 [ACP 规范](https://agentclientprotocol.com/) 的完整协议栈，通过 stdio 与编辑器集成。

---

## 目录

- [架构概览](#架构概览)
- [核心组件](#核心组件)
  - [Agent (`agent.ts`)](#1-agent-agentts)
  - [Client (`client.ts`)](#2-client-clientts)
  - [Session (`session.ts`)](#3-session-sessionts)
  - [Server (`server.ts`)](#4-server-serverts)
- [协议合规性](#协议合规性)
- [使用方式](#使用方式)
- [消息流](#消息流)
- [设计决策](#设计决策)
- [局限性与未来](#局限性与未来)
- [测试](#测试)
- [参考资料](#参考资料)

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ACP 架构                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐         ┌──────────────────┐                        │
│  │   Editor         │         │   opencode acp   │                        │
│  │  (Zed, VS Code) │◀═══════▶│   (stdio)        │                        │
│  └──────────────────┘  JSON   └──────────────────┘                        │
│                                   │                                        │
│                                   ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                        ACP Server                                  │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │   │
│  │  │ Agent   │  │ Client  │  │ Session │  │ Server  │           │   │
│  │  │ (接口)  │  │ (操作)  │  │ (状态)  │  │ (生命周期)│           │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                   │                                        │
│                                   ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    @agentclientprotocol/sdk                          │   │
│  │                  (官方协议库)                                       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. Agent (`agent.ts`)

实现 `Agent` 接口，处理智能体核心逻辑。

**职责：**
- 初始化和能力协商
- 会话生命周期 (`session/new`, `session/load`)
- 处理提示并返回响应
- 正确实现 ACP 协议 v1

```typescript
// 伪代码
class ACPAgent implements Agent {
  async initialize(request: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: 1,
      capabilities: this.advertiseCapabilities(),
      serverInfo: { name: "opencode", version: "1.0" }
    }
  }

  async sessionNew(request: SessionNewRequest): Promise<SessionNewResponse> {
    const session = await Session.create({ cwd: request.cwd })
    return { sessionId: session.id }
  }

  async sessionPrompt(request: SessionPromptRequest): Promise<SessionPromptResponse> {
    const session = Session.get(request.sessionId)
    const response = await session.prompt(request.message)
    return { content: response.content, stopReason: "end_turn" }
  }
}
```

### 2. Client (`client.ts`)

实现 `Client` 接口，处理客户端操作。

**职责：**
- 文件操作 (`readTextFile`, `writeTextFile`)
- 权限请求 (当前自动批准)
- 终端支持 (桩实现)

```typescript
// 文件操作
async readTextFile(params: { path: string }): Promise<string> {
  return await Bun.file(params.path).text()
}

async writeTextFile(params: { path: string, content: string }): Promise<void> {
  await Bun.write(params.path, params.content)
}
```

### 3. Session (`session.ts`)

会话状态管理。

**职责：**
- 创建和追踪 ACP 会话
- 映射 ACP 会话到内部 opencode 会话
- 维护工作目录上下文
- 处理 MCP 服务器配置

```typescript
interface ACPSession {
  id: string
  cwd: string
  opencodeSessionId: SessionID
  mcpConfig?: MCPConfig
}
```

### 4. Server (`server.ts`)

ACP 服务器启动和生命周期。

**职责：**
- 通过官方库设置 stdio 上的 JSON-RPC
- 管理 SIGTERM/SIGINT 时的优雅关闭
- 为智能体提供 Instance 上下文

```typescript
// 启动序列
1. 解析命令行参数
2. 创建 Instance 上下文
3. 初始化 ACP Server
4. 注册 JSON-RPC 处理程序
5. 进入主循环 (stdio)
6. 收到关闭信号 → 清理资源 → 退出
```

## 协议合规性

### ✅ 已实现

| 功能 | 状态 | 说明 |
|------|------|------|
| **初始化** | ✅ | 协议版本协商、能力广告 |
| **会话管理** | ✅ | `session/new`, `session/load` |
| **提示处理** | ✅ | `session/prompt` |
| **文件操作** | ✅ | `readTextFile`, `writeTextFile` |
| **权限请求** | ✅ | 自动批准 |

### ⚠️ 部分实现

| 功能 | 状态 | 说明 |
|------|------|------|
| **流式响应** | ⚠️ | 当前返回完整响应而非流式 |
| **工具调用报告** | ⚠️ | 不报告工具执行进度 |

### ❌ 未实现

| 功能 | 状态 | 说明 |
|------|------|------|
| **会话持久化** | ❌ | `session/load` 不恢复完整历史 |
| **模式切换** | ❌ | 无 ask/code 等模式切换 |
| **认证** | ❌ | 无实际认证实现 |
| **终端支持** | ❌ | 仅为占位符 |

## 使用方式

### 命令行

```bash
# 在当前目录启动 ACP 服务器
opencode acp

# 在指定目录启动
opencode acp --cwd /path/to/project

# 启用 QuestionTool
OPENCODE_ENABLE_QUESTION_TOOL=1 opencode acp
```

### Zed 集成

在 `~/.config/zed/settings.json` 中添加：

```json
{
  "agent_servers": {
    "OpenCode": {
      "command": "opencode",
      "args": ["acp"]
    }
  }
}
```

### 编程方式

```typescript
import { ACPServer } from "./acp/server"

const server = await ACPServer.start()
```

## 消息流

```
┌─────────────┐                      ┌─────────────┐
│   Editor    │                      │  opencode   │
│             │                      │    acp      │
└──────┬──────┘                      └──────┬──────┘
       │                                    │
       │── initialize ───────────────────▶ │
       │◀─ initialize/response ────────────│
       │                                    │
       │── session/new ───────────────────▶ │
       │◀─ session/new/response ───────────│
       │   { sessionId: "xxx" }           │
       │                                    │
       │── session/prompt ────────────────▶│
       │   { message: "Hello" }            │
       │◀─ ◄◄◄ stream ◄◄◄ ───────────────│
       │◀─ session/prompt/response ────────│
       │   { content: "Hi!", stopReason }  │
       │                                    │
       │── session/load ──────────────────▶ │
       │◀─ session/load/response ─────────│
```

## 设计决策

### 为什么使用官方库？

使用 `@agentclientprotocol/sdk` 而非自己实现 JSON-RPC：

1. **协议合规性** - 确保符合 ACP 规范
2. **边缘处理** - 库处理边界情况和未来协议版本
3. **维护成本** - 减少我们自己的维护负担
4. **互操作性** - 自动与其他 ACP 客户端兼容

### 清洁架构

每个组件单一职责：

| 组件 | 职责 |
|------|------|
| **Agent** | 协议接口，核心智能体逻辑 |
| **Client** | 客户端操作 (文件、权限) |
| **Session** | 状态管理 |
| **Server** | 生命周期和 I/O |

### 到 OpenCode 的映射

ACP 会话映射到 opencode 内部会话模型：

| ACP 操作 | OpenCode 实现 |
|----------|--------------|
| `session/new` | `Session.create()` |
| `session/prompt` | `SessionPrompt.prompt()` |
| `cwd` 上下文 | `Instance.directory` |
| 工具执行 | `ToolRegistry.execute()` |

## 局限性与未来

### 当前局限

1. **流式响应** - 需要实现 `session/update` 通知
2. **工具可见性** - 报告正在执行的工具
3. **会话持久化** - 保存和恢复完整对话历史
4. **模式支持** - 实现 ask/code 等操作模式
5. **增强权限** - 更复杂的权限处理
6. **终端集成** - 通过 opencode 的 bash 工具支持

### 未来增强

```typescript
// 1. 流式响应
interface SessionUpdateNotification {
  type: "session/update"
  sessionId: string
  delta: ContentDelta[]
}

// 2. 工具调用可见性
interface ToolExecutionNotification {
  type: "tool/executing"
  sessionId: string
  tool: string
  input: Record<string, unknown>
}

// 3. 会话持久化
interface SessionSaveResponse {
  events: SerializedEvent[]
  checkpoint: number
}
```

## 测试

```bash
# 运行 ACP 测试
bun test test/acp.test.ts

# 手动测试 stdio
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}' | opencode acp
```

## 参考资料

- [ACP 规范](https://agentclientprotocol.com/)
- [TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk)
- [协议示例](https://github.com/agentclientprotocol/typescript-sdk/tree/main/src/examples)
- [Bus 模块](../bus/) — 进程内 PubSub 事件总线
