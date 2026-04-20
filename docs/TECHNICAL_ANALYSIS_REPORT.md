# OpenAGt 技术分析报告（重构版）

> 更新时间：2026-04-19
> 分析对象：`packages/opencode`、`packages/opencode_flutter`、`Code Reference/CC Source Code`、`Code Reference/hermes-agent`
> 目标：基于 OpenCode/OpenAGt 当前源码，吸收 Claude Code reference 与 Hermes Agent 的有效设计，形成更准确、更可执行的技术判断。

---

## 1. 执行摘要

这份报告的核心结论很明确：

1. OpenAGt 最适合继续建立在 `packages/opencode` 之上，而不是迁移到 Hermes 的 Python 运行时或试图复刻 Claude Code 的闭源单体架构。
2. OpenAGt 当前已经具备可演进成"高质量开源 agent helper"的关键骨架：
   - 多 provider 抽象
   - Effect 驱动的 session / tool / event 主链
   - HTTP + SSE/WebSocket 的 client/server 架构
   - 可扩展的工具注册与 MCP 接入
   - 独立 Flutter 客户端目录
3. 最近一轮实现后，OpenAGt 已经不再只是"计划接入"：
   - 三层压缩主链已经进入 `session/compaction.ts` 和 `session/prompt.ts`
   - provider fallback chain 已经进入运行时
   - 工具并发分区与路径冲突检测已经进入调度链
   - prompt injection 防护已经接入文件读入和外部资源注入点
4. 但工程成熟度仍未达到"稳定发布"：
   - 增量测试通过
   - `bun typecheck` 仍未全绿
   - Flutter 仍应放在 CLI/Server 验收之后
5. Claude Code reference 的最大价值不在"照搬代码"，而在：
   - 产品化交互节奏
   - 工具调度纪律
   - 压缩分层思路
   - 多层权限与失败恢复体验
6. Hermes 的最大价值不在"替换底座"，而在：
   - 轨迹压缩和离线数据处理
   - 多入口 gateway 思维
   - 技能/记忆/调度的长期运行形态

一句话判断：

**OpenAGt 的正确方向不是做 Claude Code 的像素级复刻，也不是把 Hermes 全盘移植进来，而是以 OpenCode 为稳定底座，吸收 Claude Code 的产品工程 discipline，以及 Hermes 的长期记忆与运行策略。**

---

## 2. 本次重构报告修正了什么

旧版报告存在三个问题：

1. 文档本身出现编码损坏，中文内容大面积乱码，已不适合作为正式设计依据。
2. 多处结论停留在"规划态"，没有反映最近已经落地的实现。
3. reference code、OpenAGt 当前状态、未来规划三者混在一起，导致读者难以判断哪些是事实，哪些是建议。

这次重构后的原则是：

1. 只基于仓库内可见代码与验证结果下结论。
2. 明确区分：
   - 已实现
   - 已接线但未完成工程收口
   - 仍处于规划阶段
3. 对 Claude Code reference 与 Hermes Agent 分别提炼"可继承价值"和"不应照搬部分"。

---

## 3. 分析范围与证据来源

### 3.1 OpenAGt / OpenCode 侧

本次重点阅读的源码区域：

- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/session/compaction/micro.ts`
- `packages/opencode/src/session/compaction/auto.ts`
- `packages/opencode/src/session/compaction/full.ts`
- `packages/opencode/src/provider/fallback-service.ts`
- `packages/opencode/src/provider/fallback.ts`
- `packages/opencode/src/config/provider.ts`
- `packages/opencode/src/tool/partition.ts`
- `packages/opencode/src/tool/path-overlap.ts`
- `packages/opencode/src/security/injection.ts`
- `packages/opencode/src/provider/schema.ts`
- `packages/opencode/src/v2/session-event.ts`
- `packages/opencode/package.json`
- `packages/opencode_flutter/pubspec.yaml`

### 3.2 Claude Code reference 侧

本次重点阅读的目录与材料：

- `Code Reference/CC Source Code/src`
- `Code Reference/CC Source Code/README_CN.md`
- 目录结构中可见的 `query`、`tools`、`ink`、`coordinator`、`server`、`skills`、`services` 等模块

注意：

- 这份 Claude Code reference 明显属于解包/逆向分析仓库，不是 Anthropic 官方开源主仓。
- 它的价值主要是"架构与产品模式参考"，不是法律与工程意义上的直接复用来源。

### 3.3 Hermes Agent 侧

本次重点阅读的目录与材料：

- `Code Reference/hermes-agent/README.md`
- `Code Reference/hermes-agent/trajectory_compressor.py`
- 仓库顶层结构：`agent`、`gateway`、`hermes_cli`、`skills`、`cron`、`tests` 等

---

## 4. 当前 OpenAGt 的真实代码状态

### 4.1 底座判断

OpenAGt 当前仍然是一个以 `packages/opencode` 为核心的 TypeScript/Bun 项目，具备下面这些现实优势：

1. `package.json` 与 `packages/opencode/package.json` 显示它仍然是标准 monorepo，核心 agent runtime、CLI、Web/Desktop 和 SDK 仍围绕 OpenCode 组织。
2. `packages/opencode/src` 已经具备较完整的模块化边界：
   - `session`
   - `provider`
   - `tool`
   - `security`
   - `server`
   - `storage`
   - `sync`
   - `cli`
   - `permission`
   - `mcp`
3. 这意味着 OpenAGt 不是从零搭壳，而是在一个已经具备可扩展运行时的项目上迭代。

### 4.2 已经落地的关键增强

本次对源码的核查显示，以下能力已经进入主链，而不是停留在文档计划中。

#### A. 三层压缩已经接入主流程

在 `packages/opencode/src/session/compaction.ts` 中，三层压缩已经被显式组织为：

##### Layer 1: MicroCompact

```typescript
// src/session/compaction/micro.ts
export const MICRO_COMPACT_TIME_THRESHOLD_MS = 5 * 60 * 1000 // 5分钟

