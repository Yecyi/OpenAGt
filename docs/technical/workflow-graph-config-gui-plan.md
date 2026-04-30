# OpenAGt 混合式 Workflow 画布:设计与算法探索

定位:**idea 与设计探索**,不是实施计划。讨论范式选择、模型设计、关键算法与未决问题,不规定阶段、时间、文件位置或代码落点。

---

## 本轮补充 (Revision Notes)

此前文档只描述了视觉氛围 (FigJam-like) 和结构性决策,**没回答用户怎么动手用**。本轮补三块:

1. **§4 Hybrid 系统的设计原则** — graph 与 block 共存的具体规则:什么时候是 graph、什么时候是 block、怎么切换、边界在哪、责任如何划分
2. **§8 白板交互与连接模型** — 把"FigJam 风格"具体化:平移/缩放/选择/连接拖拽/节点创建/键盘流的具体机制,尤其是**连接拖拽**的智能反馈细节
3. 旧 §4-§9 顺延为 §5-§11;两个 cross-reference (§6.2 与 §9.1) 编号相应更新

如果只关心交互细节,可直接跳到 §4 与 §8。

---

## 1. 设计目标与张力

四个互相牵扯的目标:
- **表达力**:能描述足够复杂的 agent workflow (branching、loop、subagent fan-out、permission gate、feedback)
- **可读性**:打开图就能看懂"这个 agent 怎么思考"
- **稳定性**:graph 改动不能让 runtime 行为不可预期
- **扩展性**:添加新 tool / subagent / stage 不需要改 GUI 代码

任意两个互相挤压。表达力↑ ⇒ 可读性↓ (ComfyUI 风格);稳定性↑ ⇒ 表达力↓ (静态 config);扩展性↑ ⇒ schema 设计成本↑。本文档几乎所有决策都在这四条对角线上。

---

## 2. 范式探索

### 2.1 五种候选范式

| 范式 | 代表 | 表达力 | 可读性 | 心智成本 |
| --- | --- | --- | --- | --- |
| 纯 block (vertical snap) | Scratch, Blockly | 弱 (branching/parallel 不天然) | 高 | 低 |
| 纯 dataflow (typed pins) | ComfyUI, Houdini | 中 (无控制流) | 中 | 中 |
| 控制流 + dataflow 混合 | UE Blueprints | 高 | 中 | 中-高 |
| 约束式 (declarative) | Datalog, GraphQL schema | 高但抽象 | 低 | 高 |
| 命令式脚本 | Python, JS | 极高 | 低 | 高 |

### 2.2 为什么不是纯 dataflow

ComfyUI 风格的纯 dataflow 在静态 pipeline 上极强,但 OpenAGt 的执行天然有控制流:permission gate 是阻塞决策、subagent fan-out 是 spawn-join、step budget 是状态依赖。强行把控制流编码成"特殊数据 token",图退化成 ComfyUI 那种密集风格——专家能用,新手望而却步。

### 2.3 为什么不是纯 block

block 是垂直 snap 堆叠,branching 必须做成嵌套(`if/else` 包内层 blocks)。OpenAGt 的 stage flow 含 6+ 处真实分支(approval / tool kind / budget / drift / abort),嵌套深度会失控。block 的可读性优势在 OpenAGt 的图状结构里反而是劣势。

### 2.4 为什么是 hybrid + 局部 block

**主画布 = exec pin + data pin** (Blueprints 风格)。**特定节点内嵌 block**:`PromptBlock` / `RuleBlock` / `ConditionBlock`。具体边界与原则见 §4。

### 2.5 为什么 FigJam 而不是 Figma 美学

Figma 是**生产工具**(精确对齐、grid、像 CAD);FigJam 是**思考工具**(略松散、手绘风、低成本入场)。agent workflow 编辑更靠近"思考"而非"精确生产"。但**底层模型必须严格**:typed pins、不允许非法连接、validator 实时跑——这一点向 Figma 学。

> **视觉松散,语义严格**。这是整个 UI/UX 的总纲。

---

## 3. 图模型设计

### 3.1 双 pin 类型系统

两类 pin,**互不连接**:

**Exec pin** (■ 单色):只携带"接下来执行什么"的语义,无 payload。一个节点 1 个 in、≥1 个 out (`next` / `error` / 条件分支)。

**Data pin** (● 彩色按 type):类型化数据流,有 payload。可多对一(扇入)、一对多(扇出),只要类型相容。

