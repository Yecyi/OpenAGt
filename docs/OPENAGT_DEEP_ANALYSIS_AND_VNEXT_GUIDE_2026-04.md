# OpenAGt 项目深度分析与下一版本改进指南

日期：2026-04-30

## 摘要

OpenAGt 已经不是单一 CLI 工具，而是一个以 `packages/openagt` 为核心、面向 CLI、TUI、Server、SDK 的 backend-first agent runtime monorepo。

这个项目最强的资产，是把多种交互表面统一收敛到同一个 session-centric runtime 上：请求进入后，模型在持久会话中循环调用工具，工具输出继续反馈回同一执行回路，直到任务结束。

下一版本最应该做的，不是继续横向扩展功能，而是完成一次可靠性和边界收敛：补实例隔离、补安全执行闭环、补调度扩展性、补构建与发布确定性。

## 调查范围

- 仓库整体 monorepo 结构
- `packages/openagt` 运行时主架构
- 会话系统、工具系统、协调器、状态与缓存、安全与沙箱、事件总线
- 测试、CI、构建、发布与文档链路

## 调查方法

- 审阅仓库结构与包边界
- 审阅核心入口、运行时装配和关键服务文件
- 审阅测试目录、CI 配置、发布校验脚本
- 交叉检查状态隔离、安全判定、事件契约、fallback、sandbox 等高风险路径

## 一、项目总体判断

### 1.1 项目定位

OpenAGt 是一个 backend-first、本地优先的 agentic coding runtime。它不是把模型简单包成命令行，而是围绕持久 session、工具调用、权限判定、安全边界和多步协作构建了一整套运行时。

核心包为：

- `packages/openagt`：主运行时、CLI、TUI、Server、会话、工具、Provider、安全、存储、协调器
- `packages/sdk/js`：JS SDK 与服务端交互契约
- `packages/app`：前端应用
- `packages/ui` / `packages/shared` / `packages/plugin`：共享 UI、公共能力与扩展面

### 1.2 核心架构判断

项目当前的核心设计是正确的：

- 统一运行时，而不是为 CLI、Server、SDK 各自维护独立实现
- 以 session 为主执行边界，而不是一次性 completion
- 把权限、安全、sandbox、tool scheduling 作为一等运行时能力
- 把 subagent 与 coordinator 从“prompt 技巧”提升为结构化任务执行系统

但 `packages/openagt` 的职责已经明显膨胀，进入了“核心包过大、边界开始模糊、状态与契约容易漂移”的阶段。

## 二、架构现状分析

### 2.1 Monorepo 结构

仓库 `packages/` 当前主要包含：

- `openagt/`
- `app/`
- `sdk/`
- `ui/`
- `shared/`
- `plugin/`
- `function/`
- `enterprise/`
- `console/`

同时还能看到 `opencode/`、`opencode_flutter/`、`openagt_flutter/`、`web/` 等目录，说明项目仍处于命名与产品面迁移期，兼容成本仍然存在。

### 2.2 主入口与启动流程

主入口位于：

- `packages/openagt/src/index.ts`

该入口负责：

- broker 模式切换
- 全局日志与进程元数据初始化
- 一次性数据库迁移
- CLI 命令注册与运行

这说明系统采用的是单主入口、多能力分发模式。

### 2.3 运行时装配方式

运行时总装配位于：

- `packages/openagt/src/effect/app-runtime.ts`

这里通过 `Layer.mergeAll(...)` 将大量服务并入 `AppLayer`，包括：

- Bus
- Config
- Storage
- Provider / ProviderFallback
- Session / Prompt / Processor / Summary / Compaction
- ToolRegistry
- MCP / LSP
- Coordinator
- Personal memory

这说明项目已经形成统一 Effect 依赖图，但也意味着核心层耦合面很大，任何服务边界调整都可能影响启动和运行时行为。

### 2.4 核心域划分

`packages/openagt/src` 的主要域划分比较清晰：