export interface MicroCompactConfig {
  timeThresholdMs: number      // 默认 300000ms
  preserveRecentN: number       // 默认 3（保留最近3个）
  compactableTools: Set<string> // ['read', 'grep', 'glob', 'webfetch', 'codesearch', 'websearch']
}
```

- 对旧工具结果做时间阈值压缩（默认5分钟前的read/grep/glob结果）
- 不依赖 LLM，纯本地操作
- 保留最近 N 个结果不被压缩

##### Layer 2: AutoCompact

```typescript
// src/session/compaction/auto.ts
export interface AutoCompactConfig {
  bufferTokens: number              // 默认 13_000
  maxOutputTokens: number          // 默认 20_000
  circuitBreakerThreshold: number  // 默认 3
  targetCompressionRatio: number   // 默认 0.4 (40%)
}
```

- 按当前会话模型的 context limit 评估是否进入自动压缩
- 计算公式：`available = contextLimit - bufferTokens - maxOutputTokens`
- 触发条件：`compressionRatio > 1`（即已用 tokens 超过可用空间）

##### Layer 3: Full Compact

```typescript
// src/session/compaction/full.ts
export interface FullCompactConfig {
  summaryTemplate: string       // 详细的摘要 prompt 模板
  maxReinjectFiles: number      // 默认 5
  maxReinjectTokens: number     // 默认 25_000
  iterativeUpdate: boolean      // 默认 true
  deduplicateSummaries: boolean // 默认 true
}
```

- 使用 `buildCompactContext()` 和 `formatCompactPrompt()` 生成高质量压缩提示
- 接入真实的摘要上下文构造，而不是单一硬编码 prompt
- 支持增量摘要更新（`iterativeUpdate: true`）

#### B. 压缩触发已经前移到模型调用前

在 `packages/opencode/src/session/prompt.ts` 中，`compaction.prune({ sessionID })` 已被放到模型调用之前，随后末尾仍保留一次异步兜底清理。

流程图：

```
用户输入
    ↓
prune() [Layer 1: MicroCompact 时间压缩]
    ↓
检查是否需要 Layer 2 (AutoCompact)
    ↓ [如果 compressionRatio > 1]
findToolPartsToCompact() → summarizeToolResult()
    ↓
模型调用
    ↓
prune() [异步兜底清理]
```

这带来的好处是：

1. 先减小上下文，再发起模型调用，避免把无意义的大工具输出送进 prompt。
2. 把"压缩"从纯事后补救，改成"事前预防 + 事后清理"的双阶段策略。

#### C. Provider fallback chain 已经进入运行时

配置层（`packages/opencode/src/config/provider.ts`）：

```typescript
export class Info extends Schema.Class<Info>("ProviderConfig")({
  // ...
  fallback: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      chain: Schema.mutable(
        Schema.Array(
          Schema.Struct({
            provider: Schema.String,  // e.g., "anthropic"
            model: Schema.String,     // e.g., "claude-sonnet-4-20250514"
          }),
        ),
      ),
      provider: Schema.optional(Schema.String),      // 单个备用 provider
      model: Schema.optional(Schema.String),         // 单个备用 model
      retryOnRateLimit: Schema.optional(Schema.Boolean),  // 默认 true
      retryOnServerError: Schema.optional(Schema.Boolean), // 默认 true
      maxRetries: Schema.optional(PositiveInt),      // 默认 3
    }),
  ),
})
```

运行时层（`packages/opencode/src/provider/fallback-service.ts`）：

```typescript
export interface FallbackState {
  baseProviderID: string
  baseModelID: string
  chain: FallbackEntry[]           // 有序的 fallback 链
  index: number                   // 当前尝试的位置
  attempts: number                // 当前请求已尝试次数
  maxRetries: number              // 最大重试次数
  retryOnRateLimit: boolean
  retryOnServerError: boolean
}