### 3.2 类型系统的取舍

太简单(只有原始类型)失去校验价值,太丰富(structural)UX 灾难。折中:**nominal + 可选 + 数组 + literal union**。
```
Type ::= Name | Name? | Name[] | "low" | "medium" | "high"
```
不支持泛型、structural subtyping、function types。**够用**——节点边界类型几乎都是 nominal。

**算法 — 连接合法性 `canConnect(out, in)`**:
1. 类型完全相等 → 合法
2. `out: T` 接 `in: T?` → 合法
3. `out: T` 接 `in: T[]` → 合法 (单值合并入数组)
4. literal union 包含关系 → 合法
5. 否则非法,UI 在拖动时即拒绝

### 3.3 节点 schema 模型

节点类型由 schema 描述,**不由代码**:
```
NodeSchema {
  type: "BashTool", category: "Tool", shape: "diamond"
  pins: { exec_in, exec_out: {next, blocked}, data_in, data_out }
  params: { /* JSON Schema for in-node form */ }
  summary_template: "Run bash: {{command|truncate(40)}}"
  side_effects: ["filesystem", "network"]
}
```

**算法 — 节点 UI 自动生成**:pins → 端口位置/颜色;params → 节点正面表单;summary_template → 节点正面 plain-English 摘要;side_effects → capability badges。**零 UI 代码新增节点。这是扩展性的核心机制。**

### 3.4 子图 (Recipe) 的 pin 提取

子图 = 把若干节点封装成一个新节点类型,自动生成边缘 pins。

**算法**:1) 找跨边界的边;2) 边的"外端"成 pin;3) pin 类型继承自原边;4) pin 名 = 子图内节点+pin 名,可重命名。

子图等价于函数定义,可参数化、有版本号。**社区扩展不需要 plugin runtime,只需要 graph artifact 互通。**

---

## 4. Hybrid 系统的设计原则

定义 graph 与 block 如何共存。**核心:Graph 是宿主,Block 是限定的嵌入,两者不平等。**

### 4.1 三条边界规则

1. **Block 永远嵌入在节点的 param slot,不能独立存在**——没有"裸 block",必属于某个节点的某个字段
2. **Block 对 graph 是不透明的产值器**:block 内部逻辑不暴露为 pin、不参与 graph 拓扑;只产出一个 typed value 给 param
3. **Graph 不嵌套 graph 的 mini view, Block 不嵌套 block**——避免递归地狱;子图 (Recipe) 是逻辑封装而非视觉嵌套

这三条约束保证混合系统不失控。否则会演化成"graph 套 graph 套 block 套 graph",用户立刻迷路。

### 4.2 Block 容器的三种合法语义

只在以下三类 param 上提供 block 编辑:

| Block 类型 | 输出类型 | 适用 param |
| --- | --- | --- |
| `PromptBlock` | `Prompt` (有序段+变量) | system prompt、agent prompt、template |
| `RuleBlock` | `Predicate` (布尔表达式) | permission rule、condition |
| `ConditionBlock` | `Branch` (多路 boolean → exec) | Decision 节点的判定逻辑 |

**不在以下场景提供 block**:数值/字符串简单输入、多选/枚举、文件路径、任何"集中编辑某字段"的需求(这些用 form)。

判定原则:**block 表达 *结构*, form 表达 *值***。如果 param 本质是结构化逻辑/条件/拼接,block 胜;否则 form 胜。

### 4.3 进入/退出 block 的视觉语言

**block 与 graph 不在同一画布上同时显示**——避免视觉密度爆炸。具体过渡:

- 节点正面有 block param 时,展示**预览缩略**(2-3 行 plain-English 摘要) + `[Edit blocks]` 按钮
- 点击 → graph 画布**整体淡化模糊**,被点节点 zoom-in 放大到屏幕中央,展开成 block 编辑区
- block 编辑区独立 chrome:左侧 block palette、顶部 block 类型 badge、左上 `[← Back to graph]`
- 退出:Esc 或点 Back,反向 zoom-out 回到 graph

视觉 metaphor:**"潜入"节点内部**。这个 metaphor 自然解释了"block 是 *节点内部* 的事,不是 *graph 上* 的事"。

### 4.4 类型与校验责任划分