- `session/`：会话主循环、消息、压缩、任务运行时
- `tool/`：工具定义、执行规划、路径分析、权限元数据
- `provider/`：模型提供商抽象、fallback、鉴权
- `security/` / `permission/` / `sandbox/`：命令风险分析、执行策略、隔离边界
- `server/`：HTTP / SSE / WebSocket 暴露层
- `coordinator/`：DAG 任务调度、多阶段执行、专家流
- `personal/`：更长生命周期的记忆与 inbox 能力

这套分层从概念上是成立的，但实际代码已经出现“同一能力在多个子系统各自演进”的迹象。

## 三、项目优势

### 3.1 同一运行时复用多种产品表面

这是项目最强优势。CLI、TUI、Server、SDK 都围绕同一 session runtime 工作，减少了行为分叉和重复实现。

### 3.2 会话模型成熟

系统不是“输入一次、输出一次”的薄封装，而是具备：

- 持久消息历史
- system prompt 组装
- tool loop
- summary / compaction
- memory 注入
- structured output

这是一个真实的 agent runtime，而不是简单 LLM wrapper。

### 3.3 协调器能力已经具备平台潜力

`Coordinator Runtime` 已经支持：

- 依赖关系
- `read_scope` / `write_scope`
- `research` / `implement` / `verify`
- 任务等待、取消、重试、汇总

这说明项目已具备把“单 agent”扩展为“任务图驱动系统”的基础。

### 3.4 测试与发布链路基础较好

`packages/openagt/test` 按功能域拆分较细，测试覆盖面明显好于一般工具项目。`script/release-verify.ts` 也说明发布前校验已经具备较强工程意识。

## 四、关键风险与设计债

### 4.1 实例级状态隔离不完整

最值得优先处理的问题，是跨实例、跨工作区状态泄漏风险。

证据：

- `packages/openagt/src/session/system.ts`

问题点：

- `environmentMemo` 使用固定 key：`"environment"`
- hash 只依赖当天日期
- 但缓存值中包含模型 ID、工作目录、workspace 路径、git 状态等实例相关信息

影响：

- 同一天不同项目、不同模型、不同工作区之间可能复用错误环境提示
- 这会直接影响 prompt 正确性和多实例行为一致性

### 4.2 事件持久化是全局文件，不是实例分区

证据：

- `packages/openagt/src/bus/index.ts`

问题点：

- 关键事件统一写入 `.../opencode/events/events.jsonl`
- replay 逻辑没有天然的目录/工作区分区语义

影响：

- 多项目并发时难以保证事件回放和近期事件查询的边界正确性

### 4.3 事件契约已经开始漂移

证据：

- `packages/openagt/src/bus/index.ts`
- `packages/openagt/src/mcp/events.ts`

问题点：

- Bus 持久化白名单里使用 `tools.changed`
- MCP 实际事件定义为 `mcp.tools.changed`

影响：

- 子系统之间对“关键事件”的认知不一致
- 后续追踪、回放、监控与兼容性都会受影响

### 4.4 安全检测存在双轨制，强检测未接入执行闭环

证据：

- `packages/openagt/src/security/dangerous-command-detector.ts`
- `packages/openagt/src/tool/bash-execution-plan.ts`
- `packages/openagt/src/tool/bash.ts`

问题点：

- 仓库已有统一的 posix/cmd/powershell 危险命令检测器
- 但 Bash 真实执行规划链路主要消费 `ShellSecurity`
- `dangerous-command-detector` 没有进入真实执行主路径

影响：

- 理论安全能力和实际执行安全能力存在差距
- Windows `cmd` / PowerShell 风险判断可能无法完整体现在最终执行判定中

### 4.5 Provider fallback 语义未完全落地

证据：

- `packages/openagt/src/provider/fallback-service.ts`

问题点：

- 定义了 `computeBackoff()`
- 仓库内未发现实际调用
- 当前实现更偏向 fallback model hop 和 circuit breaker
- 完整 backoff / jitter 策略尚未真正执行

