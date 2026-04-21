# Provider 模块

LLM Provider 抽象层，支持 25+ Provider 的动态加载、配置和降级。

---

## 目录

- [架构概览](#架构概览)
- [支持的 Provider](#支持的-provider)
  - [官方支持的 Provider](#官方支持的-provider)
  - [完整列表](#完整列表)
- [核心类型](#核心类型)
- [Provider 初始化流程](#provider-初始化流程)
- [自定义 Provider 加载器](#自定义-provider-加载器)
- [模型选择](#模型选择)
- [错误处理](#错误处理)
- [环境变量](#环境变量)
- [配置示例](#配置示例)
- [调试](#调试)

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Provider 架构                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐                                                      │
│  │   Config       │  ┌─────────────────┐                                │
│  │   + Env       │─▶│   Provider      │                                │
│  │   + Auth      │  │   Service      │                                │
│  └─────────────────┘  └────────┬────────┘                                │
│                                │                                          │
│  ┌─────────────────┐          │  ┌─────────────────┐                   │
│  │   Plugin       │──────────▶│  │  Model         │                   │
│  │   Hooks       │          │  │  Loaders       │                   │
│  └─────────────────┘          │  └────────┬────────┘                   │
│                                │           │                            │
│                                ▼           ▼                             │
│  ┌─────────────────────────────────────────────────────────────┐        │
│  │                    SDK 实例池                                  │        │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐          │        │
│  │  │Anthropic│  │ OpenAI │  │ Vertex │  │ Bedrock│          │        │
│  │  └────────┘  └────────┘  └────────┘  └────────┘          │        │
│  └─────────────────────────────────────────────────────────────┘        │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 支持的 Provider

### 官方支持的 Provider

| Provider | NPM 包 | 特性 |
|----------|--------|------|
| Anthropic | `@ai-sdk/anthropic` | 全功能 |
| OpenAI | `@ai-sdk/openai` | 全功能 |
| Google Vertex | `@ai-sdk/google-vertex` | 区域支持 |
| Amazon Bedrock | `@ai-sdk/amazon-bedrock` | 跨区域推理 |
| Azure | `@ai-sdk/azure` | 企业支持 |
| Google AI | `@ai-sdk/google` | Gemini 系列 |
| OpenRouter | `@openrouter/ai-sdk-provider` | 模型聚合 |
| GitLab | `gitlab-ai-provider` | Duo Workflow |

### 完整列表

```typescript
// packages/opencode/src/provider/provider.ts
const BUNDLED_PROVIDERS: Record<string, () => Promise<...>> = {
  "@ai-sdk/amazon-bedrock":   () => import("@ai-sdk/amazon-bedrock"),
  "@ai-sdk/anthropic":        () => import("@ai-sdk/anthropic"),
  "@ai-sdk/azure":            () => import("@ai-sdk/azure"),
  "@ai-sdk/google":           () => import("@ai-sdk/google"),
  "@ai-sdk/google-vertex":    () => import("@ai-sdk/google-vertex"),
  "@ai-sdk/openai":           () => import("@ai-sdk/openai"),
  "@ai-sdk/openai-compatible":() => import("@ai-sdk/openai-compatible"),
  "@openrouter/ai-sdk-provider": () => import("@openrouter/ai-sdk-provider"),
  "@ai-sdk/xai":              () => import("@ai-sdk/xai"),
  "@ai-sdk/mistral":          () => import("@ai-sdk/mistral"),
  "@ai-sdk/groq":             () => import("@ai-sdk/groq"),
  "@ai-sdk/deepinfra":        () => import("@ai-sdk/deepinfra"),
  "@ai-sdk/cerebras":         () => import("@ai-sdk/cerebras"),
  "@ai-sdk/cohere":           () => import("@ai-sdk/cohere"),
  "@ai-sdk/gateway":          () => import("@ai-sdk/gateway"),
  "@ai-sdk/togetherai":       () => import("@ai-sdk/togetherai"),
  "@ai-sdk/perplexity":       () => import("@ai-sdk/perplexity"),
  "@ai-sdk/vercel":           () => import("@ai-sdk/vercel"),
  "@ai-sdk/alibaba":          () => import("@ai-sdk/alibaba"),
  "@ai-sdk/github-copilot":   () => import("./sdk/copilot"),
  "gitlab-ai-provider":       () => import("gitlab-ai-provider"),
  "venice-ai-sdk-provider":   () => import("venice-ai-sdk-provider"),
}
```

## 核心类型

### Provider Info

```typescript
export const Info = Schema.Struct({
  id: ProviderID,
  name: Schema.String,
  source: Schema.Literals(["env", "config", "custom", "api"]),
  env: Schema.Array(Schema.String),      // 环境变量名列表
  key: Schema.String.optional(),          // API Key
  options: Schema.Record(Schema.String, Schema.Any), // Provider 选项
  models: Schema.Record(Schema.String, Model), // 可用模型
})
```

### Model

```typescript
export const Model = Schema.Struct({
  id: ModelID,
  providerID: ProviderID,
  api: Schema.Struct({
    id: Schema.String,   // 模型 ID
    url: Schema.String,   // API URL
    npm: Schema.String,   // NPM 包名
  }),
  name: Schema.String,
  family: Schema.String.optional(),
  capabilities: Schema.Struct({
    temperature: Schema.Boolean,
    reasoning: Schema.Boolean,
    attachment: Schema.Boolean,
    toolcall: Schema.Boolean,
    input: ProviderModalities,
    output: ProviderModalities,
  }),
  cost: ProviderCost,
  limit: ProviderLimit,
  status: Schema.Literals(["alpha", "beta", "deprecated", "active"]),
  options: Schema.Record(Schema.String, Schema.Any),
  headers: Schema.Record(Schema.String, Schema.String),
  release_date: Schema.String,
  variants: Schema.Record(...),
})
```

## Provider 初始化流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Provider 初始化流程                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. 加载 models.dev 数据库                                                   │
│     └─▶ fromModelsDevProvider()                                             │
│                                                                             │
│  2. 合并配置文件 (opencode.json)                                             │
│     └─▶ mergeProvider()                                                     │
│                                                                             │
│  3. 从环境变量加载                                                         │
│     └─▶ 检查 ANTHROPIC_API_KEY 等                                          │
│                                                                             │
│  4. 从 Auth Service 加载                                                    │
│     └─▶ auth.all() 获取存储的凭证                                          │
│                                                                             │
│  5. 应用 Plugin Hooks                                                      │
│     └─▶ plugin.provider() 修改配置                                          │
│                                                                             │
│  6. 应用自定义 Provider 加载器                                              │
│     └─▶ custom() 中定义特殊逻辑                                            │
│         - google-vertex: GCP 项目/位置解析                                  │
│         - amazon-bedrock: AWS 区域/凭证处理                                │
│         - gitlab: AI Gateway 配置                                          │
│                                                                             │
│  7. 过滤禁用/启用的 Provider                                                │
│     └─▶ disabled_providers / enabled_providers                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 自定义 Provider 加载器

对于需要特殊配置逻辑的 Provider，实现自定义加载器：

### Google Vertex

```typescript
"google-vertex": Effect.fnUntraced(function* () {
  const env = yield* dep.env()
  const project = env["GOOGLE_CLOUD_PROJECT"]

  return {
    autoload: !!project,
    options: {
      project,
      location: env["GOOGLE_VERTEX_LOCATION"] ?? "us-central1",
      fetch: async (input, init) => {
        const { GoogleAuth } = await import("google-auth-library")
        const auth = new GoogleAuth()
        const client = await auth.getApplicationDefault()
        const token = await client.credential.getAccessToken()
        // 添加认证头
      }
    }
  }
})
```

### Amazon Bedrock

```typescript
"amazon-bedrock": Effect.fnUntraced(function* () {
  // 区域解析优先级
  // 1. opencode.json 配置
  // 2. AWS_REGION 环境变量
  // 3. 默认 us-east-1

  // 凭证解析
  // - AWS_ACCESS_KEY_ID
  // - AWS_BEARER_TOKEN_BEDROCK
  // - Web Identity Token
  // - 容器凭证
  // - 默认凭证链

  return {
    autoload: true,
    options: {
      region: defaultRegion,
      // ...
    },
    getModel(sdk, modelID) {
      // 跨区域推理前缀处理
      // us. + model (美国)
      // eu. + model (欧洲)
      // apac. + model (亚太)
    }
  }
})
```

## 模型选择

### 默认模型选择

```typescript
// 优先级列表
const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]

// 从列表中选择
for (const item of priority) {
  const model = Object.keys(provider.models).find(m => m.includes(item))
  if (model) return model
}
```

### 小模型选择

用于简单任务（如压缩）：

```typescript
const smallModelPriority = [
  "claude-haiku-4-5",
  "gemini-3-flash",
  "gpt-5-nano",
]
```

## 错误处理

### 错误类型

```typescript
export const APIError = NamedError.create(
  "APIError",
  z.object({
    message: z.string(),
    statusCode: z.number().optional(),
    isRetryable: z.boolean(),
    responseHeaders: z.record(z.string(), z.string()).optional(),
    responseBody: z.string().optional(),
  })
)
```

### Provider Fallback

见 [fallback.ts](./fallback.ts)

```typescript
// 降级触发条件
isRetryableError(error): boolean {
  // 429 Rate Limit
  // 500/502/503/504 Server Error
  // 错误消息包含 "rate limit" 或 "overloaded"
}

// 降级链
const chain = [
  { providerID: "anthropic", modelID: "claude-sonnet-4" },
  { providerID: "openai", modelID: "gpt-4o" },
  { providerID: "google", modelID: "gemini-2.5-pro" },
]
```

## 环境变量

| 变量 | Provider | 说明 |
|------|----------|------|
| `ANTHROPIC_API_KEY` | Anthropic | API Key |
| `OPENAI_API_KEY` | OpenAI | API Key |
| `GOOGLE_CLOUD_PROJECT` | Vertex | GCP 项目 |
| `GOOGLE_VERTEX_LOCATION` | Vertex | 区域 |
| `AWS_REGION` | Bedrock | AWS 区域 |
| `AWS_ACCESS_KEY_ID` | Bedrock | 访问密钥 |
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock | Bedrock 令牌 |
| `AZURE_RESOURCE_NAME` | Azure | 资源名 |
| `GITLAB_TOKEN` | GitLab | GitLab 令牌 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare | 账户 ID |
| `CLOUDFLARE_API_KEY` | Cloudflare | API Key |

## 配置示例

### opencode.json

```json
{
  "provider": {
    "anthropic": {
      "options": {
        "headers": {
          "anthropic-beta": "interleaved-thinking-2025-05-14"
        }
      }
    },
    "openrouter": {
      "models": {
        "gpt-4": {
          "status": "deprecated"
        }
      }
    },
    "amazon-bedrock": {
      "options": {
        "region": "us-east-1",
        "profile": "default"
      }
    }
  },
  "disabled_providers": ["some-provider"],
  "enabled_providers": ["anthropic", "openai"]
}
```

## 调试

### 查看加载的 Provider

```typescript
const providers = yield* Provider.Service.list()
console.log("Loaded providers:", Object.keys(providers))
```

### 检查模型可用性

```typescript
const model = yield* Provider.Service.getModel(
  ProviderID.make("anthropic"),
  ModelID.make("claude-sonnet-4")
)
console.log("Model:", model.name, model.capabilities)
```

## 相关文档

- [Provider 模块索引](../provider/)
- [Fallback 实现](./fallback.ts)
- [Effect Framework](../effect/)