| 校验对象 | 责任方 | 时机 |
| --- | --- | --- |
| Pin 之间的连接 | Graph validator | 拖动连线 |
| Param 的简单值 | JSON Schema validator | param 改动 |
| Block 内部的 DSL | Block validator (per type) | block 改动 |
| Block 输出 vs param 期望类型 | Graph validator | block 保存 |
| Drift | Runtime drift detector | 运行时回填 |

**关键:block 内错不污染 graph 校验器。** block 自检通过后产出 typed value,graph 只关心这个 value 的类型对不对。这种**关注点分离**让两个系统都简单。

错误反馈方式:**block 编辑区显示详细错误;退出后节点角标显示红色提示,告诉用户"该节点的某个 block 有错"**。不把 block 内错误暴露在 graph 主画布上(避免主画布噪音)。

### 4.5 一致性约束

- **Block 不嵌套 block**:用户在 block 内不能再起 block 容器
- **Block 内不能 reference 其他节点的输出**:block 是 self-contained value producer,不接 pin
- **Block 输出值在 graph 中只读**:一旦保存,不可被 graph 中途篡改
- **同一节点的多个 block param 相互独立**:不共享变量、不互相 reference

总效果:**block 是 graph 节点的"局部实现细节",对 graph 全局是黑盒**。两者是模块化关系,不是同级共存。

---

## 5. 多配置模型与解析算法

### 5.1 Artifact 与 Binding 分离

**WorkflowConfig** = 图 artifact,有稳定 id 和 target (`primary` / `subagent:type` / `tool-policy` / `free`)。
**Binding** = `(scope, target, config_id)` 三元组,放在 6 层 cascade 上。

解耦的好处:同一 artifact 可多处绑定;切换 = 改 binding 不动 artifact;artifact 的 fork / 版本 / 分享 与 "在哪用" 完全正交。

### 5.2 Effective Config 解析算法

复用 [`advanced-developer-settings-scope.md`](./advanced-developer-settings-scope.md) 的 `Tool > Subagent > Run > Session > Workspace > Global` 优先级。

```
def resolve(target, run_context):
    cascade = collect_bindings(target, run_context)   # 6 层
    cascade = filter(b => b.target matches target)
    if cascade is empty: return DEFAULT_CONFIG[target]
    base = cascade[lowest_priority]
    config = artifact[base.config_id]
    for b in cascade[low to high]:
        config = overlay(config, artifact[b.config_id])
    return compile_to_runtime_config(config)
```

`overlay` 倾向**完全替换**:高 scope 的 graph 替换低 scope 整张图。理由:节点级覆盖会造成"图 A 的拓扑配上图 B 的参数"心智混乱。"在 thread 里只改一个参数"由 Run 层的参数 override(走表单视图)满足。

### 5.3 继承链 (parent_id) 的处理

倾向**完整图**(子存完整图,继承只是模板初始化):父变时子不变,符合大多数用户预期;diff 模型在 graph 上语义复杂(节点 id / 连线 add/remove diff 难表达)。

继承因此简化为 **fork 时复制一份**。`parent_id` 仅用于来源追踪,不参与运行时解析。

---

## 6. 后端集成与关键算法

### 6.1 三个核心算法

| 算法 | 输入 | 输出 | 难点 |
| --- | --- | --- | --- |
| Compiler | Graph | runtime config | 表达力 mismatch |
| Validator | Graph | error list | 静态 + 运行时归因 |
| Drift detector | Graph + runtime SSE | per-node 状态/告警 | 节点归因 |

### 6.2 Compiler:graph 表达力 ⊋ static config

**两种策略**:

**A — 双轨编译**(倾向):
```
compile(graph):
    static_subgraph, dynamic_subgraph = partition(graph)
    json_config   = to_json(static_subgraph)
    runtime_desc  = to_runtime(dynamic_subgraph)
    return (json_config, runtime_desc)
```
partition 规则:节点带 "static-only" 标记 (Decision、Branch、Loop) → dynamic;其他 → static。跨 boundary 的连线生成 interop pin。静态部分编译到现有 JSON config;动态部分编译到 graph runtime descriptor,由 graph interpreter 在执行时解释。

**B — 限制 graph 表达力**:禁 cycle、Decision 退化为 select-one。简单,但 graph 的表达力 = 现有 config,**graph 退化成花式表单**。

倾向 A。代价是要维护一个 graph interpreter,但 OpenAGt 现有 stage runner 本身就接近这个 shape——改造为 "graph-driven dispatcher" 是自然演进。