export interface Interface {
  readonly createState: (providerID: string, modelID: string) => Effect.Effect<FallbackState | undefined>
  readonly next: (state: FallbackState) => Effect.Effect<{ model: Provider.Model; state: FallbackState } | undefined>
  readonly shouldFallback: (error: unknown, state: FallbackState) => Effect.Effect<boolean>
}
```

Fallback 判断逻辑（`shouldFallback`）：

| 条件 | 是否触发 Fallback |
|------|------------------|
| HTTP 429 | `retryOnRateLimit === true` |
| HTTP 5xx (500-599) | `retryOnServerError === true` |
| error.message 包含 "rate limit" | `retryOnRateLimit === true` |
| error.message 包含 "overloaded" | `retryOnServerError === true` |

#### D. 工具并发分区和路径冲突检测已经接入

`packages/opencode/src/tool/partition.ts`：

```typescript
export const CONCURRENCY_SAFE_TOOLS = new Set([
  "read", "glob", "grep", "webfetch",
  "codesearch", "websearch", "lsp",
  "question", "skill"
])

export const UNSAFE_PATTERNS = new Set([
  "bash", "edit", "write", "task",
  "todo", "plan", "apply_patch"
])

export interface ToolBatch {
  type: "safe" | "unsafe"
  tools: ToolCallItem[]
}

