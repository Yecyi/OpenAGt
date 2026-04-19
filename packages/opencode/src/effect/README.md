# Effect 框架使用指南

本文档介绍 OpenAG 中 Effect.ts 框架的使用模式和最佳实践。

## 目录

- [概述](#概述)
- [Effect 基础](#effect-基础)
- [Context 和依赖注入](#context-和依赖注入)
- [Layer 组合](#layer-组合)
- [错误处理](#错误处理)
- [并发处理](#并发处理)
- [OpenAG 中的实际示例](#openag-中的实际示例)

## 概述

OpenAG 使用 [Effect.ts](https://effect.website/) 作为核心框架，实现了函数式依赖注入模式。相比传统的命令式依赖注入（如 Angular 的 DI 或 Spring），Effect 提供了：

- **类型安全的依赖管理**：所有依赖通过类型系统管理
- **组合性**：通过 Layer 和 Context 实现声明式组合
- **Algebraic Effects**：将计算与其副作用分离
- **并发友好**：Effect 的并发模型天然线程安全

## Effect 基础

### 创建 Effect

```typescript
import { Effect } from "effect"

// 简单的同步 Effect
const success: Effect.Effect<string> = Effect.succeed("Hello")

// 失败的 Effect
const failure: Effect.Effect<never, Error> = Effect.fail(new Error("Oops"))

// 从 Promise 创建
const asyncEffect: Effect.Effect<string, Error> = Effect.promise(
  () => fetch("/api/data").then((r) => r.text())
)

// 使用 gen 语法 (类似 async/await)
const complexEffect = Effect.gen(function* () {
  const config = yield* ConfigService
  const data = yield* Effect.promise(() => fetchData(config.url))
  return process(data)
})
```

### 运行 Effect

```typescript
import { Effect, Runtime } from "effect"

// 运行并获取结果
const result = await Effect.runPromise(myEffect)

// 处理错误
const result = await Effect.runPromiseExit(myEffect)
result._tag === "Success" // true/false

// 在 Layer 上下文中运行
const runtime = await Effect.runRuntime(myEffect)
```

## Context 和依赖注入

### 定义 Service

```typescript
import { Context, Effect } from "effect"

// 定义 Service 接口
export class DatabaseService extends Context.Service<DatabaseService>()(
  "@opencode/Database"
) {
  // Service 需要实现的方法
  query(sql: string): Effect.Effect<unknown[]>
  close(): Effect.Effect<void>
}
```

### 实现 Service

```typescript
import { Effect, Layer } from "effect"

// 实现 Service
export const DatabaseServiceImpl = Layer.effect(
  DatabaseService,
  Effect.gen(function* () {
    // 初始化数据库连接
    const pool = yield* Effect.promise(() => createPool())

    // 返回实现对象
    return new (class extends DatabaseService {
      query(sql: string) {
        return Effect.promise(() => pool.query(sql))
      }
      close() {
        return Effect.promise(() => pool.end())
      }
    })()
  })
)
```

### 消费 Service

```typescript
function getUserById(id: string): Effect.Effect<User, Error> {
  return Effect.gen(function* () {
    // 通过 yield* 获取依赖
    const db = yield* DatabaseService
    const rows = yield* db.query(`SELECT * FROM users WHERE id = ${id}`)
    return rows[0] as User
  })
}
```

## Layer 组合

### 基础 Layer

```typescript
import { Layer } from "effect"

// 基础 Layer
const baseLayer = Layer.succeed(ConfigService, {
  apiUrl: "https://api.example.com",
  timeout: 5000,
})

// Effect Layer (惰性求值)
const dbLayer = Layer.effect(
  DatabaseService,
  Effect.gen(function* () {
    const config = yield* ConfigService
    return yield* Effect.promise(() => new Database(config))
  })
)
```

### Layer 组合

```typescript
// 使用 + 运算符组合 Layer
const combined = baseLayer + dbLayer + cacheLayer

// 使用 Layer.provide 运行
const program = Effect.gen(function* () {
  const db = yield* DatabaseService
  return yield* db.query("SELECT 1")
})

const result = await Effect.runPromise(
  program.pipe(Effect.provide(combined))
)
```

### Layer 作用域

```typescript
// 共享作用域 (全局单例)
const sharedLayer = Layer.singleton(databaseLayer)

// 请求作用域 (每次请求创建新实例)
const requestLayer = Layer.effect(
  RequestContext,
  Effect.gen(function* () {
    return { requestId: generateId(), startTime: Date.now() }
  })
)
```

## 错误处理

### 使用 Either 类型

```typescript
import { Effect, Either } from "effect"

const result = await Effect.runPromiseExit(
  Effect.gen(function* () {
    const user = yield* findUser(id)
    if (!user) {
      // 抛出错误会被捕获
      return yield* Effect.fail(new NotFoundError(`User ${id} not found`))
    }
    return user
  })
)

// 检查结果
if (Either.isLeft(result)) {
  console.error(result.left)
} else {
  console.log(result.right)
}
```

### 使用 Cause 分析错误

```typescript
import { Effect, Cause } from "effect"

Effect.runPromiseExit(program).then((exit) => {
  if (exit._tag === "Failure") {
    const cause = exit.cause
    if (Cause.isDie(cause)) {
      // 未捕获的异常
    } else if (Cause.isFail(cause)) {
      // 预期的失败 (Effect.fail)
    } else if (Cause.isInterrupt(cause)) {
      // 被中断
    }
  }
})
```

### 错误恢复

```typescript
// 恢复错误
const recovered = Effect.gen(function* () {
  const user = yield* findUser(id)
    .pipe(Effect.catchAll(() => Effect.succeed(defaultUser)))
  return user
})

// 重试
const withRetry = Effect.gen(function* () {
  const result = yield* fetchData()
    .pipe(Effect.retry({ times: 3, delay: 1000 }))
  return result
})
```

## 并发处理

### 并行执行

```typescript
import { Effect } from "effect"

// 并行执行多个 Effect
const users = yield* Effect.all([
  fetchUser(1),
  fetchUser(2),
  fetchUser(3),
], { concurrency: "unbounded" })

// 限制并发数
const limited = yield* Effect.all(tasks, { concurrency: 5 })
```

### 并行映射

```typescript
const urls = ["url1", "url2", "url3"]

const results = yield* Effect.forEach(
  urls,
  (url) => fetch(url),
  { concurrency: 2 }
)
```

### 管道操作

```typescript
import { pipe } from "effect"

const program = Effect.succeed(data)
  .pipe(
    Effect.map((d) => process(d)),
    Effect.flatMap((d) => save(d)),
    Effect.mapError((e) => new AppError(e))
  )
```

## OpenAG 中的实际示例

### 1. 定义 Agent Service

```typescript
// src/agent/agent.ts
export class AgentService extends Context.Service<AgentService>()(
  "@opencode/Agent"
) {
  readonly run: (
    input: AgentInput
  ) => Effect.Effect<AgentOutput, AgentError>
}

export const AgentServiceLayer = Layer.effect(
  AgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService
    const session = yield* SessionService

    return new (class extends AgentService {
      run(input: AgentInput): Effect.Effect<AgentOutput, AgentError> {
        return Effect.gen(function* () {
          const messages = yield* session.getMessages()
          const response = yield* callAI(config, messages)
          yield* session.addMessage(response)
          return response
        })
      }
    })()
  })
)
```

### 2. 工具调度器

```typescript
// src/tool/scheduler.ts (已实现)
export function partitionToolCalls(
  calls: ToolCallItem[]
): Effect.Effect<ToolBatch[]> {
  return Effect.gen(function* () {
    const safeTools: ToolCallItem[] = []
    const unsafeTools: ToolCallItem[] = []

    for (const call of calls) {
      if (isConcurrencySafe(call.name)) {
        safeTools.push(call)
      } else {
        unsafeTools.push(call)
      }
    }

    return [
      { type: "concurrent", tools: safeTools },
      { type: "serial", tools: unsafeTools },
    ]
  })
}
```

### 3. 会话恢复

```typescript
// src/session/recovery.ts (已实现)
export function loadConversationForResume(
  serialized: SerializedMessage[]
): Effect.Effect<DeserializedSession> {
  return Effect.gen(function* () {
    const messages = yield* deserializeMessages(serialized)

    // 重建会话链
    const chain = yield* rebuildConversationChain(messages)

    return {
      messages: chain,
      lastMessageId: messages[messages.length - 1]?.id,
    }
  })
}
```

## 常见模式

### 1. 使用 Ref 进行状态管理

```typescript
import { Effect, Ref } from "effect"

const counter = yield* Ref.make(0)

const increment = counter.pipe(
  Ref.update((n) => n + 1)
)

const value = yield* counter.pipe(Ref.get)
```

### 2. Queue 用于生产者-消费者

```typescript
import { Effect, Queue } from "effect"

const queue = yield* Queue.bounded<string>(100)

const producer = Queue.offer(queue, "item")
const consumer = Queue.take(queue)
```

### 3. 定时器

```typescript
import { Effect, Schedule } from "effect"

// 重试间隔递增
const exponentialBackoff = Schedule.intersect([
  Schedule.recurs(5),
  Schedule.exponential(1000),
])

const program = Effect.repeat(
  Effect.promise(() => mightFail()),
  exponentialBackoff
)
```

## 最佳实践

1. **使用 gen 语法**：比 Promise 链更易读
2. **错误优先**：在函数签名中包含错误类型
3. **小粒度 Service**：单一职责便于测试和组合
4. **避免副作用**：在 Effect 层管理所有 IO
5. **使用 Layer 组合**：声明式配置优于命令式 wiring

## 资源

- [Effect 官方文档](https://effect.website/docs)
- [Effect API 参考](https://effect.website/api)
- [OpenAG Effect 模块](../effect/)