### 6.3 Validator:四级错误模型

| 级别 | 例子 | 行为 |
| --- | --- | --- |
| Error | 类型不匹配、必填缺失、unreachable exec、含 exec 的 cycle | 阻止保存 |
| Warning | data pin 未连(取 default)、孤立子图 | 红黄角标,允许保存 |
| Info | 节点参数处于非常用值 | 蓝色提示 |
| Drift | runtime 实际行为与 graph 预期不符 | 节点上飘红圈(运行后回填) |

**静态部分的算法集合**:
1. **类型校验**:遍历每条边跑 `canConnect(out, in)`
2. **必填检查**:必填 pin 必须接入或 param 填了 default
3. **可达性**:Source 节点 BFS,标记可达 exec 节点;不可达 → Warning
4. **Cycle 检测**:exec 子图 DFS,含 cycle → Error
5. **Schema 一致性**:每节点 params 用 JSON Schema validator 跑

**校验时机**:拖动连线时(类型校验)、params 改动时(schema 校验)、保存前(全量)。

### 6.4 Drift 检测算法

Drift = "graph 期望路径" vs "runtime 实际路径" 的差异。

**前置条件**:runtime 事件携带 `source_node_id`(在 effective config metadata 中嵌入 `__node_id` 注释,模块发出事件时透传)。

```
expected_paths = simulate(graph, run_input)   # symbolic 推演,得合法路径 DAG
actual_path = []
on event(e):
    actual_path.append(e.source_node_id)
    if e.source_node_id not in graph: emit drift(orphan)
    if not matches_prefix(actual_path, expected_paths): emit drift(divergence)
```

`simulate` **不真跑 LLM**,只在 graph 上 symbolic 推演:沿 exec 边走,Decision 节点取所有分支。

drift 不一定是 bug——可能是 graph 没考虑到的合理行为。UI 让用户标 "accept as new path",自动扩展 graph。drift 从"错误"变成"学习信号"。

### 6.5 自动布局算法

倾向 **Sugiyama 主、force 微调**:
1. exec 边构建 DAG → Sugiyama 分层得主框架
2. data 边作为 soft constraint 用 force 微调横向位置
3. 子图当 super-node 先布局,展开时局部重排
4. 用户**钉住**的节点在 auto-layout 时跳过

### 6.6 Capability Negotiation (框架稳定运行)

graph 编辑时不知道 runtime 支持什么(旧版本?缺 MCP server?)。
**协议**:runtime 暴露 `capabilities` 接口,返回支持的 node types + version + tags。编辑器加载 graph 时与 capabilities 比对;不支持的节点标灰 + tooltip;Palette 只显示当前 runtime 支持的节点。

**这是框架稳定的核心机制**:graph 永远不会"承诺 runtime 不能兑现的事"。

### 6.7 节点版本与迁移

```
NodeSchema { type, version: 3, migrations: [{from:1,to:2,migrate}, {from:2,to:3,migrate}] }
```
加载旧 graph 时,对每个低版本节点跑 migration chain。失败则节点显示 "incompatible, manual fix required"——graph 仍可打开,只是该节点不能 compile。**永远不丢用户的图,只标记不可用部分**。

---

## 7. 前端 UI/UX 设计 (原则层)

### 7.1 Customization Gradient

| 层级 | 用户做什么 | 机制 | 默认可见? |
| --- | --- | --- | --- |
| L0 — 选 | 顶栏切换 active workflow | binding 切换 | ✅ |
| L1 — 调 | 改节点参数 | 节点正面 inline form | 进画布后默认 |
| L2 — 接 | 改连线、加/删节点 | typed pin connect | 需点 "Edit" |
| L3 — 块 | 编辑 prompt blocks / rule expressions | Block 容器节点 | 节点右键 |
| L4 — 扩 | 注册新 NodeSchema | 配置文件 / 开发者面板 | 仅开发者菜单 |

**每一层往上提门槛,但门始终可达**。绝大多数用户停在 L0/L1。

### 7.2 视觉直觉七条

1. **颜色 = type, 形状 = role**
2. **节点正面只显示 top-3 字段** + summary_template 一行 plain-English
3. **错误就在节点身上**(红角标 + hover detail),不在右下 console
4. **Scope 徽章**:节点角上小徽章显示当前值来自哪一层 scope
5. **"为什么这条线?"**:点连线显示自然语言解释
6. **Runtime overlay**:执行中亮、已完成绿、出错红、跳过灰
7. **拖动时即时校验**:非法连接拖到一半就被拒

