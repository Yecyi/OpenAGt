# Agent Studio vs Claude Code 技术细节与算法对比报告

> 基于当前工作区源码快照的实现级分析。`Claude Code` 版本来自 `package.json` 中的 `@anthropic-ai/claude-code-source@2.1.88`，`Agent Studio` 是同仓库内的本地 monorepo（`agent_studio/package.json`）。

## 结论摘要

这不是一场“谁功能更多”的比较，而是两套 agent runtime 在上下文治理、记忆、工具循环、安全模型和持久化真相源上的工程取向对比。

- `Claude Code` 更强的部分，是 `cache-safe prompt engineering`、`context governance`、`compaction/continuity`、`远程会话与生产级 feature gate`。它的系统更像一套长期在线、跨 transport、成本敏感、强运营约束下演化出来的生产系统。
- `Agent Studio` 更强的部分，是 `架构清晰度`、`本地优先可审计性`、`timeline/history/memory 分层`、`权限与 PowerShell 安全判定的确定性`。它更像一套“开发者可以真正读懂、控制、恢复和重构”的本地 runtime。
- 两者最大差距，不是某一个工具或 prompt 片段，而是 `Claude Code` 在“如何稳定地喂模型上下文、如何控制 cache miss、如何跨轮次保持连续性”上已经形成体系。
- `Agent Studio` 当前最有价值的优势，不是比 Claude 更复杂，而是比 Claude 更容易成为一个可以继续演化的、可验证的本地 agent 内核。

## 快速对比表

| 维度                      | 谁更强       | 为什么                                                                        | 代价                                       |
| ------------------------- | ------------ | ----------------------------------------------------------------------------- | ------------------------------------------ |
| Prompt 架构               | Claude Code  | 分层清晰，且显式做了静态/动态边界与 cache control                             | 实现分散，理解成本高                       |
| Prompt 可解释性           | Agent Studio | `PromptSection` 编译器把来源、channel、priority、cacheScope 全都显式化        | cache 策略还不够成熟                       |
| Context governance        | Claude Code  | prompt、compaction、session memory、bridge continuity 是联动体系              | 工程复杂度高，很多逻辑跨模块分散           |
| History / timeline recall | Agent Studio | SQLite materialized index + FTS5 + scope-aware recall，真相源明确             | 仍偏本地单机体系，远程 continuity 较弱     |
| Memory 机制               | 各有优劣     | Claude 强在后台抽取与低打扰；Agent Studio 强在 thread/workspace/timeline 分层 | Claude 不透明；Agent Studio 还缺统一治理层 |
| Tool loop                 | Agent Studio | continuation、repair、synthetic result、stall detection 都写成显式状态机      | 生产经验积累还不如 Claude 深               |
| 权限与安全                | Agent Studio | 本地策略引擎更确定，Windows PowerShell AST 分析更扎实                         | 灵活性和远程管理能力较弱                   |
| 远程连续性                | Claude Code  | bridge、session ingress、keep-alive、pointer refresh 更成熟                   | 系统更重，也更难本地审计                   |
| 可审计与可恢复            | Agent Studio | transcript、history、sidecar、timeline 都是本地持久化真相源                   | 需要额外治理来避免上下文碎片化             |

## 1. Prompt System 对比

### Claude Code：分层 prompt 已经和 cache 策略绑定

Claude Code 的 system prompt 不是单个大字符串，而是三层来源组合：

- `defaultSystemPrompt`
- `userContext`
- `systemContext`

`fetchSystemPromptParts()` 明确并行获取这三部分；`buildEffectiveSystemPrompt()` 再处理 `override / custom / append / agent-specific` 的组合关系。也就是说，Claude 的 prompt 不是“拼接文本”，而是“带优先级和替换规则的构造过程”。

证据：

- `src/utils/queryContext.ts:44-60`
- `src/utils/queryContext.ts:116-177`
- `src/utils/systemPrompt.ts:41-75`
- `src/context.ts:116-149`
- `src/context.ts:155-188`

