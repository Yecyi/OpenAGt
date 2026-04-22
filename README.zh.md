# OpenAGt

OpenAGt 是一个基于 [OpenCode](https://github.com/anomalyco/opencode) 演化出来的 AI Coding Agent 项目。当前仓库更准确的定位不是“完全独立重写的新系统”，而是一个带有 OpenAGt 品牌、加入了额外运行时实验、安全增强与 Flutter 移动端 MVP 的 OpenCode 衍生分支。

换句话说，这个项目的正确介绍方式应该是：

> OpenAGt 基于 OpenCode，围绕运行时、安全、客户端形态和部分工程能力做了本地扩展。

## 当前仓库的真实状态

这份 README 以当前代码为准，不沿用旧文档里已经失真的描述。

当前仓库里真正重要的模块如下：

| 路径 | 作用 |
| --- | --- |
| `packages/openagt` | 核心 runtime、CLI、Hono 服务端、工具系统、会话系统、MCP/LSP/ACP 集成 |
| `packages/app` | Solid/Vite Web 客户端 |
| `packages/sdk/js` | 生成式 JavaScript SDK |
| `packages/openagt_flutter` | Flutter 移动端 MVP |
| `packages/console/*` | 控制台/控制平面相关服务与应用 |
| `packages/web` | 文档与站点 |
| `packages/opencode` | 遗留兼容包，不是当前主 runtime |

需要特别说明的一点：

- 根目录 `package.json` 里仍然有一些过时脚本引用，例如 `packages/desktop-electron`，但该目录在当前仓库快照中并不存在。因此 README 不应该继续把“桌面端本地可运行/可打包”写成已验证事实。

## 与 OpenCode 的关系

仓库中保留了大量非常明确的 OpenCode 血缘痕迹，这不是猜测，而是代码事实：

- `packages/openagt/bin/opencode` 仍然存在，用作兼容入口。
- 安装脚本会同时创建 `openagt` 和 `opencode` 的链接。
- runtime 同时设置 `OPENAGT_*` 和 `OPENCODE_*` 环境变量。
- 仓库内仍有 `.opencode/` 与 `packages/opencode/`。
- 很多 UI 文案、配置说明和路径命名仍保留 `OpenCode/opencode`。

因此，README 最需要修正的第一件事，就是明确来源，而不是再把项目写成与 OpenCode 无关的独立体系。

## 已验证的技术能力

### 1. 核心运行时

`packages/openagt` 是当前仓库真正的核心。它负责：

- CLI 命令入口
- headless server
- session / message 编排
- tool 注册与执行
- provider / model 管理
- SQLite 持久化与 JSON 到 SQLite 的迁移
- MCP / LSP / ACP / plugin / agent 集成
- shell review、permission 和安全检测相关逻辑

从架构上看，这是一个 Bun 优先、同时保留部分 Node 兼容分支的 runtime。

### 2. 工具并发与调度

仓库里确实实现了工具并发控制，但旧 README 的说法过度夸张。

代码里真实存在的能力包括：

- `packages/openagt/src/tool/partition.ts` 对工具做 safe / unsafe 分类
- safe 工具目前包括 `read`、`glob`、`grep`、`webfetch`、`codesearch`、`websearch`、`lsp`、`question`、`skill`
- `bash`、`edit`、`write`、`task`、`todo`、`plan`、`apply_patch` 等工具会被串行化
- `packages/openagt/src/session/prompt/tool-resolution.ts` 还做了路径提取与路径冲突阻塞，避免有文件重叠的操作同时执行

更准确的文档表述应该是：

- 已实现 safe/unsafe 工具分区
- 已实现基于路径冲突的额外阻塞
- 尚不能把它包装成“通用高性能 DAG 调度器”
- 也不应在 README 中写死 `2x-3x` 延迟收益，除非补上基准测试

### 3. Provider 抽象与降级链

这一块在代码里是实打实存在的，不是概念稿。

已实现内容：

- 多 provider / model 加载
- 配置驱动的 fallback chain
- 针对 rate limit 与 5xx 错误的 fallback 判定
- fallback metrics 统计
- fallback hop 事件发布

因此 README 可以明确写：

- 支持多 provider 抽象
- 支持配置驱动的 fallback
- 支持一定程度的可观测性

但不要只写一句模糊的“自动容灾”，最好点明它是配置和状态驱动的实现。

### 4. Shell 安全分析

这一部分也是当前仓库比较明确的增强点之一。

代码里能确认的能力：

- POSIX 风格命令危险模式检测
- PowerShell 专用危险 cmdlet 检测
- 编码命令、远程执行、AMSI bypass、LOLBin 等特征检测
- `packages/openagt/src/security/powershell-ast.ts` 中的自定义 PowerShell AST/tokenizer 分析
- `packages/openagt/src/security/dangerous-command-detector.ts` 中的统一检测入口

需要注意的边界：

- 这是项目内自定义的轻量 PowerShell 结构分析，不是官方 PowerShell 解释器 AST
- 它比纯正则更强，但不是形式化安全证明

所以更准确的 README 写法是：

- “具备启发式 shell 安全检测，并为 PowerShell 增加了自定义 AST 层”

而不是把它写成无懈可击的“深度语义安全引擎”。

### 5. 上下文压缩与会话系统

旧 README 中关于 compaction 的描述方向没有错，但数字表达不严谨。

代码里能确认：

- 存在 `micro`、`auto`、`full` 等 compaction 路径
- session/message 是核心子系统
- prompt 组装、summary、overflow、memory、retry 等逻辑都存在

但下面这些说法当前缺少可验证 benchmark 支撑：

- 固定 `40%-55%` token 节省
- 固定延迟收益
- 固定成本收益

因此 README 应改成“支持多级上下文压缩策略”，不要继续给出未经验证的精确百分比。

### 6. 客户端形态

当前仓库中的客户端形态包括：

- CLI/TUI：`packages/openagt`
- Web：`packages/app`
- Console 系列页面：`packages/console/app`
- Flutter 移动端：`packages/openagt_flutter`

Flutter 不是空壳。代码中可以看到：

- API 层
- SSE 层
- chat 模块
- session 模块
- theme 模块

所以它可以写成“移动端 MVP”，但不应写成“已经完整成熟的移动端产品”。

## 快速开始

### 环境要求

- Bun 1.3+
- Git
- 如果要跑移动端，再安装 Flutter 3.41+

### 新仓库克隆后的必要步骤

这个仓库在 fresh clone 后，**先要生成 JS SDK**，否则 `packages/openagt` 启动时会因为缺少生成文件而报错。

```bash
bun install
bun run --cwd packages/sdk/js script/build.ts
```

这是当前仓库最容易踩坑的一步，也应当明确写进 README。

### 运行核心 CLI

```bash
bun run --cwd packages/openagt src/index.ts --help
bun run --cwd packages/openagt src/index.ts
```

说明：

- 当前 fork 的主命令名是 `openagt`
- `opencode` 仍保留为兼容入口

### 运行 Headless Server

```bash
bun run --cwd packages/openagt src/index.ts serve
```

### 运行 Web 客户端

```bash
bun run --cwd packages/app dev
```

### 运行文档站点

```bash
bun run --cwd packages/web dev
```

### 运行 Flutter 移动端 MVP

```bash
cd packages/openagt_flutter
flutter pub get
flutter run
```

## 开发建议

### 重新生成 JS SDK

当 API 或 schema 变化后，按仓库约定重新生成 SDK：

```bash
bun run --cwd packages/sdk/js script/build.ts
```

### 类型检查

按照仓库约定，不要直接在根目录跑 `tsc`，也不要从 repo root 跑测试。

推荐这样执行：

```bash
cd packages/openagt
bun typecheck
```

其他常见包也可以分别执行：

```bash
cd packages/app
bun typecheck
```

### 测试

根目录 `test` 脚本会故意失败并提示不要在 root 运行。

正确方式是进入包目录：

```bash
cd packages/openagt
bun test
```

## README 需要纠正的重点

相比旧版 README，最需要修正的是这些点：

1. 把项目来源明确写成基于 OpenCode 的衍生项目。
2. 删除或弱化未经 benchmark 支撑的精确性能数字。
3. 不再把当前仓库里不存在的桌面端包写成现成能力。
4. 把“先生成 SDK 再启动”写进 Quick Start。
5. 清楚说明 `openagt` 与 `opencode` 的兼容关系。
6. 把 Flutter 客户端定位为 MVP。
7. 去掉乱码、路径失真和与代码结构不一致的模块说明。

## 延伸阅读

- [OpenCode 上游仓库](https://github.com/anomalyco/opencode)
- [技术分析报告](./docs/TECHNICAL_ANALYSIS_REPORT.md)
- [核心 runtime 包](./packages/openagt/README.md)
- [Web 应用](./packages/app/README.md)
- [JavaScript SDK](./packages/sdk/js/package.json)
- [Flutter 客户端](./packages/openagt_flutter/pubspec.yaml)

## License

MIT，见 [LICENSE](./LICENSE)。
