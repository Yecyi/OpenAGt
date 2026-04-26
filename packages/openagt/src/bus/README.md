# Bus 模块

基于 PubSub 的进程内事件总线，支持类型安全的事件发布与订阅。

---

## 目录

- [架构概览](#架构概览)
- [核心类型](#核心类型)
- [Bus Service](#bus-service)
- [GlobalBus](#globalbus)
- [事件定义](#事件定义)
- [使用示例](#使用示例)
- [设计决策](#设计决策)
- [性能考虑](#性能考虑)

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Bus 架构                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐         ┌──────────────────┐                        │
│  │    Publisher     │────────▶│    PubSub       │                        │
│  │   (任意 Service) │         │  (typed + wildcard) │                     │
│  └──────────────────┘         └────────┬─────────┘                        │
│                                          │                                  │
│                        ┌─────────────────┼─────────────────┐              │
│                        ▼                 ▼                 ▼              │
│                  ┌─────────┐    ┌─────────────┐    ┌─────────────┐      │
│                  │Subscriber│    │ Subscriber  │    │ Subscriber  │      │
│                  │ (类型A) │    │  (类型B)   │    │  (通配符)   │      │
│                  └─────────┘    └─────────────┘    └─────────────┘      │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                         GlobalBus                                  │   │
│  │  (跨进程事件广播，用于 HTTP Server 与 CLI 之间的通信)             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 核心类型

```typescript
// 事件定义 (来自 bus-event.ts)
type Definition = {
  type: string
  properties: z.ZodType
}

// Payload 是所有事件的统一格式
type Payload<D extends Definition = Definition> = {
  type: D["type"]
  properties: z.infer<D["properties"]>
}

// Bus Service 接口
interface Interface {
  readonly publish: <D extends Definition>(def: D, properties: z.output<D["properties"]>) => Effect<void>
  readonly subscribe: <D extends Definition>(def: D) => Stream<Payload<D>>
  readonly subscribeAll: () => Stream<Payload>
  readonly subscribeCallback: <D extends Definition>(
    def: D,
    callback: (event: Payload<D>) => unknown,
  ) => Effect<() => void>
  readonly subscribeAllCallback: (callback: (event: any) => unknown) => Effect<() => void>
}
```

---

## Bus Service

使用 Effect Layer 模式实现，每个工作目录 (Instance) 拥有独立的 Bus 状态。

```typescript
// src/bus/index.ts
export class Service extends Context.Service<Service, Interface>()("@opencode/Bus") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // 每个实例独立的状态
    const state = yield* InstanceState.make<State>(...)

    return Service.of({
      publish,
      subscribe,
      subscribeAll,
      subscribeCallback,
      subscribeAllCallback,
    })
  })
)
```

**状态结构：**

```typescript
type State = {
  wildcard: PubSub<Payload> // 通配符订阅，所有事件
  typed: Map<string, PubSub<Payload>> // 类型化订阅，按事件类型
}
```

---

## GlobalBus

跨进程的全局事件广播，用于 Server 与 CLI 之间的通信。

```typescript
// src/bus/global.ts
// 在 Bus.publish 中自动调用
GlobalBus.emit("event", {
  directory: dir,
  project: context.project.id,
  workspace,
  payload, // { type, properties }
})
```

---

## 事件定义

使用 `BusEvent.define` 定义类型安全的事件：

```typescript
// src/bus/index.ts
export const InstanceDisposed = BusEvent.define(
  "server.instance.disposed",
  z.object({
    directory: z.string(),
  }),
)
```

**已定义的事件类型：** (见 `bus-event.ts`)

---

## 使用示例

### 发布事件

```typescript
import { Bus } from "@/bus"

yield * Bus.publish(SessionCreated, { sessionID, info })

// 或使用便捷函数
import { publish } from "@/bus"
await publish(SessionCreated, { sessionID, info })
```

### 订阅事件 (Effect Context)

```typescript
import { Bus } from "@/bus"

const stream = yield * Bus.subscribe(SessionCreated)
yield *
  Stream.runForEach(stream, (event) => {
    console.log("Session created:", event.properties.sessionID)
  })
```

### 订阅事件 (Callback 模式)

```typescript
import { subscribe } from "@/bus"

const unsubscribe = subscribe(SessionCreated, (event) => {
  console.log("Session created:", event.properties.sessionID)
})

// 取消订阅
unsubscribe()
```

### 订阅所有事件 (通配符)

```typescript
import { subscribeAll } from "@/bus"

const unsubscribe = subscribeAll((event) => {
  console.log("Event:", event.type, event.properties)
})
```

### 在 Effect 中订阅

```typescript
yield *
  Bus.subscribeCallback(SessionCreated, (event) => {
    // 这个回调在 Effect Context 外执行
    console.log(event)
  })
```

---

## 设计决策

### 为什么用 PubSub？

1. **类型安全** — 通过 TypeScript 泛型和 Zod Schema 实现编译时类型检查
2. **Effect 集成** — 自然融入 Effect 的 Stream 和 Effect 模型
3. **作用域隔离** — 每个 Instance 有独立的状态空间
4. **自动清理** — `addFinalizer` 确保实例销毁时正确清理资源

### typed vs wildcard

- **typed 订阅** — 只接收特定类型的事件，高效
- **wildcard 订阅** — 接收所有事件，用于全局日志、监控

### InstanceDisposed 事件

在 `addFinalizer` 中发布 `InstanceDisposed` 事件，确保订阅者在实例关闭前能看到此事件。

---

## 性能考虑

1. **PubSub 容量** — 使用 `unbounded` PubSub，无容量限制
2. **内存管理** — `unsubscribe` 返回的函数用于手动释放订阅
3. **并发安全** — PubSub 本身是并发安全的

---

## 相关文档

- [主 README](../../README.md)
- [Effect Framework](../effect/)
- [SyncEvent 事件溯源](../sync/)