export interface ToolCallItem {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

// 分区算法：safe 工具并发执行，unsafe 工具串行执行
export function partitionToolCalls(calls: ToolCallItem[]): ToolBatch[]
```

`packages/opencode/src/tool/path-overlap.ts`：

```typescript
// 路径提取：从 tool input 中递归提取路径字符串
export function extractPathsFromInput(input: Record<string, unknown>): string[]

// 路径归一化：使用 path.normalize() 并转小写
export function pathsOverlap(paths1: string[], paths2: string[]): boolean

// 冲突检测：检测同目录或相同文件的访问冲突
export function detectPathConflicts(
  calls: Array<{ toolName: string; input: Record<string, unknown> }>
): Array<{ call1: number; call2: number; reason: string }>
```

调度执行顺序：

1. 先执行所有 `safe` batch（内部并发）
2. 再逐个执行 `unsafe` batch（串行）
3. 路径冲突的 unsafe 工具等待 blocker 完成

#### E. Prompt injection 防护已经接到内容入口

`packages/opencode/src/security/injection.ts`：

```typescript
export interface InjectionPattern {
  pattern: RegExp
  severity: "low" | "medium" | "high"
  description: string
}

export const INJECTION_PATTERNS: InjectionPattern[] = [
  // 高危
  { pattern: /\u200b|\u200c|\u200d|\ufeff/, severity: "high", description: "零宽字符" },
  { pattern: /ignore previous instructions?/i, severity: "high", description: "经典注入短语" },
  { pattern: /disregard (?:all )?(?:previous|prior) (?:instructions?|commands?|rules?)/i, severity: "high" },
  { pattern: /forget (?:all )?(?:previous|prior) (?:instructions?|commands?)/i, severity: "high" },
  { pattern: /\x00|\x1a/, severity: "high", description: "控制字符" },
  { pattern: /(?:api|secret|key|password|token)\s*[:=]\s*['"]?[a-zA-Z0-9_-]{20,}/i, severity: "high" },
  // 中危
  { pattern: /you (?:are now|have become|must act as) a(?:n)? (?:different|new|other)/i, severity: "medium" },
  { pattern: /<[^>]*hidden|visibility\s*:\s*hidden|display\s*:\s*none/i, severity: "medium" },
  { pattern: /\[\[|\]\]|role\s*:\s*system/, severity: "medium" },
  // 低危
  { pattern: /<!--[\s\S]*?-->/, severity: "low", description: "HTML 注释" },
]
```

扫描与净化：

```typescript
export interface ScanResult {
  clean: boolean
  issues: Array<{
    pattern: string
    severity: "low" | "medium" | "high"
    description: string
    match: string
    position: number
  }>
}

export function scanForInjection(content: string): ScanResult
export function sanitizeContent(content: string): { sanitized: string; removed: number }
```

处理策略分级：

| 严重级别 | 处理方式 |
|---------|---------|
| high | 阻断，发出 `ContextOverflowError` 事件 |
| medium | 净化（移除匹配内容），附带警告说明 |
| low | 净化，但不阻断执行 |

防护入口点（`session/prompt.ts`）：
1. MCP resource 文本
2. `data:` URL 文本
3. 文件读取内容
4. 外部注入内容

---

## 5. 当前 OpenAGt 还没收口的地方

本次分析不能只报喜。代码已经前进，但工程收口还不完整。

### 5.1 验证结果

在 `packages/opencode` 下执行的结果如下：

#### 已通过

命令：

```bash
bun test test/provider/fallback-service.test.ts test/tool/partition-path-overlap.test.ts test/security/injection.test.ts
```

结果：

- 10 个测试全部通过
- 覆盖：
  - fallback service
  - tool partition/path overlap
  - injection scan/sanitize

这说明新接入能力的局部行为是可工作的。

#### 未通过

命令：

```bash
bun typecheck
```

当前失败点包括：

| 文件 | 问题 | 原因 |
|------|------|------|
| `src/provider/fallback.ts` | 引用了 `@/provider` 中并未导出的 `Model` | 旧 fallback 文件与新 fallback-service 并存，接口边界未统一 |
| `src/session/compaction.ts` | `currentUser` 的类型没有完成 user message narrowing | `MessageV2.WithParts.info.role` 联合类型收窄不完整 |
| `src/session/compaction/auto.ts` | 对 `part.state.output` 的访问依赖 completed 状态 | 类型层没完全证明 status === "completed" |
| `src/session/compaction/full.ts` | 对 `assistant message version` 的字段假设与实际类型不匹配 | `msg.info.version` 在某些消息类型中不存在 |
| `src/session/compaction/micro.ts` | `compacted` 字段写入位置与 `MessageV2.ToolPart` 类型定义不一致 | 字段路径应为 `state.metadata.compacted` 而非直接写在 state |
| `src/session/prompt.ts` | scheduler 输入在 `object` 与 `Record<string, unknown>` 之间存在类型不匹配 | 输入边界类型不精确 |
| `test/provider/fallback-service.test.ts` | mock/stub 的 Effect error type 与 branded ID 类型需收口 | 测试桩的类型不匹配 |

### 5.2 这意味着什么

这不是"功能没做"，而是：

1. 运行时链路已经基本接上
2. 类型系统和老代码边界还没有完全清理
3. 当前阶段更准确的判断应是：

**OpenAGt 已经进入"能力成形、工程收口中"的状态，而不是"功能空白"或"稳定完成"。**

---

## 6. Claude Code reference 的真实参考价值

### 6.1 应该吸收的部分

#### A. 工具调度纪律

Claude Code reference 的价值不在"有很多工具"，而在它把工具调用当成一个需要严格调度的执行系统：

1. **safe/unsafe 分组**：读类工具可并发，写类工具需串行
2. **同类工具批处理**：多个 read 可同时发出
3. **写入/执行类工具串行**：edit/write/bash 按序执行
4. **子进程失败传播**：bash 失败时中断后续依赖
5. **流式工具输出与 UI 联动**：SSE 实时推送工具状态

OpenAGt 现在已经开始吸收这条路线，但还需要继续完善：

1. 更精确的工具安全分类（当前 partition.ts 的分类还较粗）
2. 更强的冲突域建模（文件锁、端口锁等资源冲突）
3. bash/command 子进程级别的协同取消

#### B. 三层上下文压缩方法论

Claude Code 的核心经验不是"压缩"本身，而是：

1. **便宜的压缩先做**：时间阈值过滤（MicroCompact）
2. **接近上限时再做更激进压缩**：token 预算评估（AutoCompact）
3. **只有真正溢出才动用 LLM 总结**：Full Compact with LLM

OpenAGt 现在已经把这个分层思想接进来了，这是正确方向。后续重点不在"是否继续三层"，而在：

1. 类型收口（前述 typecheck 问题）
2. 压缩质量评估（如何衡量摘要质量）
3. 恢复精度（摘要后能否精确恢复上下文）
4. 对 summary reuse 的迭代优化（`full.ts` 的 `iterativeUpdate`）

#### C. 产品化交互细节

Claude Code reference 的强项还在于"长期打磨过的 CLI 操作感"：

1. 清晰的模式切换（plan mode / auto mode / manual mode）
2. 细粒度进度反馈（tool start/progress/done）
3. 连贯的权限交互（每个危险工具前确认）
4. 更强的 slash command 心智（`/ask`, `/test`, `/edit`）
5. 更成熟的失败解释与恢复提示

OpenAGt 想做成真正可 daily use 的开源 agent helper，必须补这类细节，而不是只堆功能点。

### 6.2 不应该照搬的部分

#### A. 巨型单体查询循环

Claude Code reference 里最典型的问题是"大量能力被卷进单一超大 query loop"。

这类结构的优点是产品打磨快，缺点是：

1. 可维护性差（>3000 行的单一文件）
2. 可替换性差（模块边界不清）
3. 测试边界难切（无法单元测试内部逻辑）
4. 开源协作成本高（新人难以介入）

OpenAGt 不应该为了"像 Claude Code"而回退到大型单体文件。

#### B. 闭源特性开关依赖

reference 中可见大量 feature-gated 内部模块。对 OpenAGt 来说，这一模式的参考价值有限，因为：

1. 它依赖内部基础设施（如内部 Claude 调用通道）
2. 很多能力无法在开源环境等价复现
3. 过度模仿会把架构带向"预留了很多坑但真实能力不落地"

---

## 7. Hermes Agent 的真实参考价值

### 7.1 应该吸收的部分

#### A. 轨迹压缩与离线数据能力

`trajectory_compressor.py` 很值得研究，因为它代表的是另一种思路：

1. **在线推理链路尽量保持简单**：不在线做复杂压缩
2. **离线对轨迹进行压缩、清洗、抽样和再利用**：离线 MapReduce 风格处理
3. **服务于训练、回放、质量分析、长时记忆整理**：多目标数据管道

这启发 OpenAGt：

1. **在线 compaction** 要服务当前会话稳定性（Micro/Auto/Full 三层）
2. **离线 compression / transcript processing** 要服务长期可学习性
3. 这两者不应该混成一个模块

#### B. 多入口 gateway 思维

Hermes 不是只做一个 CLI，它把 agent 视为长期运行体，然后从多入口接入：

1. CLI
2. 消息平台（Slack/Discord/Webhook）
3. scheduler（定时任务/cron）
4. gateway（统一入口）

OpenAGt 当前最接近的自然延伸不是马上接十几个平台，而是：

1. **先稳住 CLI + server**：这是核心通道
2. **再接 Flutter**：作为控制面板
3. **最后再讨论 webhook / notification / automation 入口**：gateway 模式

#### C. 技能、记忆、调度的一体化产品观

Hermes 很强的一点是，它不是把"memory / skills / cron"当插件彩蛋，而是当成 agent 产品的一等能力。

这对 OpenAGt 的启发不是照着做一套 Python memory system，而是：

1. **让 skill 不只是 prompt snippet**：技能应有结构化定义、版本、测试
2. **让 session summary 可沉淀为长期记忆候选**：compaction 产出 → 记忆库
3. **让后续自动化/提醒/复访机制与当前 session 数据模型兼容**：事件驱动而非临时凑合

### 7.2 不应该照搬的部分

#### A. Python 运行时并不适合作为 OpenAGt 新底座

Hermes 的运行时和 OpenAGt 当前栈差异太大：

| 维度 | Hermes | OpenAGt |
|------|--------|--------|
| 主语言 | Python | TypeScript |
| 运行时 | CPython | Bun/Node |
| 架构 | Monolith + 多渠道 gateway | 模块化 runtime + client/server |
| 特点 | 长期运行、离线处理 | 即时响应、在线推理 |

如果为了引入 Hermes 的某些强项而迁移底座，成本远高于收益。

#### B. "自学习叙事"不应先于工程稳定

Hermes 在 README 中强调：

1. self-improving
2. memory
3. skill creation
4. scheduling

这些都很吸引人，但对 OpenAGt 当前阶段来说，优先级必须排在以下事项之后：

1. typecheck 全绿
2. CLI 主链稳定
3. API 契约稳定
4. Flutter 对接成功

---

## 8. OpenAGt 与两份 reference 的架构对照

### 8.1 运行时模型

| 维度 | OpenAGt / OpenCode | Claude Code reference | Hermes Agent |
|------|------------------|----------------------|--------------|
| 主语言 | TypeScript | TypeScript | Python |
| 运行时 | Bun / Node | Bun | CPython |
| 核心形态 | 模块化 agent runtime + server | 高度产品化 CLI 单体 | 长期运行 agent + gateway |
| Session 管理 | 消息持久化 + 事件流 | 内存会话 | 长期会话 + 记忆 |
| 工具系统 | Registry + MCP | 内置工具集 | 技能系统 |
| Provider | 多 provider 抽象 | Anthropic only | 多种 |
| 适合 OpenAGt 的继承方式 | 直接作为底座继续演进 | 参考执行纪律与 UX | 参考长期运行与离线策略 |

### 8.2 Agent loop

| 维度 | 当前 OpenAGt 状态 | 技术实现 | 评估 |
|------|-----------------|---------|------|
| 主循环 | `session/prompt.ts` 驱动 | Effect + async generator | 已具备可扩展主链 |
| retry + fallback | 已接入 | `fallback-service.ts` + `shouldFallback()` | 方向正确，需类型收口 |
| tool scheduling | 已接入并发分区与路径冲突 | `partition.ts` + `path-overlap.ts` | 已跨过"全串行/全并发"的初级阶段 |
| compaction | 三层已接入 | `micro.ts` / `auto.ts` / `full.ts` | 已形成方法论雏形 |
| injection guard | 已接入内容入口 | `injection.ts` 扫描+净化 | 安全等级明显提升 |

### 8.3 工具系统

| 维度 | 当前 OpenAGt 状态 | 技术实现 | 下一步 |
|------|-----------------|---------|--------|
| 注册/发现 | 已有 ToolRegistry + MCP | `tool/registry.ts` + `mcp/` | 保持模块化，不走单体工具厂 |
| 并发 | 已区分 safe/unsafe | `CONCURRENCY_SAFE_TOOLS` / `UNSAFE_PATTERNS` | 丰富工具分类与冲突域 |
| 冲突检测 | 已有路径冲突检测 | `detectPathConflicts()` | 增加更细的资源锁语义 |
| 错误传播 | 仍偏基础 | 简单 throw/catch | 借鉴 Claude Code 的进程级取消策略 |

### 8.4 上下文管理

| 维度 | 当前 OpenAGt 状态 | 技术实现 | 评估 |
|------|-----------------|---------|------|
| 在线压缩 | 已有 micro / auto / full | `MICRO_COMPACT_TIME_THRESHOLD_MS = 5min` | 已具备产品级方向 |
| 旧 summary 复用 | `full.ts` 已开始支持 | `findExistingSummary()` + `iterativeUpdate` | 需要压缩质量验证 |
| 离线轨迹处理 | 尚弱 | 无 | 可借鉴 Hermes 的 trajectory compressor 思维 |

### 8.5 Provider 抽象

| 维度 | 当前 OpenAGt 状态 | 技术实现 | 评估 |
|------|-----------------|---------|------|
| 多 provider | 强 | `ProviderID` branded type + `Info` config schema | 这是 OpenAGt 相比 reference 的现实优势 |
| fallback chain | 已接入 | `FallbackState` + `chain[]` + `maxRetries` | 是"开源通用 agent"必须保留的能力 |
| 类型收口 | 未完成 | 多个 typecheck 错误待修复 | 目前最大工程短板之一 |

### 8.6 客户端策略

| 维度 | 当前 OpenAGt 状态 | 技术实现 | 评估 |
|------|-----------------|---------|------|
| CLI | 主战场 | `cli/cmd/` + `command/` | 必须先稳定 |
| Web/Desktop | 底座支持 | `server/routes/` + SSE | 可后续迭代 |
| Flutter | 已有独立包与基础依赖 | `packages/opencode_flutter/` | 应坚持"CLI 全绿后再接" |

---

## 9. OpenAGt 当前最有价值的差异化优势

和两份 reference 相比，OpenAGt 当前真正有潜力做成差异化产品的点，不是"更多功能"，而是下面三条。

### 9.1 开源、模块化、多 provider

Claude Code 很强，但闭源、Anthropic 中心化、很多能力对外不可复制。

Hermes 很完整，但技术栈与 OpenAGt 不同。

OpenAGt 如果做对了，会具备一个非常独特的位置：

1. 像 Claude Code 一样好用
2. 像 Hermes 一样可长期运行
3. 但同时保持：
   - TypeScript 生态
   - 多 provider（当前已支持 12+ providers）
   - 开源可改
   - 多端接入能力

### 9.2 Client/server 架构天然适合 Flutter

这是 OpenAGt 相比 CLI 单体 agent 最大的产品潜力。

只要 server 契约稳定，Flutter 就不需要"复制 agent runtime"，只需要：

1. 连接会话（SSE 长连接）
2. 消费事件流（`SessionEvent` 联合类型）
3. 响应权限请求（`permission` schema）
4. 展示 transcript / delta / tool state

因此，Flutter 的正确角色是"agent 的原生控制面板"，不是"第二套 agent 实现"。

### 9.3 安全和容错已经开始进入主链

很多开源 agent 项目到今天仍然停在：

1. 能跑
2. 能调工具
3. 能输出

OpenAGt 现在已经开始认真处理：

1. **provider failover**：fallback chain + retry logic
2. **prompt injection**：pattern scan + sanitize
3. **tool conflict**：path overlap detection
4. **context overflow**：three-layer compaction

这四类问题处理好了，才有资格谈"生产级 agent helper"。

---

## 10. OpenAGt 当前最关键的技术债

### 10.1 类型系统与运行时脱节

这是当前最明显的工程症状。

表面上看，功能已接入；但 `bun typecheck` 暴露出：

1. **新旧 fallback 模块重复存在**：`fallback.ts` vs `fallback-service.ts` 接口未统一
2. **`MessageV2.ToolPart` 状态收窄不够严谨**：`status: "completed"` 的 narrowing 不完整
3. **compaction 对 completed state 的假设没有完全在类型上表达**：直接访问 `part.state.output` 而不检查 status
4. **branded ID / Effect error type 在测试桩中没有统一**：mock 类型不匹配

如果不先清掉这些债，后面继续叠功能会迅速变脆。

### 10.2 `session/prompt.ts` 仍然过重

虽然 OpenAGt 没有走到 Claude Code 那种超大单体程度，但 `session/prompt.ts` 已经开始承担过多职责：

1. 主循环
2. 工具解析
3. 注入防护
4. fallback
5. compaction 调度
6. 提示词装配

这说明下一步架构整理应该是"抽行为边界"，不是再继续把逻辑往里堆。

建议拆分出的独立模块：

```
src/session/
  ├── prompt.ts           # 流程控制器（协调层）
  ├── scheduler.ts        # 工具调度逻辑
  ├── injection-guard.ts  # 注入防护逻辑
  ├── provider-orch.ts    # provider failover 编排
  └── compaction.ts       # 压缩调度（已是独立文件）
```

### 10.3 Flutter 还没有进入可验证状态

从 `packages/opencode_flutter/pubspec.yaml` 看，Flutter 包已经搭起基础依赖，但还不能据此判断它已与 server 契约稳定耦合。

当前正确判断是：

1. Flutter 是正确方向
2. 但不是当前工程主战场
3. 它必须等 CLI/Server API 与事件模型收口后再推进

---

## 11. 重构后的优先级建议

### Phase 1：先把 CLI / Server 做到"可信"

优先级最高，且必须先于 Flutter。

#### P1. 收口 typecheck

目标：

1. **删除或并入旧 `src/provider/fallback.ts`**：统一接口边界
2. **为 compaction 的 completed tool state 建立明确 type guard**：

   ```typescript
   function isCompletedToolPart(part: MessageV2.Part): part is MessageV2.ToolPart & { state: { status: "completed" } } {
     return part.type === "tool" && part.state.status === "completed"
   }
   ```

3. **统一 `ToolPartition` 的 `Record<string, unknown>` 输入边界**：使用更精确的输入类型
4. **让 fallback 测试桩符合 branded ID / Effect 类型约束**：统一 mock 策略

如果这一步不做，当前新增能力只能算"功能存在"，不能算"工程完成"。

#### P2. 把 `session/prompt.ts` 拆出清晰责任面

建议拆分为可测试的小层：

1. **tool scheduling**：工具分区、路径冲突检测、调度执行
2. **injected content guard**：注入扫描与净化
3. **provider failover orchestration**：fallback 链管理
4. **model invocation preparation**：prompt 装配、context 评估

注意：不是为了抽象而抽象，而是为了把主循环重新变成"可读的流程控制器"。

#### P3. 补一条 CLI 端到端 smoke

建议覆盖：

```bash
# 1. 创建会话
opencode session create
# 2. 发送消息（触发读文件工具）
opencode ask "read package.json"
# 3. 验证 safe tool 并发（多个 glob/read 同时发出）
# 4. 验证 unsafe tool 串行（edit 在 bash 后）
# 5. 触发 retry/fallback（mock provider 失败）
# 6. 验证 SSE 事件流一致性
```

这比再补十个局部单测更能反映当前系统是不是能跑通。

### Phase 2：再把 Flutter 作为控制面板接进来

前提：

1. CLI smoke 通过
2. API 契约冻结一轮
3. SSE 事件 shape 不再频繁变化

Flutter 只需要做四件事：

1. 会话列表（session list API）
2. 发送消息（send message API）
3. 流式事件展示（SSE consumer）
4. 权限回复（permission API）

不要在 Flutter 侧重新发明 agent runtime。

### Phase 3：最后补长期能力

等 CLI + Flutter 稳定后，再考虑：

1. **离线 transcript/trajectory compression**：参考 Hermes `trajectory_compressor.py`
2. **长期记忆候选提取**：compaction 摘要 → 记忆库
3. **自动化/cron/提醒**：事件驱动的任务调度
4. **多入口 gateway**：webhook / notification 通道

这部分更适合吸收 Hermes 的设计，而不是急着塞进当前主循环。

---

## 12. 建议保留、建议新增、建议避免

### 12.1 建议保留

| 能力 | 位置 | 理由 |
|------|------|------|
| 多 provider 抽象 | `provider/schema.ts` | 开源通用的核心竞争力 |
| Effect 驱动的 service/layer | 各模块 | 模块依赖清晰，可测试 |
| client/server 事件架构 | `v2/session-event.ts` | 支持多端接入 |
| 三层压缩 | `compaction/micro|auto|full.ts` | 方法论成熟 |
| fallback / injection / partition | 各 security 文件 | 可靠性能力 |

### 12.2 建议新增

| 能力 | 位置 | 优先级 | 理由 |
|------|------|--------|------|
| compaction 质量评估基线 | `compaction/` | P2 | 验证摘要有效性 |
| fallback hop 的可观测性字段 | `fallback-service.ts` | P1 | 调试和监控 |
| tool execution 冲突域细粒度定义 | `tool/` | P2 | 资源锁语义 |
| transcript 离线压缩分析工具 | `scripts/` | P3 | 长期记忆 |
| CLI smoke 与回归集 | `test/cli/` | P1 | 端到端验证 |

### 12.3 建议避免

1. **把 Claude Code 的产品复杂度直接搬成单体文件**：维护性灾难
2. **在 typecheck 未收口前继续加大功能面**：技术债累积
3. **让 Flutter 过早绑定不稳定 API**：重写成本高
4. **把 Hermes 的"自学习叙事"优先级放在工程稳定之前**：地基没打好

---

## 13. 事件模型与 SSE 协议规范

### 13.1 SessionEvent 类型体系

```typescript
// src/v2/session-event.ts

// 基础事件
Prompt         // 用户输入事件
Synthetic      // 合成文本事件（如 auto-continue）

// Step 事件（模型调用级别）
Step.Started   // 模型调用开始
Step.Ended     // 模型调用结束（包含 cost、tokens）

// Text 事件（文本输出）
Text.Started   // 文本块开始
Text.Delta     // 文本增量（流式）
Text.Ended     // 文本块结束

// Reasoning 事件（推理过程）
Reasoning.Started
Reasoning.Delta
Reasoning.Ended

// Tool 事件（工具调用）
Tool.Input.Started    // 工具输入开始
Tool.Input.Delta      // 工具输入增量
Tool.Input.Ended      // 工具输入结束
Tool.Called           // 工具被调用
Tool.Success          // 工具执行成功
Tool.Error            // 工具执行失败

// 系统事件
Retried        // 重试事件
Compacted      // 压缩完成事件
```

### 13.2 事件 Schema 定义示例

```typescript
// Text.Delta 事件
export class Delta extends Schema.Class<Delta>("Session.Event.Text.Delta")({
  id: ID,                              // 事件唯一 ID
  type: Schema.Literal("text.delta"), // 事件类型
  timestamp: Schema.DateTimeUtc,       // 时间戳
  delta: Schema.String,                // 文本增量
  metadata: Schema.Optional(...)
})

// Tool.Called 事件
export class Called extends Schema.Class<Called>("Session.Event.Tool.Called")({
  id: ID,
  type: Schema.Literal("tool.called"),
  timestamp: Schema.DateTimeUtc,
  callID: Schema.String,               // 工具调用 ID
  tool: Schema.String,                 // 工具名称
  input: Schema.Record(...),           // 工具输入参数
  provider: Schema.Struct({
    executed: Schema.Boolean,          // 是否已执行
    metadata: Schema.Optional(...)
  })
})
```

### 13.3 SSE 推送格式

客户端订阅：`GET /api/sessions/{sessionID}/events`

```typescript
// SSE 事件格式
event: text.delta
data: {"id":"evt_xxx","type":"text.delta","delta":"Hello","timestamp":"2026-04-19T12:00:00Z"}

event: tool.called
data: {"id":"evt_yyy","type":"tool.called","callID":"call_001","tool":"read","input":{"path":"/foo/bar.ts"}}

event: step.ended
data: {"id":"evt_zzz","type":"step.ended","reason":"stop","cost":0.0023,"tokens":{"input":1200,"output":350,"reasoning":0,"cache":{"read":0,"write":0}}}
```

---

## 14. 配置 Schema 详细规范

### 14.1 Provider Config Schema

```typescript
// src/config/provider.ts

// Provider 配置
{
  "provider": {
    "anthropic": {
      "api": "https://api.anthropic.com",
      "options": {
        "apiKey": "${ANTHROPIC_API_KEY}",
        "timeout": 300000,           // 5 分钟
        "chunkTimeout": 60000        // 60 秒
      },
      "fallback": {
        "enabled": true,
        "chain": [
          { "provider": "openrouter", "model": "anthropic/claude-3.5-sonnet" }
        ],
        "maxRetries": 3,
        "retryOnRateLimit": true,
        "retryOnServerError": true
      }
    }
  }
}
```

### 14.2 Model Schema

```typescript
// 支持的模型字段
{
  "id": "claude-sonnet-4-20250514",
  "name": "Claude Sonnet 4",
  "family": "claude",
  "release_date": "2025-05-14",
  "cost": {
    "input": 0.003,      // $ / 1K tokens
    "output": 0.015,
    "cache_read": 0.0003,
    "cache_write": 0.003
  },
  "limit": {
    "context": 200000,   // 最大上下文
    "output": 8192
  },
  "reasoning": true,
  "tool_call": true,
  "modalities": {
    "input": ["text", "image"],
    "output": ["text"]
  }
}
```

---

## 15. 结论

经过这轮基于源码和验证结果的重构分析，可以给出更准确的总判断：

1. OpenAGt 现在已经不是"概念阶段"，而是"核心能力已经成形，但工程收口还在进行中"的阶段。
2. 它最值得坚持的路线，是继续基于 OpenCode 演进，而不是换底座。
3. Claude Code reference 应该被当成：
   - 工具调度纪律参考
   - 压缩分层参考
   - 产品交互成熟度参考
4. Hermes Agent 应该被当成：
   - 长期运行形态参考
   - 离线轨迹处理参考
   - 记忆/技能/调度体系参考
5. OpenAGt 未来最有机会形成差异化的位置，是：

**一个开源、多 provider、可多端接入、具备可靠性主链的 agent helper 平台。**

当前最重要的不是继续铺功能，而是先把下面三件事做实：

1. `bun typecheck` 全绿
2. CLI / Server smoke 跑通
3. API 契约稳定后再接 Flutter

只有这样，这个项目才会从"很有潜力"真正进入"可以长期积累和发布"的状态。
