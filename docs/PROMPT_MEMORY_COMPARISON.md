# Prompt 与 Memory 系统对比：OpenAG、CC Source Code、Codex

本文基于仓库内可读源码，对三者在**系统提示组装**、**会话/跨会话记忆**、**上下文压缩（compact）**三条主线做对照，并列出可改进点。Hermes Agent 仅作参照（见文末）。

---

## 1. 总览对照

| 维度 | OpenAG（`packages/opencode`） | CC Source Code | Codex（`codex-rs/core`） |
|------|------------------------------|----------------|-------------------------|
| **系统 prompt 来源** | 多份按厂商区分的 `.txt`（`session/system.ts` 选择）+ 动态 `environment`/`skills` 段 + `session/prompt.ts` 内循环逻辑（plan、结构化输出、子任务等） | `constants/prompts.ts` 巨型组装；`systemPromptSections.js` 分段；**显式静态/动态边界** `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 服务 prompt caching | `instructions/`、`client_common::Prompt`、`session`/`turn_context` 等组合；压缩用独立模板文件 |
| **Memory 形态** | 无与 CC `SessionMemory` 同级的「会话笔记文件 + 后台 fork 子代理周期性更新」；侧重 compaction 摘要与会话内状态 | **Session memory**：磁盘 markdown + fork 子代理按 token/工具调用阈值更新；**memdir**：`MEMORY.md` 等入口、截断与注入 `loadMemoryPrompt` | **`memories` 模块**：启动两阶段（phase1 抽取 raw + rollout summary → phase2 全局 consolidation）；模板 `templates/memories/stage_one_system.md`；强调 no-op、红队式卫生规则 |
| **Compact 策略** | **三层**：micro（时间阈值+工具白名单，无 LLM）→ auto（接近窗口的规则裁剪）→ full（LLM 摘要，`compaction/full.ts` 模板含 Goal/Instructions/…） | **微压 + 全量**：`services/compact/prompt.ts` 极长指令（`<analysis>` 草稿 + 九段式 summary）；NO_TOOLS 前置防 Sonnet 误调工具；可选 cached microcompact 等特性开关 | **`compact.rs` + `templates/compact/prompt.md`**：短指令「checkpoint handoff」；支持 **remote compaction**；`InitialContextInjection` 区分 mid-turn / pre-turn 与初始上下文再注入策略 |
| **与 API 缓存关系** | 需在实现层自行考虑（未见与 CC 同级的 boundary 常量） | 边界常量与 `api.ts` / `claude.ts` 构建块注释联动 | 由协议层 `ContextCompactionItem`、turn 历史替换与遥测事件驱动 |

---

## 2. Prompt 结构

### 2.1 OpenAG

- **分层**：`SystemPrompt` 服务注入环境块（工作目录、git、日期等）与 skills 说明；厂商 prompt 文件切换；`session/prompt.ts` 承担主循环、reminder、结构化输出、与 compaction 的衔接。
- **特点**：逻辑集中在 TypeScript，文本模板分散在 `session/prompt/*.txt` 与 `agent/prompt/`；plan mode 等可通过大段 reminder 注入（需注意 token 与模型对「系统提醒」的服从度）。

### 2.2 CC Source Code

- **分段与缓存**：`prompts.ts` 引入 `resolveSystemPromptSections`、`DANGEROUS_uncachedSystemPromptSection`，并用 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 划分可全局缓存段与不可缓存段。
- **工具与特性**：常量文件聚合各 tool 名称与说明 import；GrowthBook / feature 门控大量可选段（proactive、brief、skill search 等）。

### 2.3 Codex

- **压缩 prompt 极简**：`templates/compact/prompt.md` 数行要点，依赖模型在常规对话风格下补全 handoff。
- **Memory 写入 prompt 极详**：`stage_one_system.md` 长文规则（证据链、no-op gate、高信号记忆类型等），与 compaction 短 prompt 形成「写记忆重规范、压上下文轻提示」的对比。

---

## 3. Memory 模型

### 3.1 OpenAG

- **会话连续性**：主要靠 **full compaction 摘要**（及可选的 semantic/importance 等扩展，见 `session/compaction/`）与消息存储；无对标 CC 的「固定章节会话笔记 + 仅 Edit 更新」流水线。
- **缺口（相对 CC/Codex）**：缺少**可审计的会话级 markdown 笔记**与**跨会话 consolidation 管道**的产品化默认路径；若要做企业级「交接班」，需补齐存储格式、更新频率与与 compact 的时序（避免与摘要重复或矛盾）。

### 3.2 CC Source Code

- **Session memory**（`services/SessionMemory/sessionMemory.ts`）：后台 fork 子代理；阈值含初始化 token、更新 token、工具调用间隔；更新 prompt（`prompts.ts`）强制保留章节标题与斜体说明行、仅用 Edit、并行调用等——**强结构、强约束**，利于 compaction 后「Current State」仍可用。
- **memdir**（`memdir/memdir.ts`）：`MEMORY.md` 行数/字节上限、与团队路径等；`loadMemoryPrompt` 拼进系统侧。

### 3.3 Codex

- **`memories/mod.rs`**：启动任务、两阶段模型默认值（phase1 `gpt-5.4-mini` Low reasoning、phase2 `gpt-5.4` Medium）、并发与 lease、prune batch、**memory_summary.md 注入 token 上限**（5k）等常量即产品设计。
- **哲学**：强调**可空的 stage-1 输出**与「未来代理是否因此更好」门控，减少垃圾记忆；与 CC 的「每段尽量写满」是不同取向。

---

## 4. 压缩（Compact）算法与提示词

### 4.1 OpenAG

- **Micro**：按时间与工具类型折叠旧工具输出（无 LLM）。
- **Auto**：接近上下文上限时的规则裁剪（`compaction/auto.ts`）。
- **Full**：LLM 生成续写用摘要；`full.ts` 中默认模板对齐 Claude Code 风格章节（Goal / Instructions / Discoveries / …），并含 **stripImagesFromMessages** 等防止压缩请求本身超长。

### 4.2 CC Source Code

- **`services/compact/prompt.ts`**：`NO_TOOLS_PREAMBLE` 明确禁止工具调用及后果；BASE vs PARTIAL 两套「按全对话 vs 仅近期」分析指令；**九段式** summary + 示例 XML；与 Sonnet 4.6+ 行为问题（误调工具导致无文本）在注释中可追溯。
- **工程化**：分析块在 `formatCompactSummary` 中剥离再入上下文（见文件内注释）。

### 4.3 Codex

- **`compact.rs`**：`SUMMARIZATION_PROMPT` 来自 `templates/compact/prompt.md`（短）；区分 **inline auto compact** 与带 `UserInput` 的 compact；**初始上下文再注入**枚举服务 mid-turn 训练分布。
- **Remote**：`should_use_remote_compact_task` 按 provider 能力走远程压缩路径。

---

## 5. 不完善点与可优化方向

### 5.1 OpenAG

1. **系统 prompt 与缓存**：若无类似 CC 的静态/动态边界，在多轮对话 + 长工具列表场景下，**重复计费与延迟**可能劣于 CC；可评估引入「可缓存前缀 + 会话专有后缀」协议并与 provider 对齐。
2. **Plan / reminder 体量**：`prompt.ts` 若内嵌极长 plan reminder，会挤占用户与工具有效窗口；建议拆为**短 reminder + 外链或结构化 state**（或仅在进入 plan 时注入）。
3. **记忆层**：在 full compact 之外增加可选 **SessionMemory 式笔记**（或与已有 semantic compaction 统一为一种用户可见制品），并定义与 **full summary** 的优先级（避免两处事实冲突）。
4. **压缩提示**：可在 full 模板中吸收 CC 的 **「禁止工具 + 分析块剥离」** 思路，降低压缩轮次被工具调用浪费的概率（尤其 adaptive 模型）。

### 5.2 CC Source Code

1. **compact prompt 过长**：维护成本高，且对非 Claude 模型可能溢出或稀释；可按 provider 提供 **短模板变体**（参考 Codex `prompt.md`）。
2. **Session memory 与 memdir 双轨**：需清晰产品叙事与去重策略，避免用户困惑「两处笔记以谁为准」。
3. **国际化**：大量英文指令硬编码；若 OpenAG 多语言场景要对标，需结构化抽取文案。

### 5.3 Codex

1. **compact 过短**：在极复杂 rollout 上可能丢失 CC 九段式中的细节；可考虑 **动态展开**（token 预算内附加 checklist）。
2. **Memory 启动管道**：异步、lease、两阶段失败重试——运维与调试面复杂；OpenAG 若借鉴需配套可观测性与失败降级（跳过 memory 仅 compact）。

---

## 6. Hermes Agent（参照）

- 典型关注点：`context_compressor`、**prompt caching**、SessionDB FTS、skills 注入策略等——适合作为「**长会话成本**与**检索式记忆**」的对照，本文不展开实现细节。

---

## 7. 建议的 OpenAG 落地顺序（可选）

1. 为 compaction **增加「无工具」强前置**与可选 `<analysis>` 剥离路径（对齐 CC 经验）。  
2. 设计 **静态/动态 system 分段** 与 provider cache 文档化。  
3. 原型 **会话级 markdown 笔记**（结构可简化自 CC 模板）+ 与 full compact 的合并策略。  
4. 中长期评估 **Codex 式跨 rollout consolidation** 是否适合开源/自托管部署形态。

---

*文档生成自仓库源码路径：`packages/opencode`、`Code Reference/CC Source Code`、`Code Reference/codex/codex-rs/core`。*
