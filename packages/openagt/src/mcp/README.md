# MCP (Model Context Protocol) 模块

MCP 服务器管理，支持本地和远程 MCP 服务器连接、OAuth 认证和工具发现。

---

## 目录

- [架构概览](#架构概览)
- [核心类型](#核心类型)
- [连接类型](#连接类型)
- [认证系统](#认证系统)
- [工具与资源](#工具与资源)
- [事件系统](#事件系统)
- [配置](#配置)
- [使用示例](#使用示例)
- [调试](#调试)

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MCP 架构                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      MCP Service (Effect Layer)                   │   │
│  │  ┌───────────────────────────────────────────────────────────┐  │   │
│  │  │  MCPClient[] — 已连接的 MCP 服务器实例                  │  │   │
│  │  └───────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│        ┌───────────────────────────┼───────────────────────────┐        │
│        │                           │                           │        │
│        ▼                           ▼                           ▼        │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐      │
│  │  Stdio     │         │ Streamable  │         │   SSE      │      │
│  │  Transport │         │   HTTP     │         │  Transport │      │
│  │ (本地进程) │         │ (远程 HTTP) │         │ (远程 SSE) │      │
│  └─────────────┘         └─────────────┘         └─────────────┘      │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    MCP Auth (OAuth 1.0a / PKCE)                 │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │   │
│  │  │ OAuthProvider│  │ OAuthCallback│  │ Auth Storage │        │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 核心类型

```typescript
// MCP 服务器状态
type Status =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string }

// MCP Service 接口
interface Interface {
  readonly status: () => Effect<Record<string, Status>>
  readonly clients: () => Effect<Record<string, MCPClient>>
  readonly tools: () => Effect<Record<string, Tool>>          // AI SDK Tool
  readonly prompts: () => Effect<Record<string, PromptInfo & { client: string }>>
  readonly resources: () => Effect<Record<string, ResourceInfo & { client: string }>>
  readonly add: (name: string, mcp: ConfigMCP.Info) => Effect<{ status: Record<string, Status> | Status }>
  readonly connect: (name: string) => Effect<void>
  readonly disconnect: (name: string) => Effect<void>
  readonly getPrompt: (clientName: string, name: string, args?: Record<string, string>) => Effect<...>
  readonly readResource: (clientName: string, resourceUri: string) => Effect<...>
  readonly startAuth: (mcpName: string) => Effect<{ authorizationUrl: string; oauthState: string }>
  readonly authenticate: (mcpName: string) => Effect<Status>
  readonly finishAuth: (mcpName: string, authorizationCode: string) => Effect<Status>
  readonly removeAuth: (mcpName: string) => Effect<void>
  readonly supportsOAuth: (mcpName: string) => Effect<boolean>
  readonly hasStoredTokens: (mcpName: string) => Effect<boolean>
  readonly getAuthStatus: (mcpName: string) => Effect<AuthStatus>
}

type AuthStatus = "authenticated" | "expired" | "not_authenticated"
```

---

## 连接类型

### 1. Local (Stdio)

通过子进程启动本地 MCP 服务器，使用标准输入输出通信：

```typescript
{
  type: "local",
  command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
  environment: { DEBUG: "1" },
  timeout: 30_000,
}
```

特点：
- 命令通过 `ChildProcess.spawn` 启动
- 环境变量从 `process.env` 继承，可覆盖或添加
- stderr 被收集到日志

### 2. Remote (HTTP/SSE)

连接远程 MCP 服务器，支持两种传输协议：

```typescript
{
  type: "remote",
  url: "https://mcp.example.com/sse",
  headers: { Authorization: "Bearer xxx" },
  oauth: {
    clientId: "xxx",
    clientSecret: "xxx",
    scope: "read write",
    redirectUri: "http://localhost:3000/callback",
  },
  timeout: 30_000,
}
```

**传输协议优先级：**
1. `StreamableHTTP` — 主要协议，支持 OAuth
2. `SSE` — 备选协议

---

## 认证系统

### OAuth 1.0a + PKCE

MCP Service 实现完整的 OAuth 1.0a 认证流程：

```
1. 用户触发认证
         │
         ▼
2. startAuth() → 启动本地回调服务器
         │
         ▼
3. 创建 OAuth 状态码 (CSRF 防护)
         │
         ▼
4. 打开浏览器 → MCP 服务器授权页面
         │
         ▼
5. 用户授权 → 重定向到本地回调服务器
         │
         ▼
6. finishAuth() → 交换授权码为 Token
         │
         ▼
7. Token 存储到 Auth Service
```

**认证命令：**
```bash
opencode mcp auth <server-name>
```

**状态检查：**
```typescript
yield* MCP.Service.getAuthStatus(mcpName)
// → "authenticated" | "expired" | "not_authenticated"
```

---

## 工具与资源

### 工具发现

MCP 服务器的 `listTools()` 被自动转换为 AI SDK 的 `Tool` 类型：

```typescript
// MCP Tool → AI SDK Tool
function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Tool {
  return dynamicTool({
    description: mcpTool.description ?? "",
    inputSchema: jsonSchema(schema),
    execute: async (args) => {
      return client.callTool({
        name: mcpTool.name,
        arguments: args as Record<string, unknown>,
      }, CallToolResultSchema, { timeout })
    },
  })
}
```

### 资源读取

```typescript
// 读取 MCP 资源
const resource = yield* MCP.Service.readResource(clientName, "file:///path/to/resource")

// 获取 Prompt
const prompt = yield* MCP.Service.getPrompt(clientName, "my-prompt", { arg: "value" })
```

### 工具名称空间

MCP 工具被注册为 `{sanitized_server_name}_{sanitized_tool_name}`：

```typescript
// 服务器 "filesystem-server" 的 "read_file" 工具
// → "filesystem_server_read_file"
```

---

## 事件系统

```typescript
// 工具列表变更事件
export const ToolsChanged = BusEvent.define(
  "mcp.tools.changed",
  z.object({
    server: z.string(),
  }),
)

// 浏览器打开失败事件
export const BrowserOpenFailed = BusEvent.define(
  "mcp.browser.open.failed",
  z.object({
    mcpName: z.string(),
    url: z.string(),
  }),
)
```

当 MCP 服务器发送 `tools/list_changed` 通知时，自动更新缓存并发布事件。

---

## 配置

### opencode.json

```json
{
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "./"],
      "enabled": true
    },
    "github": {
      "type": "remote",
      "url": "https://api.github.com/mcp",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      },
      "oauth": {
        "clientId": "xxx",
        "clientSecret": "xxx",
        "scope": "repo user"
      }
    },
    "slack": {
      "type": "remote",
      "url": "https://slack.com/mcp",
      "timeout": 60_000
    }
  }
}
```

### 环境变量

```bash
GITHUB_TOKEN=ghp_xxx  # GitHub MCP 服务器认证
```

---

## 使用示例

### 连接 MCP 服务器

```typescript
import { MCP } from "@/mcp"

// 获取所有已连接服务器的 MCP 工具
const tools = yield* MCP.Service.tools()

// 读取资源
const resource = yield* MCP.Service.readResource("github", "github://user/repo")

// 获取 Prompt
const prompt = yield* MCP.Service.getPrompt("github", "review-pr", { pr_number: "123" })
```

### 动态添加服务器

```typescript
yield* MCP.Service.add("new-server", {
  type: "remote",
  url: "https://new-server.com/mcp",
})
```

### 认证流程

```typescript
// 开始认证
const { authorizationUrl, oauthState } = yield* MCP.Service.startAuth("github")

// 完成认证
const status = yield* MCP.Service.finishAuth("github", authorizationCode)

// 检查状态
const authStatus = yield* MCP.Service.getAuthStatus("github")
```

---

## 调试

### 查看 MCP 服务器状态

```typescript
const status = yield* MCP.Service.status()
console.log(status)
// {
//   "filesystem": { status: "connected" },
//   "github": { status: "needs_auth" },
//   "slack": { status: "failed", error: "Connection refused" }
// }
```

### 查看已发现工具

```typescript
const tools = yield* MCP.Service.tools()
console.log(Object.keys(tools))
// ["filesystem_read_file", "filesystem_list_directory", "github_get_pr", ...]
```

---

## 相关文档

- [MCP 规范](https://modelcontextprotocol.io/)
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- [主 README](../../README.md)
- [Effect Framework](../effect/)
- [Bus 模块](../bus/)
