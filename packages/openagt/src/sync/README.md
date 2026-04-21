# SyncEvent 事件溯源系统

OpenAGt 的会话同步和事件溯源实现，支持多设备同步和会话回放。

---

## 目录

- [核心概念](#核心概念)
- [设计目标](#设计目标)
  - [单写者同步](#1-单写者同步)
  - [向后兼容](#2-向后兼容)
- [事件定义](#事件定义)
- [核心 API](#核心-api)
- [事件流](#事件流)
- [与 Bus 集成](#与-bus-集成)
- [数据库表设计](#数据库表设计)
- [调试](#调试)
- [性能优化](#性能优化)
- [局限性](#局限性)
- [测试](#测试)

---

## 核心概念

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           事件溯源架构                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐         ┌─────────────────┐                        │
│  │    Domain      │         │   Projector    │                        │
│  │    Event       │────────▶│   (处理器)      │                        │
│  │  { id, seq,   │         │                 │                        │
│  │    data }      │         │ 更新数据库状态   │                        │
│  └─────────────────┘         └─────────────────┘                        │
│           │                                                    │
│           ▼                                                    │
│  ┌─────────────────┐         ┌─────────────────┐                        │
│  │ EventStore     │         │     Bus        │                        │
│  │ (持久化)        │         │   (发布订阅)   │                        │
│  └─────────────────┘         └─────────────────┘                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 设计目标

### 1. 单写者同步

系统设计为**单一写者多读者**模式：

```
┌─────────────────┐                      ┌─────────────────┐
│   主设备         │                      │   从设备         │
│  (可写)         │◀──── Sync Events ───│  (只读)        │
└─────────────────┘                      └─────────────────┘
         │                                        │
         │                                        ▼
         │                              ┌─────────────────┐
         │                              │  Replay Events  │
         │                              │  本地重建状态    │
         │                              └─────────────────┘
```

**为什么单一写者？**
- 不需要复杂的分布式时钟
- 序列号 (seq) 提供自然的全序
- 简化冲突解决

### 2. 向后兼容

SyncEvent 与现有 Bus 系统无缝集成：

```typescript
// SyncEvent 自动重新发布为 BusEvent
SyncEvent.run(Created, { sessionID, info })

// 现有 Bus 订阅者继续工作
Bus.subscribe(Created, (event) => {
  // event 仍是 { type, properties } 格式
})
```

## 事件定义

### 定义格式

```typescript
const Created = SyncEvent.define({
  type: "session.created",
  version: 1,
  aggregate: "sessionID",  // 聚合根字段
  schema: z.object({
    sessionID: SessionID.zod,
    info: Info,
  }),
})
```

### 版本控制

```typescript
// 事件演进
const Updated = SyncEvent.define({
  type: "session.updated",
  version: 2,  // 版本号
  aggregate: "sessionID",
  schema: z.object({
    sessionID: SessionID.zod,
    info: partialSchema(Info),  // 新版本只包含变更
  }),
  // 向后兼容：提供旧版本 schema 用于 Bus
  busSchema: z.object({
    sessionID: SessionID.zod,
    info: Info,  // 旧版本完整对象
  })
})
```

### 聚合根

每个事件关联一个聚合根 (aggregate)：

```typescript
// aggregate 字段用于：
// 1. 序列号隔离
// 2. 并发控制
// 3. 查询优化
SyncEvent.run(Created, { sessionID: "abc", info })
// sessionID 是聚合根
```

## 核心 API

### 定义事件

```typescript
import { SyncEvent } from "./sync"

export const SessionCreated = SyncEvent.define({
  type: "session.created",
  version: 1,
  aggregate: "sessionID",
  schema: z.object({
    sessionID: SessionID.zod,
    info: Info,
  }),
})

export const SessionUpdated = SyncEvent.define({
  type: "session.updated",
  version: 1,
  aggregate: "sessionID",
  schema: z.object({
    sessionID: SessionID.zod,
    info: partialSchema(Info),
  }),
  busSchema: z.object({
    sessionID: SessionID.zod,
    info: Info,  // 转换为 Bus 格式
  }),
})
```

### 运行事件

```typescript
// 同步运行事件
SyncEvent.run(Created, { sessionID, info })

// 可选：运行但不发布到 Bus
SyncEvent.run(Updated, { sessionID, info }, { publish: false })
```

### 事件重放

```typescript
// 从远程获取序列化事件
const events: SerializedEvent[] = await fetchEvents(sessionID)

// 重放单个事件
for (const event of events) {
  SyncEvent.replay(event)
}

// 或批量重放
SyncEvent.replayAll(events)
```

### 投影器 (Projector)

```typescript
// 定义投影器
const projectors: Array<[Definition, ProjectorFunc]> = [
  [SessionCreated, (db, data) => {
    db.insert(SessionTable).values({
      id: data.sessionID,
      ...toRow(data.info)
    }).run()
  }],
  [SessionUpdated, (db, data) => {
    db.update(SessionTable)
      .set(toRow(data.info))
      .where(eq(SessionTable.id, data.sessionID))
      .run()
  }]
]

// 初始化同步系统
SyncEvent.init({ projectors })
```

## 事件流

```
用户操作
    │
    ▼
SyncEvent.run(Event, data)
    │
    ▼
Database.transaction (IMMEDIATE)
    │
    ├─▶ projector(db, data)
    │       │
    │       ▼
    │    更新业务表
    │
    ├─▶ EventSequenceTable
    │       │ seq = last + 1
    │       ▼
    │    INSERT ON CONFLICT UPDATE
    │
    ├─▶ EventTable
    │       │ 完整事件持久化
    │       ▼
    │    INSERT
    │
    └─▶ Bus.publish
            │
            ▼
         全局事件通知
```

## 与 Bus 集成

### 事件形状对比

| 属性 | SyncEvent | BusEvent |
|------|-----------|----------|
| `type` | ✓ | ✓ |
| `id` | ✓ | - |
| `seq` | ✓ | - |
| `aggregateID` | ✓ | - |
| `data` | ✓ | - |
| `properties` | - | ✓ |

### 转换机制

```typescript
// SyncEvent 自动转换格式
// SyncEvent.data → BusEvent.properties

// 自定义转换 (向后兼容)
SyncEvent.init({
  projectors,
  convertEvent: (type, data) => {
    if (type === "session.updated") {
      // 新版本只有部分字段
      // 补全为完整对象供旧订阅者使用
      return { sessionID: data.sessionID, info: fullInfo }
    }
    return data
  }
})
```

## 数据库表设计

### EventSequence

记录每个聚合的最新序列号：

```sql
CREATE TABLE event_sequence (
  aggregate_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL
);
```

### Event

存储完整事件：

```sql
CREATE TABLE event (
  id TEXT PRIMARY KEY,
  aggregate_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL  -- JSON
);

CREATE INDEX idx_event_aggregate ON event(aggregate_id);
CREATE INDEX idx_event_seq ON event(aggregate_id, seq);
```

## 调试

### 查看事件流

```typescript
// 订阅所有事件
SyncEvent.subscribeAll((event) => {
  console.log("Event:", {
    type: event.type,
    seq: event.seq,
    aggregateID: event.aggregateID
  })
})
```

### 检查事件一致性

```typescript
// 验证序列号连续性
const events = await fetchEvents(sessionID)
for (let i = 1; i < events.length; i++) {
  if (events[i].seq !== events[i-1].seq + 1) {
    console.error("Gap detected at", i)
  }
}
```

## 性能优化

### 1. 批量重放

```typescript
// 批量重放比单个重放高效
const batchSize = 100
for (let i = 0; i < events.length; i += batchSize) {
  const batch = events.slice(i, i + batchSize)
  SyncEvent.replayAll(batch)
}
```

### 2. 快照

对于长会话，定期创建快照：

```typescript
// 定期快照
if (seq % 100 === 0) {
  createSnapshot(sessionID, seq)
}

// 从快照恢复
const snapshot = getLatestSnapshot(sessionID)
if (snapshot && snapshot.seq >= fromSeq) {
  restoreFromSnapshot(snapshot)
  fromSeq = snapshot.seq + 1
}
```

### 3. 索引优化

```sql
-- 聚合查询
CREATE INDEX idx_event_aggregate_seq ON event(aggregate_id, seq DESC);

-- 类型查询
CREATE INDEX idx_event_type ON event(type);
```

## 局限性

### 当前限制

1. **无内置冲突解决** - 依赖单一写者假设
2. **无版本迁移** - 需要手动处理 schema 演化
3. **无快照策略** - 需要外部实现

### 未来增强

```typescript
// 1. 快照支持
interface Snapshot {
  aggregateID: string
  seq: number
  state: any
  createdAt: number
}

// 2. 版本迁移
SyncEvent.migrate(Updated, (oldEvent) => ({
  ...oldEvent,
  // 转换逻辑
}))

// 3. 冲突检测
interface ConflictError {
  aggregateID: string
  expectedSeq: number
  actualSeq: number
}
```

## 测试

```typescript
// 单元测试
test("SessionCreated persists event", async () => {
  SyncEvent.reset()
  SyncEvent.init({ projectors })

  SyncEvent.run(SessionCreated, { sessionID, info })

  const events = db.select().from(EventTable).all()
  expect(events).toHaveLength(1)
  expect(events[0].type).toBe("session.created")
})

// 重放测试
test("replayAll restores state", async () => {
  // ... setup
  const events = captureEvents()

  // ... clear state
  SyncEvent.replayAll(events)

  const session = db.select().from(SessionTable).get()
  expect(session).toMatchObject(expected)
})
```

## 参考资料

- [CQRS 和事件溯源](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Axon Framework 事件溯源](https://docs.axoniq.io/axon-framework/events/)