### 7.3 FigJam 借鉴 / 反学习

借鉴:无限画布、惯性平移、平滑缩放、sticky note(不参与编译)、section/frame、略带 bezier 的连线、emoji palette。
反学习:ComfyUI 密集 micro-pin、n8n 的 modal-edit 切断画布、Blueprints 的"每个变量是一个节点"的视觉噪音、任何"改一个值弹一个 modal"。

### 7.4 自定义 vs 难度的判断框架

| 维度 | 自定义价值 | 难度成本 | 决定 |
| --- | --- | --- | --- |
| 节点参数表单 | 极高 | 低 (schema → form) | 完全开放 |
| 添加内置节点 | 高 | 低 | 完全开放 |
| 改连线拓扑 | 高 | 中 | 开放 + 强校验 + 拖动时即拒 |
| 子图组合与分享 | 高 | 低 | 完全开放 |
| 注册新 NodeSchema | 中 | 高 | 限开发者 + 文档化 |
| Block 内 DSL | 中 | 高 | 限定 DSL,不允许任意代码 |
| 任意 plugin runtime | 低 | 极高 | 不在范围 |

**总原则**:**视觉松散,语义严格**。看起来什么都能拖,但每个连接处的语义校验即时跑,错的根本连不上。

---

## 8. 白板交互与连接模型 (动手层)

把 §7 的"FigJam 风格"具体化:**用户实际怎么动手**。

### 8.1 平移、缩放、聚焦

| 操作 | 鼠标 | 触控板 | 键盘 |
| --- | --- | --- | --- |
| 平移 | 中键拖 / Space+左键拖 | 双指拖 | 方向键(慢) |
| 缩放 | Ctrl+滚轮 | 双指捏 | Ctrl+`+/-` |
| 重置缩放 | — | — | Ctrl+0 |
| 缩放到全图 | — | — | Ctrl+1 |
| 缩放到选区 | — | — | Ctrl+2 |
| Mini-map | 始终右下角,可拖拽视口 | 同 | M 切换 |

**默认体验**:开图时自动 fit-to-view;长时间不操作不漂移;**缩放围绕鼠标位置**,不是中心(关键体验细节,Figma/FigJam 都这样)。

### 8.2 选择模型

| 操作 | 行为 |
| --- | --- |
| 单击节点 | 选中,清空之前选择 |
| Shift+单击 | 加入选择 |
| Cmd+单击 | 反选 |
| 空地拖动 | Marquee 矩形框选 |
| Alt+空地拖动 | Lasso 自由形选 |
| 双击节点 | 进入节点参数编辑 |
| 双击 Block 容器节点 | 进入 block 编辑 (zoom-in) |
| 双击 Subgraph 节点 | 进入子图 (dive in) |
| 双击连线 | 选中连线 + 弹 inspector |
| Ctrl+A | 全选 |
| Esc | 清空选择 / 退出当前模式 |
| Tab / Shift+Tab | 在连通分量内 cycle |

**多选时的批量操作**:右键浮出菜单(对齐、分布、组合为子图、改 scope、删除)。

### 8.3 节点创建与寻找

四种入口对应不同心智:

1. **左侧 Palette 拖拽**(按类别折叠 + 顶部搜索):新手"我从清单里找"
2. **画布右键 → Quick add**:中级"我大致知道在哪加"
3. **Cmd+K 命令面板**:高级"我知道节点名字"
4. **悬空连线落地** (见 §8.4):流式"我顺着接下来想接什么"

palette 搜索支持:别名 (`bash` → BashTool)、按 capability 过滤 (`needs:filesystem`)、按 tag 过滤 (`subagent`)。结果按"近期使用"+"类别"排序。

### 8.4 连接的拖拽机制 (用户体验最敏感)

**起手**:
- 鼠标 hover 进入 pin 半径 12px → pin 高亮 + 出现 "+" 提示
- 按下左键开始拖 → 一根橡皮筋 (rubber band) 跟随鼠标,颜色 = pin type 颜色

