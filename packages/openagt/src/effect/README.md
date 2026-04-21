# Effect Framework 在 OpenAGt 中的应用

本文档介绍 OpenAGt 中 Effect.ts 框架的使用模式、架构设计和最佳实践。

---

## 目录

- [概述](#概述)
- [核心概念](#核心概念)
- [模块架构](#模块架构)
- [核心 API](#核心-api)
  - [makeRuntime](#makeruntime)
  - [InstanceState](#instancestate)
  - [MemoMap](#memomap)
- [最佳实践](#最佳实践)
- [常见模式](#常见模式)
- [Effect 与 OpenAGt 集成](#effect-与-openagt-集成)
- [调试技巧](#调试技巧)
- [资源](#资源)

---

## 概述

OpenAGt 使用 [Effect.ts](https://effect.website/) 作为核心框架，实现了函数式依赖注入模式。相比传统的命令式依赖注入（如 Angular 的 DI 或 Spring），Effect 提供了：

- **类型安全的依赖管理**：所有依赖通过类型系统管理
- **组合性**：通过 Layer 和 Context 实现声明式组合
- **Algebraic Effects**：将计算与其副作用分离
- **并发友好**：Effect 的并发模型天然线程安全

## 核心概念

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Effect 架构                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│   ┌─────────────────┐         ┌─────────────────┐                        │
│   │    Context      │         │     Layer       │                        │
│   │                 │         │                 │                        │
│   │ 依赖容器         │ 组合     │ 依赖实现         │                        │
│   │ (接口定义)       │ ──────▶ │ (具体实现)       │                        │
│   └─────────────────┘         └─────────────────┘                        │
│           │                             │                                │
│           │                             │                                │
│           ▼                             ▼                                │
│   ┌─────────────────┐         ┌─────────────────┐                        │
│   │    Service       │         │    Runtime      │                        │
│   │                 │         │                 │                        │
│   │ Context.Service │实例化    │ makeRuntime()  │                        │
│   │ 抽象接口         │ ──────▶ │ 执行 Effect    │                        │
│   └─────────────────┘         └─────────────────┘                        │
│                                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 模块架构

```
effect/
├── run-service.ts     # makeRuntime - 创建 Effect 运行时
├── instance-state.ts  # InstanceState - 每实例状态管理
├── memo-map.ts        # MemoMap - Layer 去重缓存
├── bridge.ts          # EffectBridge - Effect/Promise 桥接
├── bootstrap-runtime.ts # Bootstrap Runtime - 启动时初始化
└── observability.ts    # Observability - 日志/追踪
```

## 核心 API

### makeRuntime

创建可复用的 Effect 运行时，自动处理依赖注入和清理。

```typescript
// src/effect/run-service.ts
export function makeRuntime<I, S, E>(
  service: Context.Service<I, S>,
  layer: Layer.Layer<I, E>
) {
  let rt: ManagedRuntime | undefined
  const getRuntime = () => rt ??= ManagedRuntime.make(layer)

  return {
    runSync: <A>(fn: (svc: S) => Effect<A>) => getRuntime().runSync(attach(fn)),
    runPromise: <A>(fn: (svc: S) => Effect<A>) => getRuntime().runPromise(attach(fn)),
    runFork: <A>(fn: (svc: S) => Effect<A>) => getRuntime().runFork(attach(fn)),
    runCallback: <A>(fn: (svc: S) => Effect<A>) => getRuntime().runCallback(attach(fn)),
  }
}
```

**使用模式：**
```typescript
// 定义 Service
export class BusService extends Context.Service<BusService>()("@opencode/Bus") {
  readonly publish: <D extends BusEvent.Definition>(...) => Effect<void>
  readonly subscribe: <D extends BusEvent.Definition>(...) => Stream.Stream<Payload>
}

// 导出运行时函数
const { runPromise, runSync } = makeRuntime(BusService, Bus.layer)

// 同步调用 (适用于回调)
runSync((svc) => svc.subscribe(def, callback))

// 异步调用
await runPromise((svc) => svc.publish(def, data))
```

### InstanceState

管理每个工作目录/项目实例的状态，使用 ScopedCache 确保正确的生命周期。

```typescript
// src/effect/instance-state.ts
export function attachWith<A, E, R>(
  effect: Effect<A, E, R>,
  refs: { instance?: InstanceContext; workspace?: string }
): Effect<A, E, R> {
  // 将当前实例上下文附加到 Effect
}

// 使用
const state = yield* InstanceState.make<State>(
  Effect.fn("Bus.state")(function* () {
    const pubsub = yield* PubSub.unbounded<Payload>()
    yield* Effect.addFinalizer(() => PubSub.shutdown(pubsub))
    return { pubsub }
  })
)

// 读取状态
const s = yield* InstanceState.get(state)
```

**关键特性：**
- **自动清理**：`addFinalizer` 在实例销毁时执行
- **作用域隔离**：每个工作目录有独立状态
- **延迟初始化**：状态在首次访问时创建

### MemoMap

用于 Layer 组合时的去重，防止重复初始化。

```typescript
// src/effect/memo-map.ts
// 确保同一 Service 只初始化一次
// 即使被多个 Layer 引用
```

## 最佳实践

### 1. Service 定义模式

```typescript
// ✅ 正确：使用 Context.Service 基类
export class DatabaseService extends Context.Service<DatabaseService>()("@opencode/Database") {
  readonly query: (sql: string) => Effect<unknown[]>
  readonly close: () => Effect<void>
}

// ❌ 错误：直接实现接口
export class BadDatabase implements DatabaseService { ... }
```

### 2. Layer 实现模式

```typescript
// ✅ 正确：使用 Effect.gen
export const DatabaseLayer = Layer.effect(
  DatabaseService,
  Effect.gen(function* () {
    const config = yield* ConfigService
    const pool = yield* Effect.promise(() => createPool(config))

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

// ❌ 错误：同步创建
export const BadLayer = Layer.succeed(DatabaseService, {
  query: () => Effect.succeed([]), // 不推荐
})
```

### 3. 错误处理模式

```typescript
// ✅ 使用 Schema.TaggedErrorClass
export const QueryError = NamedError.create(
  "Database.QueryError",
  z.object({ sql: z.string() })
)

// ✅ 在 Effect.gen 中使用 yield* new
yield* new QueryError({ sql }, { cause: e })

// ❌ 错误：使用 Effect.fail
yield* Effect.fail(new QueryError(...))
```

### 4. 副作用清理

```typescript
Layer.effect(
  Service,
  Effect.gen(function* () {
    // ✅ 使用 addFinalizer
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* cleanup()
      })
    )

    // ✅ 使用 acquireRelease
    const resource = yield* Effect.acquireRelease(
      acquire(),
      release
    )

    return Service.of({ resource })
  })
)
```

## 常见模式

### 并行执行

```typescript
const [users, posts] = yield* Effect.all(
  [fetchUsers(), fetchPosts()],
  { concurrency: "unbounded" }
)

// 限制并发
const results = yield* Effect.forEach(
  urls,
  (url) => fetch(url),
  { concurrency: 5 }
)
```

### 管道操作

```typescript
Effect.succeed(data)
  .pipe(
    Effect.map((d) => process(d)),
    Effect.flatMap((d) => save(d)),
    Effect.mapError((e) => new AppError(e))
  )
```

### Ref 状态管理

```typescript
const counter = yield* Ref.make(0)
yield* Ref.update(counter, (n) => n + 1)
const value = yield* Ref.get(counter)
```

### Queue 生产者-消费者

```typescript
const queue = yield* Queue.bounded<string>(100)
yield* Queue.offer(queue, "item")
const item = yield* Queue.take(queue)
```

## Effect 与 OpenAGt 集成

### Bus Service

```typescript
// src/bus/index.ts
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(...)

    const publish = Effect.fn("Bus.publish")(function*(def, properties) {
      // 发布到 PubSub
      // 同步到 GlobalBus
    })

    const subscribe = Effect.fn("Bus.subscribe")(function*(def) {
      return Stream.fromPubSub(ps)
    })

    return Service.of({ publish, subscribe, subscribeAll })
  })
)

// 导出便捷函数
export const { runPromise, runSync } = makeRuntime(Service, layer)
export async function publish<D extends BusEvent.Definition>(...) {
  return runPromise((svc) => svc.publish(def, properties))
}
```

### Session Service

```typescript
// src/session/session.ts
const layer = Layer.effect(
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
```

## 调试技巧

### 启用追踪

```typescript
import { Effect, TracingLevel } from "effect"

const program = myEffect.pipe(
  Effect.withTracing({ level: TracingLevel.All })
)
```

### 查看 Effect 图

```typescript
import { Effect } from "effect"

console.log(Effect.all([eff1, eff2]).pipe(Effect.provide(layer)))
```

## 资源

- [Effect 官方文档](https://effect.website/docs)
- [Effect API 参考](https://effect.website/api)
- [Effect Discord](https://discord.gg/effect-ts)

## 相关文档

- [主 README](./README.md)
- [Provider 模块](../provider/)
- [Session 模块](../session/)
