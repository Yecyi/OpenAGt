# OpenAGt

OpenAGt 是一个本地优先的 agentic coding runtime，面向 CLI、TUI、headless server、Web 和 SDK 驱动的开发工作流。

它围绕持久 session 运行模型工具循环：读取文件、编辑代码、执行 shell、调用 MCP/LSP、管理任务、派发 subagent，并把过程保存在会话中，而不是一次性 completion。

## 概览

OpenAGt 当前围绕四个核心方向构建：

- 以 session 为中心的 agent 执行，而不是单次 completion
- 以权限和安全边界控制工具调用，而不是静默执行高风险操作
- 以后端 runtime 为核心组织多步骤编码任务
- 在命名迁移期保留 `opencode` 入口和 `.opencode` 配置兼容

当前稳定范围：

- CLI / TUI
- headless server
- JavaScript SDK

当前稳定版不包含：

- Flutter 客户端发行版

技术文档：

- [技术架构](docs/technical/architecture.md)
- [Windows 签名说明](docs/release/windows-signing.md)

## OpenCode vs OpenAGt

下表基于 OpenCode 官方开源仓库和文档做技术对比，而不是只看命名。

| 主题 | OpenCode | OpenAGt |
| --- | --- | --- |
| 运行时中心 | Client/server coding agent，强调 TUI 体验 | 后端优先的 session runtime，可被 CLI、TUI、server、SDK 复用 |
| Agent loop | 通用编码 agent，内置 agent mode 和 subagent 能力 | 持久 session 工具循环，扩展 task runtime、coordinator graph、personal-agent primitives |
| Provider 策略 | Provider-agnostic，支持 Claude、OpenAI、Google、本地模型等 | 多 provider runtime，支持 provider fallback、server 暴露和生成式 JavaScript SDK |
| LSP 集成 | 官方文档强调开箱即用 LSP | LSP 作为工具运行时的一部分，与 read/edit/bash/MCP/task 进入同一 session loop |
| 安全模型 | Agent mode 和 permission prompt 是 CLI 体验核心 | 结构化 Approval & Safety Envelope：`allow/confirm/block`、`shell_safety`、exec policy、sandbox policy |
| 编排重点 | Terminal-first 编码流，保留 client/server 远程控制潜力 | Coordinator Runtime、任务图调度、Inbox、Wakeup、Profile/Workspace/Session 记忆 |
| 前端形态 | TUI-first，官方项目也提供 desktop beta | 当前稳定版聚焦 CLI/TUI/headless server/SDK，Flutter 延后 |
| 迁移兼容 | 原生 OpenCode 项目 | 保留 `opencode` CLI alias 和 `.opencode` 配置兼容 |

## 发布

当前稳定版本：

- [v1.16.0](https://github.com/Yecyi/OpenAGt/releases/tag/v1.16.0)

当前候选版本：

- [v1.17.0-rc.3](https://github.com/Yecyi/OpenAGt/releases/tag/v1.17.0-rc.3)

发布资产：

- `OpenAGt-Setup-x64.msi`
- `openagt-windows-x64.zip`
- `openagt-linux-x64.tar.gz`
- `openagt-macos-arm64.tar.gz`
- `openagt-macos-x64.tar.gz`
- `SHA256SUMS.txt`
- SBOM

安装说明见 [Stable Install](docs/install/stable.md)。

## 核心技术

OpenAGt 当前后端能力包括：

- 持久 session runtime 与迭代式工具循环
- Shell 与工具调用的权限审批、安全摘要和 `shell_safety.version = 1`
- Coordinator Runtime 的任务图、依赖校验、dispatch、retry、cancel
- Personal Agent Core 的 profile/workspace/session 记忆、inbox、scheduler、wakeup
- `openagt debug doctor` 与 `openagt debug bundle --session <id>`
- Headless server、SSE event envelope、生成式 JavaScript SDK
- 跨平台 release packaging、checksums、SBOM、Windows MSI

## Verification Matrix

| 能力 | 状态 |
| --- | --- |
| Session runtime 与工具循环 | v1.16 稳定；v1.17 RC 加强 task/subagent 结果可见性 |
| Approval and Safety Envelope | v1.16 稳定，带版本化 `shell_safety` |
| Coordinator Runtime | v1.16 稳定；v1.17 RC 加强 sidebar planning visibility |
| Personal Agent Core | 已实现，v1.16 稳定后端契约 |
| Debug doctor / repro bundle | v1.16 稳定诊断面 |
| Release verification automation | `bun run verify:v1.17` |
| Flutter 前端 | 路线图；先稳定后端契约 |

## 启动

Windows MSI 安装包会允许选择安装目录；新版本 MSI 会覆盖升级旧版本，同版本重新运行会进入 Windows 修复 / 维护流程。安装完成后会写入 `GETTING_STARTED.txt`，并在开始菜单创建 OpenAGt Getting Started 快捷方式。

从安装包或 portable zip 启动：

```powershell
openagt
openagt run
openagt serve
openagt debug doctor
```

兼容入口：

```powershell
opencode
```

从源码运行：

```powershell
bun install
bun run --cwd packages/sdk/js script/build.ts
bun run --cwd packages/openagt src/index.ts --help
```

## 发布验证

维护者可以运行：

```powershell
bun run verify:v1.17
bun run release:verify
bun run release:stable
```