**拖动中的智能反馈** (这部分决定整个画布的"手感"):
- 画布上**所有兼容 pin** 在 200ms 后开始柔和呼吸发光(开拖瞬间不闪,避免视觉爆炸)
- **不兼容 pin 不变化**(不主动变灰,降低视觉噪音)
- 鼠标进入兼容 pin 半径 → 该 pin 强高亮 + **磁力吸附**(snap radius 16px)
- 鼠标进入节点 *body* (不是某个具体 pin) → 自动**建议**该节点上最兼容的 pin 高亮预览
- 鼠标进入不兼容节点 → 显示禁止图标 + tooltip 解释 (`"expected Tool[], this node only outputs string"`)

**释放**:
- 释放在兼容 pin 上 → 连接成功,pin 短暂闪烁确认
- 释放在节点 body 上(无具体 pin) → 自动连到上面的"建议 pin"
- 释放在空地 → **弹出过滤后的 palette**,只显示有兼容 pin 的节点类型;选择即创建并自动连线
- 释放在不兼容 pin 上 → 拒绝,**短暂红色闪烁 + 橡皮筋弹回**(snap-back),pin 处显示 1.5 秒 tooltip 解释为何拒绝

**取消**:
- 拖动中 Esc / 右键 → 取消连线

**点击模式**(无障碍 / 键盘流):
- Click pin → 进入"待连接"模式,pin 持续高亮
- Click 第二个 pin → 完成连接;Esc 取消
- 这条路径让键盘用户和触摸屏用户都能用

**断开**:
- 点连线选中 → Delete 删
- 拖连线端点拖离 pin → 释放在空地 = 删
- 拖连线端点到另一兼容 pin → **重接 (reroute)**,不是先删后连

### 8.5 连接路由与样式

- **路由算法**:bezier 平滑曲线为主,起终点处水平/垂直进出(按 pin 朝向);中段不强制正交(避免 CAD 感);用 A* 在简化网格上搜索绕开沿途节点(阈值低,只避大块占位)
- **样式编码**:颜色 = data type;粗细 = 默认细 / 选中加粗 / runtime 高亮加粗;exec 边略粗实线,data 边略细
- **方向**:箭头小三角在中段或终点;hover 整条线时显示完整流向高亮
- **重叠处理**:连线穿越节点时半透明,降低遮挡感
- **多线 bundle**:同源同目的的多条线自动错开成束

### 8.6 注释、Section、子图导航

**Sticky note**:
- N 键在鼠标位置贴一个;颜色 palette 选(默认黄)
- 拖到节点附近 → 自动"挂靠",显示一根细灰线指向节点
- **不参与编译,不 export 到 effective config**
- 双击编辑文本

**Section / Frame** (FigJam 借鉴):
- F 键画矩形 frame
- 可命名 + 着色;Frame 移动时框内节点跟随
- **Frame ≠ 子图**:Frame 是视觉分组,Subgraph 是语义封装

**Subgraph 导航**:
- Multi-select + Cmd+G:折叠为子图节点(自动提取 pin)
- 双击子图节点:zoom-in 进入子图
- 顶部**面包屑**显示当前层 (`Root > research-flow > rerank-stage`)
- Cmd+Shift+G:解散子图回到外层

### 8.7 校验与运行时反馈

**静态校验反馈**(随手实时):
- 拖连线不兼容:直接 snap-back,无错误状态遗留
- 节点 param 错:节点角上**红圆点**,hover 显示详情
- Unreachable / 必填缺失:节点边框**红色虚线**
- Warning 级:**黄色虚线** + 黄圆点
- Info 级:**蓝色小圆点**(不染边框)

**Runtime overlay**(已绑定 active session 时):
- 执行中节点:蓝色发光脉冲(1Hz 呼吸)
- 已完成:边框变浅绿 + 半透明充填(已完成不再脉冲)
- 出错:红色边框 + 上飘 toast
- 跳过(条件分支没走的):灰色半透明
- Drift:节点上**红圈+感叹号**,点击查看 expected vs actual

**回放模式**:绑定到 session 后可"时间轴回放"——顶部 timeline scrub,左右拖拉看任意时刻的图状态。便于事后分析。

### 8.8 键盘流 (高频用户)