影响：

- 配置表达能力强于实际运行语义
- 线上故障时行为可预测性偏弱

### 4.6 Sandbox 仍偏 advisory，资源限制执行不完整

证据：

- `packages/openagt/src/sandbox/policy.ts`
- `packages/openagt/src/sandbox/process-sandbox.ts`

问题点：

- `writable_paths` 当前仍是兼容性超集
- `maxOutputBytes` / `totalOutputBytes` 已定义，但未形成完整执行约束
- 进程统计与活动进程跟踪仍有全局状态特征

影响：

- 当前 sandbox 元数据比真实隔离能力更强
- 极端输出、异常子进程、跨实例资源统计存在误差空间

### 4.7 调度扩展性存在明显瓶颈

证据：

- `packages/openagt/src/session/task-runtime.ts`

问题点：

- `canRun()` 每次判断都会先 `list()` 全量任务
- `wait()` 在事件驱动下也反复读取任务列表

影响：

- coordinator 计划规模增大后容易退化
- 任务图执行的复杂度与存储读取量会快速上升

### 4.8 核心包职责过大，边界过宽

证据：

- `packages/openagt/src/effect/app-runtime.ts`
- `packages/openagt/package.json`

问题点：

- `AppLayer` 汇总了过多服务
- `package.json` 使用 `"./*": "./src/*.ts"` 宽导出策略

影响：

- 内部目录结构几乎等同对外 API
- 重构成本高，外部依赖内部模块的风险高

## 五、质量链路与工程系统分析

### 5.1 当前质量链路优点

- PR 检查中包含 audit policy 与 source integrity
- 多个核心包有单独 typecheck
- `packages/openagt` 有独立测试脚本
- `release-verify.ts` 串起 SDK、schema、audit、lint、typecheck、重点测试

### 5.2 当前质量链路短板

证据：

- `.github/workflows/typecheck.yml`
- `packages/openagt/script/build.ts`
- `packages/openagt/script/generate.ts`
- `README.md`

主要问题：

- PR CI 主要是 Ubuntu 路径，缺少 Windows / macOS 常态化 smoke gate
- PR 测试是 focused tests，并排除了 `test/cli/tui`
- 默认 build 会先跑 `generate.ts`
- `generate.ts` 默认依赖 `https://models.dev/api.json`
- README 中 release 信息已与当前版本不一致

影响：

- 平台回归可能到发布阶段才暴露
- 构建可重复性不足
- 文档信号和代码真实状态不完全一致

## 六、下一版本改进指南

下一版本建议主题：

**边界收敛 + 可靠性加固**

### 6.1 P0：先修状态隔离与运行时正确性

建议优先项：

- 将 `session/system.ts` 中的环境缓存按实例或工作区分区
- 将 `memory-service.ts` 的全局 `Map` 状态改造成实例级状态
- 为 bus 持久化记录加入目录/工作区上下文
- 校正关键事件名称与事件白名单

目标：

- 先把多实例、多工作区、多会话的正确性做实

### 6.2 P0：统一安全判定主链路

建议优先项：

- 将 `dangerous-command-detector`、PowerShell AST、`ShellSecurity`、`ExecPolicy` 合成为一个 canonical verdict pipeline
- 明确 Bash、cmd、PowerShell 最终都走同一执行前判定链
- 补统一回归测试矩阵

目标：

- 让“设计上的安全能力”变成“执行时的真实安全能力”

### 6.3 P0：补全 fallback 与 sandbox 的真实执行语义

建议优先项：

- 在 provider fallback 中真正应用 backoff / jitter 策略
- 统一记录 primary 和 fallback attempt
- 补 circuit breaker 可观测性
- 在 process sandbox 中真正执行总输出限制与资源限制
- 将 degraded sandbox 模式显式暴露给上层

目标：

- 配置、日志、运行行为三者一致