更关键的是，Claude 把“怎么写 prompt”与“怎么稳定命中缓存”绑在了一起。`getSystemPrompt()` 先构造静态 section 和动态 section，然后在静态块与动态块之间插入 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`。`splitSysPromptPrefix()` 再把 prompt 拆成 `global/org/uncached` 不同 cache scope 的 block。这个设计说明 Claude 已经把 prompt 当作“可缓存对象”来治理，而不是只把它当作文案。

证据：

- `src/constants/prompts.ts:444-575`
- `src/utils/api.ts:297-321`

此外，Claude 连工具 schema 都做了 session-stable cache。`createBetaTool()` 在 `src/utils/api.ts` 中用 `inputJSONSchema` 参与 key，避免 mid-session feature flip 或 tool prompt 漂移导致工具数组序列化字节变化。这是很典型的“生产级 prompt/cache 成本治理”思路。

证据：

- `src/utils/api.ts:137-230`

### Agent Studio：结构更清楚，但 cache 工程还没追上

Agent Studio 已经不再是随手堆字符串。`compilePromptSections()` 把 prompt 编译成带 metadata 的 `PromptSection`：

- `channel`: `system_instruction` / `user_context` / `system_context`
- `priority`
- `cacheScope`
- `source`
- `sourceRef`

并且把 `history_index`、`memory_mechanics`、`provider_patch`、`workspace_memory_curator_patch` 都纳入统一 section 编译流程。

证据：

- `agent_studio/packages/core-runtime/src/index.ts:7118-7248`
- `agent_studio/packages/core-runtime/src/index.ts:7362-7418`

这套设计的优点非常明确：比 Claude 更容易看清“这一段 prompt 为什么存在、来自哪里、缓存粒度是什么”。问题也同样明确：它已经有了 section compiler，但还没有 Claude 那种成熟的 cache-safe boundary 策略。它做的是“显式 prompt 组装”，Claude 做的是“显式 prompt 组装 + cache 命中治理”。

另外，Agent Studio 已经实现了基于预算的 section omission：当 prompt 预算超限时，按固定顺序裁掉 `workspace_memory_digest`、`history_recall_digest`、`thread_memory_digest` 等系统上下文段。这说明它已有 prompt budgeting，但还主要是“删减哪些上下文”，不是“如何最大化缓存稳定性”。

证据：

- `agent_studio/packages/core-runtime/src/index.ts:7418-7465`

### 小结

这一维度上，Claude Code 不是“prompt 写得更好”，而是“prompt 已经工程化成了 cache-sensitive runtime object”。Agent Studio 的优势是结构可读性，Claude 的优势是成本与稳定性优化已经深入实现细节。

## 2. Context / Compaction / Continuity 对比

### Claude Code：上下文治理是一个联动系统

Claude 的上下文治理不能只看 prompt。它至少包含四层联动：

- prompt 分层与 cache 边界
- `/compact` 体系
- session memory 抽取
- remote bridge / session continuity

`/compact` 流程本身就说明这一点：它会先处理 `getMessagesAfterCompactBoundary()`，然后区分 `session-memory compaction`、`reactive compact`、`legacy compact`，成功后清理 `getUserContext` cache、标记 `post-compaction` 状态，并执行 post-compact cleanup。也就是说，compaction 不是简单摘要，而是上下文窗口治理的一环。

证据：

- `src/commands/compact/compact.ts:40-124`
- `src/bootstrap/state.ts:253-256`
- `src/bootstrap/state.ts:769-779`

Claude 在 continuity 上也明显更成熟。`replBridge.ts` 中的 `HybridTransport` 处理 WebSocket 断线自动重连、POST 写入独立继续、超长时间失败后的回退，以及 `bridge pointer` 定时刷新和 `keep_alive` 保活。这些都不是“聊天客户端功能”，而是“会话连续性控制平面”的实现。

证据：

- `src/bridge/replBridge.ts:1444-1488`
- `src/bridge/replBridge.ts:1508-1536`

### Agent Studio：continuity 被拆成更容易理解的几个真相源

Agent Studio 的做法不同。它没有把 continuity 深埋到 bridge 和 cache 里，而是显式拆成：

- `thread_continuity_digest`
- `thread_memory_digest`
- `workspace_memory_digest`
- `history_recall_digest`
- `workspace_inventory`
- `git_snapshot`

这些 section 由 `buildSystemContextSections()` 统一生成，并按不同 `cacheScope` 注入。这样做的好处是：每个上下文块的职责都很清楚。代价是：这些块之间还没有像 Claude 那样被一个更成熟的 compaction/continuity 状态机统一治理。

证据：

- `agent_studio/packages/core-runtime/src/index.ts:7689-7810`

### 小结

Claude 在这一维的强项，是“治理体系成熟”；Agent Studio 的强项，是“上下文部件边界清晰”。前者更像生产系统，后者更像可演化内核。

## 3. Memory / History / Timeline 算法对比

### Claude Code：后台抽取式 session memory

Claude 的 session memory 是后台维护的 markdown 文件。它不是显式的数据库对象，也不是面向用户开放的 timeline 查询，而是一个自动维护的对话记忆摘要。

其核心算法有三个点：

1. 使用 token threshold 和 tool-call threshold 决定何时抽取。
2. 只有在自然断点或阈值同时满足时才触发，避免频繁抽取。
3. 通过 forked subagent 执行抽取，减少对主上下文和主缓存的污染。

`shouldExtractMemory()` 中可以直接看到：

- 初始化阈值
- `minimumTokensBetweenUpdate`
- `toolCallsBetweenUpdates`
- “最后一个 assistant turn 没有 tool call 时也可触发”的自然断点策略

证据：

- `src/services/SessionMemory/sessionMemory.ts:2-5`
- `src/services/SessionMemory/sessionMemory.ts:134-170`

真正的抽取流程则通过 `runForkedAgent()` 运行，并使用 `createCacheSafeParams(context)`。这里的重点不是“它有子代理”，而是“它用隔离上下文来维护 memory file，并把这个动作做成后台机制”。

证据：

- `src/services/SessionMemory/sessionMemory.ts:300-349`
- `src/services/SessionMemory/sessionMemory.ts:357-375`

### Agent Studio：显式分层式记忆系统

Agent Studio 在记忆上的设计思路明显不同。它把“记忆”拆成三个层次：

- `thread memory`：线程内持续压缩的工作状态
- `workspace memory`：跨线程 durable memory
- `timeline/history recall`：精确历史检索层

这里最值得注意的是：Agent Studio 并不试图让 memory 同时承担“摘要”和“历史回放”两个职责。精确历史被单独交给 timeline。

### History recall：信号识别 + scope 选择 + source 选择

`buildHistoryRecall()` 的算法非常直白：

1. 先根据用户输入识别 `historySignal`
2. 决定 scope 是 `current_thread` 还是 `workspace`
3. 决定 `includeMessages / includeTranscript / includeHistory`
4. 调 `queryThreadTimeline()`
5. 把结果压成 digest 注入 system context

这意味着 Agent Studio 的 history recall 不是一个黑箱，而是一个相当明确的启发式检索器。

证据：

- `agent_studio/packages/core-runtime/src/index.ts:7618-7686`
- `agent_studio/packages/core-runtime/src/index.ts:1678-1748`

### Timeline：SQLite materialized index + FTS5 + fallback LIKE

Agent Studio 的 timeline 查询路径是这一整套设计里最“数据库工程化”的部分。

`queryTimelineCandidates()` 的路径是：

- 先确保 session 的 timeline index 已建立
- 按 `sessionIds/workspaceId/time/source` 过滤
- 如果无 query，直接按时间排序取最近项
- 如果能构造 FTS 表达式，则走 `timeline_items_fts MATCH`
- 否则退回 `LIKE` 搜索

这本质上是一个 `materialized timeline index`，而不是临时在 transcript 上做字符串扫一遍。

证据：

- `agent_studio/packages/storage/src/index.ts:3759-3881`
- `agent_studio/packages/storage/src/index.ts:4766-4805`
- `agent_studio/packages/storage/src/index.ts:6099-6173`

### Workspace memory materialization：白名单 + 冲突检测 + 置信度分流

Agent Studio 的 workspace memory materialization 也不是简单“把子代理返回值写进库”。`materializeWorkspaceMemoryAgentResult()` 至少做了三层控制：

- 类型必须在 `allowedTypes` 白名单内
- 与已有 accepted memory 发生标题/语义冲突时要特殊处理
- 根据触发源、是否人工 first-party capture、置信度和接受策略，分流为 `accepted / candidate / rejected`

这说明 Agent Studio 的 workspace memory 已经开始向“受治理的 durable knowledge layer”演化，而不是纯文本笔记。

证据：

- `agent_studio/packages/core-runtime/src/index.ts:6127-6208`

### 小结

Claude 的 memory 更成熟在“低打扰、后台抽取、与 compaction 配合”；Agent Studio 更成熟在“把摘要、长期记忆、精确历史分层”。如果只看架构清晰度，Agent Studio 更好；如果看长期生产经验，Claude 更深。

## 4. Tool Loop / 权限 / 安全 对比

### Agent Studio：tool loop 被写成显式 continuation algorithm

Agent Studio 的 README 直接把 tool loop 定义为“stateful continuation algorithm”，这和很多简单的“一轮 tool call -> 一轮回答”实现不是一回事。

核心流程包括：

- 维护 `pendingToolCalls`
- 工具结果写回对话
- continuation 前做 `tool_call -> tool_result` pairing repair
- 缺失结果合成 synthetic tool result
- 对重复/空转批次做 stall detection
- 根据执行类型和进展动态调整 continuation timeout

证据：

- `agent_studio/README.md:169-210`
- `agent_studio/packages/core-runtime/src/index.ts:3335-3437`
- `agent_studio/packages/core-runtime/src/index.ts:3621-3660`
- `agent_studio/packages/core-runtime/src/index.ts:3860-3898`
- `agent_studio/packages/core-runtime/src/index.ts:6746-6801`
- `agent_studio/packages/core-runtime/src/index.ts:6863-6880`
- `agent_studio/packages/core-runtime/src/index.ts:6916-6928`

这套实现的最大优点是：状态机是可读的。你可以明确指出哪一步在做 repair，哪一步在做 synthetic closure，哪一步在做 stall 判断。

### Claude Code：工具和权限补偿更成熟，但逻辑更分散

Claude 的对应能力不是没有，而是散在更复杂的 CLI / bridge / control response 路径里。`handleOrphanedPermissionResponse()` 就是一个典型例子：它专门处理“权限响应迟到或孤儿化”的情况，并防御重连后重复交付导致的 tool use 重放。

这类实现说明 Claude 在真实网络与远程控制环境下踩过很多坑，所以修复逻辑更厚。但从本地阅读体验看，它远不如 Agent Studio 的 continuation loop 清楚。

证据：

- `src/cli/print.ts:5241-5304`

### 权限模型：Agent Studio 更像确定性本地策略引擎

`PermissionEngine.evaluate()` 的判定路径非常明确：

- 先看 session approvals / denials
- 再看 workspace disabled / allowed 规则
- 再看 `permissionMode`
- `plan` 下直接硬拦截写入和不安全执行

这里没有太多隐式行为，属于“能推导、能解释、能测试”的权限模型。

证据：

- `agent_studio/packages/control-plane/src/index.ts:96-170`
- `agent_studio/README.md:544-595`

Claude 的权限体系则更像生产系统的一部分：更强、更灵活，但也更依赖环境、远程设置、feature gate 和恢复路径。它适合复杂环境，不适合快速让本地开发者完全看清楚全部判断链路。

### Windows 安全：Agent Studio 的 PowerShell AST 分析是实打实的优势

这一点值得单独列出来。Agent Studio 在 Windows 下不是只做字符串匹配，而是调用 PowerShell parser 做 AST 级分析，检查：

- redirection
- script block expression
- subexpression
- statement count
- commandNames

这比常见的“禁几个关键字”策略更稳，也比很多跨平台 agent 工具对 Windows 的支持认真得多。

证据：

- `agent_studio/README.md:620-637`
- `agent_studio/packages/tool-runtime/src/tools-process.ts:139-190`

## 5. Storage / Inspectability / Sub-agent 对比

### Agent Studio：本地持久化真相源更明确

Agent Studio 的 README 已经直接说明：thread transcripts、file history、task output、tool results 都本地持久化，而且历史不是每轮都重新注入 prompt。换句话说，它把“存储真相源”和“模型上下文”分开了。

证据：

- `agent_studio/README.md:154-160`
- `agent_studio/README.md:241-249`

再结合 timeline index、tool sidecar、history records，可以看到 Agent Studio 的核心强项是：**所有重要行为都尽量以本地存储对象存在，而不是只存在于一段过去的会话文本里。**

### Claude Code：更成熟，但可审计性不如 Agent Studio 直观

Claude 当然也有 session persistence、bridge pointer、session state、compaction 状态等机制，但它们的主要目标是恢复与连续性，不是把系统设计成“本地可审计数据库”。这也是两者定位的根本差异。

### Sub-agent：Claude 更成熟，Agent Studio 更可控

Claude 在 session memory 里使用 `runForkedAgent()`，重点是隔离主上下文并复用 cache-safe 参数。这体现的是“子代理已经是主系统的一部分”。

证据：

- `src/services/SessionMemory/sessionMemory.ts:315-325`

Agent Studio 也有 workspace memory curator sub-agent，但整体更保守：它复用当前线程模型，没有单独的 memory profile 或独立 memory model override。这个选择降低了复杂度，也限制了优化空间。

证据：

- `agent_studio/packages/core-runtime/src/index.ts:7310-7320`
- `agent_studio/packages/core-runtime/src/index.ts:5678-5728`
- `agent_studio/README.md:768-770`

## 6. 综合判断

### 如果目标是生产成熟度

`Claude Code` 更强。

原因不是它“功能更多”，而是它在以下方面已经形成闭环：

- prompt cache 边界设计
- tool schema 稳定化
- compaction 与 session memory 联动
- bridge / remote continuity
- orphaned permission / reconnect replay 防御

这是一套典型“线上跑久了以后长出来的系统”。

### 如果目标是本地可控、可审计、可继续重构

`Agent Studio` 更有结构优势。

因为它已经把几个最难做乱的部分拆开了：

- prompt section compiler
- timeline index
- thread memory / workspace memory
- continuation tool loop
- permission / trust / access

这些边界在当前代码里都比较清楚，后续要做产品化重构、实验新算法、或增加可视化调试，成本都更低。

### 最关键的判断

Claude Code 当前领先的，不是某个局部 feature，而是 **context governance**。

Agent Studio 当前领先的，不是某个单点算法，而是 **runtime transparency**。

## 7. Agent Studio 下一步最值得借鉴的 3 件事

### 1. 引入真正的 cache-safe prompt boundary 与 tool schema stability

现在 Agent Studio 已经有 `PromptSection` 和 `cacheScope`，但还缺类似 Claude 的：

- 静态/动态 boundary marker
- API block-level cache strategy
- tool schema session-stable cache

这是最该补的第一层，因为它直接影响成本、稳定性和上下文可预测性。

### 2. 把 history recall 与 workspace memory retrieval 统一成 context governance 层

现在 Agent Studio 的 history recall、thread memory、workspace memory 已经都存在，但更像“几个好模块”。下一步应该把它们统一为一个更明确的上下文治理策略层，回答三个问题：

- 当前轮需要精确历史，还是摘要记忆？
- 哪些上下文块应该优先保留？
- 哪些块应该因为 cache 或预算原因被延迟、降级或 sidecar 化？

这会把它从“模块齐全”推向“系统闭环”。

### 3. 补一层像 Claude 那样的 compaction/continuity 状态机

现在 Agent Studio 更像在做 prompt budgeting，而 Claude 已经在做：

- compaction 后状态标记
- cache reset / post-compact cleanup
- continuity 信号与远程恢复
- session memory 与 compaction 联动

Agent Studio 不一定要照搬 Claude 的 bridge 体系，但应该补一个统一的 `compaction/continuity state machine`。否则系统上下文仍然会越来越依赖“当前 prompt 里碰巧塞进去了什么”。

## 最后判断

一句话概括：

- `Claude Code` 是更成熟的生产级 agent runtime。
- `Agent Studio` 是更清楚、更可控、更适合继续做本地产品化演化的 agent runtime。

如果让 Claude 给 Agent Studio 传一项核心能力，应该传 `context governance`。

如果让 Agent Studio 反过来给 Claude 传一项核心能力，应该传 `local auditability`。