| 快捷键 | 行为 |
| --- | --- |
| Cmd+K | 命令面板 |
| Cmd+S | 保存 |
| Cmd+Z / Cmd+Shift+Z | Undo / Redo |
| Cmd+D | 复制选中 |
| Cmd+C / Cmd+V | 复制 / 粘贴(含连线) |
| Cmd+G | 选中节点组合为子图 |
| Cmd+/ | 注释/取消注释选中(暂时禁用执行) |
| F | 在鼠标处加 Frame |
| N | 在鼠标处加 Sticky |
| Delete | 删除选中 |
| Tab / Shift+Tab | 连通分量内 cycle |
| Space (按住) | 临时切换为平移工具 |
| L | Auto-layout 当前选区(无选区则全图) |
| `?` | 显示快捷键 cheatsheet |

**核心理念**:每个常见操作都至少有一个键盘路径,高频用户**永不离开键盘**完成一次工作流编辑。这是 power user 留存的关键。

---

## 9. 双向编辑 (graph ↔ form) 的一致性设计

graph 编辑器与表单视图共享真理源,实时互通。

### 9.1 真理源选择

三种:graph 是真理 / form 是真理 / **共同真理 = effective config**(倾向)。两个视图都不持有真理,都在 mutate 中央 model。
- **好处**:不必决定谁优先
- **代价**:中央 model 必须能容纳双方所有改动 — 这就是 §6.2 倾向"双轨编译策略 A"的根本原因

### 9.2 改动传播算法

```
on user_edit(view, op):
    apply(model, op.translate_to_model())
    notify_other_views(op)
    # 每个 view 从 model 重投影
```
关键:op 描述**意图** (`set BashTool.sandbox = process`) 而非**结果** (`config.tools.bash.sandbox = "process"`)。意图能被两个视图理解,结果只能被产生它的视图理解。

### 9.3 临时不一致是合法的

graph 的瞬态(拖到一半的连线、刚加还没接的节点)不应触发 form 更新。需要 in-progress 概念:编辑事务 → commit / rollback,只有 commit 后才广播。Form 输入字符串中(IME composition、未失焦)同理。

---

## 10. 开放问题 (设计上未决)

1. **Dataflow cycle 是否允许?** 控制流 cycle 显然 reject,data pin 的 fixed-point (output→input 反馈) 在 self-reflection loop 等场景有用。允许会大增 validator 复杂度。
2. **"运行中编辑"** session 跑到一半改 graph,新 step 用新 graph 还是当前 run 锁定旧 graph? 后者简单,前者更"活"。可能两种模式都要支持。
3. **Decision 节点的判定逻辑写在哪?** A:节点内嵌 ConditionBlock;B:节点有 `predicate: BoolPin` 数据输入,由其他节点产生。B 更优雅但需要 boolean type + 一系列布尔节点。
4. **Subagent 节点是 super-node 还是 cross-graph reference?** super-node 内嵌子 graph;reference 指向另一个 WorkflowConfig。reference 更模块化,super-node 更直观。可能需要两者都支持。
5. **graph artifact 的不可变性?** Edit 始终产生新 version (Figma branching) vs mutate 当前 version (普通文件)。前者带 audit/revert 价值,但增加存储复杂度。
6. **Block DSL 的能力边界**:允许 reference 其他节点输出?定义局部变量?定得太弱无用,定得太强变嵌入式编程语言。
7. **Recipe (子图) 的参数化**:参数 type-erased 还是有 schema?后者更好但增加心智成本。
8. **错误归因不到节点的事件怎么办?** 网络抖动、provider 限流等没有 source_node_id。专门设 "unattributed" 浮空通道?还是强制每个事件有归属?
9. **Graph 是否可分支(branch)?** 类似 git branch:同一 artifact 多个并行版本做 A/B 实验后 merge。git 模型还是 Figma 模型?
10. **磁力吸附距离**:§8.4 的 snap radius 16px 是否太激进?太大会"误吸",太小会"找不到"。需要用户测试。

---

## 11. 与既有设计的关系

| 已有文档 | 关系 |
| --- | --- |
| [`user-input-execution-feedback-flowchart.md`](./user-input-execution-feedback-flowchart.md) | 节点分类与 stage 划分继承自此;它定义了 "runtime 长什么样" |
| [`advanced-developer-settings-scope.md`](./advanced-developer-settings-scope.md) | scope 6 层级与 effective config 概念直接复用;它定义了 "配置如何 cascade" |

graph 视图与 stage 表单视图共享同一份 effective config (见 §9.1)。graph 提供拓扑表达力,表单提供密集字段编辑;两者各擅其场,不互相取代。