### 6.4 P1：优化 coordinator / task runtime 的调度复杂度

建议优先项：

- 将 `canRun()` 改为基于单轮快照批量判断
- 减少单轮 dispatch 中的重复存储读取
- 让 `wait()` 在事件驱动下尽量复用内存态快照

目标：

- 支撑更大规模的 DAG 任务图

### 6.5 P1：拆解超大核心包的逻辑边界

建议优先项：

- 至少先逻辑拆分 `runtime-core`、`runtime-cli`、`runtime-server`、`runtime-integrations`
- 即使暂不拆包，也应先拆 `AppLayer` 与 orchestration hotspot 文件
- 优先处理：
  - `src/session/prompt.ts`
  - `src/server/routes/instance/session.ts`
  - `src/cli/cmd/run.ts`

目标：

- 降低变更爆炸半径

### 6.6 P1：收紧公开 API 边界

建议优先项：

- 取消 `"./*": "./src/*.ts"` 的宽导出
- 改为 curated subpath exports
- 将真正稳定的对外能力单独暴露

目标：

- 为后续重构留出空间

### 6.7 P2：提升工程确定性

建议优先项：

- 将 migration drift、config schema drift、OpenAPI/SDK drift 检查前移到 PR gate
- 增加 Windows / macOS smoke lane
- 将默认 build 与 release build 分离
- 将 models snapshot 刷新改为显式命令，而不是默认构建副作用
- 更新 README 和版本说明

目标：

- 让 PR 结果更接近 release 结果
- 让本地与 CI 构建更可重复

## 七、建议的版本节奏

### 阶段一：可靠性修复版

聚焦：

- 状态隔离
- 事件契约
- fallback/backoff
- sandbox enforcement
- 安全判定闭环

这是最值得优先发布的一版，因为它会直接提升多实例稳定性和实际安全性。

### 阶段二：调度与边界收敛版

聚焦：

- coordinator 调度复杂度优化
- 核心 orchestration 文件拆分
- `AppLayer` 收缩
- 公开 API 收紧

这是为后续持续演进打底的一版。

### 阶段三：工程确定性版

聚焦：

- PR gate 接近 release gate
- 去网络依赖构建
- 文档与版本元数据清理
- 跨平台 smoke 提前

这是为团队协作和发版节奏服务的一版。

## 八、最终结论

OpenAGt 的方向是对的，系统也已经有了平台级运行时雏形。当前阶段的关键，不再是证明“它能做很多事”，而是证明“它在多实例、多任务、多平台、多 provider 情况下依然稳定、可控、可维护”。

因此，下一版本最合理的目标不是功能堆叠，而是：

- 让状态边界更清晰
- 让安全链路真正闭环
- 让调度在规模扩大时仍可承受
- 让构建和发布结果更可预测

如果这些工作完成，OpenAGt 会从“功能很强的 agent runtime”进一步进入“工程上可长期扩展的平台底座”。

## 附：关键证据文件

- `package.json`
- `README.md`
- `docs/technical/architecture.md`
- `packages/openagt/package.json`
- `packages/openagt/src/index.ts`
- `packages/openagt/src/effect/app-runtime.ts`
- `packages/openagt/src/session/system.ts`
- `packages/openagt/src/session/task-runtime.ts`
- `packages/openagt/src/tool/bash.ts`
- `packages/openagt/src/tool/bash-execution-plan.ts`
- `packages/openagt/src/security/dangerous-command-detector.ts`
- `packages/openagt/src/provider/fallback-service.ts`
- `packages/openagt/src/sandbox/policy.ts`
- `packages/openagt/src/sandbox/process-sandbox.ts`
- `packages/openagt/src/bus/index.ts`
- `packages/openagt/src/mcp/events.ts`
- `.github/workflows/typecheck.yml`
- `script/release-verify.ts`
- `packages/openagt/script/build.ts`
- `packages/openagt/script/generate.ts`
