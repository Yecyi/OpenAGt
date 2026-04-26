# Claude Code v2.1.88 — Source Code Analysis

> **Disclaimer**: All source code in this repository is the intellectual property of **Anthropic and Claude**. This repository is provided strictly for technical research, study, and educational exchange among enthusiasts. **Commercial use is strictly prohibited.** No individual, organization, or entity may use this content for commercial purposes, profit-making activities, illegal activities, or any other unauthorized scenarios. If any content infringes upon your legal rights, intellectual property, or other interests, please contact us and we will verify and remove it immediately.

> Extracted from npm package `@anthropic-ai/claude-code` version **2.1.88**.
> The published package ships a single bundled `cli.js` (~12MB). The `src/` directory in this repo contains the **unbundled TypeScript source** extracted from the npm tarball.

**Language**: **English** | [中文](README_CN.md)

---

## Table of Contents

- [Repository Scope](#repository-scope) — How this repo is split between the Claude Code research source and Agent Studio
- [Deep Analysis Reports (`docs/`)](#deep-analysis-reports-docs) — Telemetry, codenames, undercover mode, remote control, future roadmap
- [Missing Modules Notice](#missing-modules-notice-108-modules) — 108 feature-gated modules not in the npm package
- [Agent Studio Snapshot](#agent-studio-snapshot) — Runtime architecture, RPC surface, built-in tools, and data model
- [Run Agent Studio Locally](#run-agent-studio-locally) — Practical dev workflow for `agentd` + Flutter desktop UI
- [Architecture Overview](#architecture-overview) — Entry → Query Engine → Tools/Services/State
- [Tool System & Permissions](#tool-system-architecture) — 40+ tools, permission flow, sub-agents
- [The 12 Progressive Harness Mechanisms](#the-12-progressive-harness-mechanisms) — How Claude Code layers production features on the agent loop
- [Build Notes](#build-notes) — Why this source isn't directly compilable

---

## Repository Scope

This repository contains two related but independent codebases:

| Area                        | Path                               | Purpose                                                                                             | Current State                                                    |
| --------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Claude Code research source | root (`src/`, `docs/`, `scripts/`) | Decompiled/unbundled analysis of `@anthropic-ai/claude-code@2.1.88` plus best-effort build helpers  | Primary analysis target in this repo                             |
| Agent Studio prototype      | `agent_studio/`                    | Local-first coding assistant stack (`agentd` + Flutter desktop app) with its own workspace packages | Actively runnable prototype with TypeScript runtime + Flutter UI |

```
Claude_Code_leak/
├── src/                    # Claude Code unbundled TypeScript source
├── docs/                   # Reverse-engineering and analysis reports (EN/ZH)
├── scripts/                # Build/transform helpers for the source snapshot
└── agent_studio/           # Local runtime + desktop app prototype
    ├── apps/agentd         # WebSocket runtime service
    ├── apps/flutter_app    # Desktop UI
    └── packages/*          # protocol/storage/runtime/control/tool/agent layers
```

---

## Deep Analysis Reports (`docs/`)

Source code analysis reports derived from decompiled v2.1.88. Bilingual (EN/ZH).

```
docs/
├── en/                                        # English
│   ├── [01-telemetry-and-privacy.md]          # Telemetry & Privacy — what's collected, why you can't opt out
│   ├── [02-hidden-features-and-codenames.md]  # Codenames (Capybara/Tengu/Numbat), feature flags, internal vs external
│   ├── [03-undercover-mode.md]                # Undercover Mode — hiding AI authorship in open-source repos
│   ├── [04-remote-control-and-killswitches.md]# Remote Control — managed settings, killswitches, model overrides
│   └── [05-future-roadmap.md]                 # Future Roadmap — Numbat, KAIROS, voice mode, unreleased tools
│
└── zh/                                        # 中文
    ├── [01-遥测与隐私分析.md]                    # 遥测与隐私 — 收集了什么，为什么无法退出
    ├── [02-隐藏功能与模型代号.md]                # 隐藏功能 — 模型代号，feature flag，内外用户差异
    ├── [03-卧底模式分析.md]                     # 卧底模式 — 在开源项目中隐藏 AI 身份
    ├── [04-远程控制与紧急开关.md]                # 远程控制 — 托管设置，紧急开关，模型覆盖
    └── [05-未来路线图.md]                       # 未来路线图 — Numbat，KAIROS，语音模式，未上线工具
```

> Click any filename above to jump to the full report.

| #   | Topic                           | Key Findings                                                                                                                                                                                                                                                             |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | **Telemetry & Privacy**         | Two analytics sinks (1P → Anthropic, Datadog). Environment fingerprint, process metrics, repo hash on every event. **No UI-exposed opt-out** for 1st-party logging. `OTEL_LOG_TOOL_DETAILS=1` enables full tool input capture.                                           |
| 02  | **Hidden Features & Codenames** | Animal codenames (Capybara v8, Tengu, Fennec→Opus 4.6, **Numbat** next). Feature flags use random word pairs (`tengu_frond_boric`) to obscure purpose. Internal users get better prompts, verification agents, and effort anchors. Hidden commands: `/btw`, `/stickers`. |
| 03  | **Undercover Mode**             | Anthropic employees auto-enter undercover mode in public repos. Model instructed: _"Do not blow your cover"_ — strip all AI attribution, write commits "as a human developer would." **No force-OFF exists.** Raises transparency questions for open-source communities. |
| 04  | **Remote Control**              | Hourly polling of `/api/claude_code/settings`. Dangerous changes show blocking dialog — **reject = app exits**. 6+ killswitches (bypass permissions, fast mode, voice mode, analytics sink). GrowthBook flags can change any user's behavior without consent.            |
| 05  | **Future Roadmap**              | **Numbat** codename confirmed. Opus 4.7 / Sonnet 4.8 in development. **KAIROS** = fully autonomous agent mode with `<tick>` heartbeats, push notifications, PR subscriptions. Voice mode (push-to-talk) ready but gated. 17 unreleased tools found.                      |

---

## Missing Modules Notice (108 modules)

> **This source is incomplete.** 108 modules referenced by `feature()`-gated branches are **not included** in the npm package.
> They exist only in Anthropic's internal monorepo and were dead-code-eliminated at compile time.
> They **cannot** be recovered from `cli.js`, `sdk-tools.d.ts`, or any published artifact.

### Anthropic Internal Code (~70 modules, never published)

These modules have no source files anywhere in the npm package. They are internal Anthropic infrastructure.

<details>
<summary>Click to expand full list</summary>

| Module                                            | Purpose                                 | Feature Gate                |
| ------------------------------------------------- | --------------------------------------- | --------------------------- |
| `daemon/main.js`                                  | Background daemon supervisor            | `DAEMON`                    |
| `daemon/workerRegistry.js`                        | Daemon worker registry                  | `DAEMON`                    |
| `proactive/index.js`                              | Proactive notification system           | `PROACTIVE`                 |
| `contextCollapse/index.js`                        | Context collapse service (experimental) | `CONTEXT_COLLAPSE`          |
| `contextCollapse/operations.js`                   | Collapse operations                     | `CONTEXT_COLLAPSE`          |
| `contextCollapse/persist.js`                      | Collapse persistence                    | `CONTEXT_COLLAPSE`          |
| `skillSearch/featureCheck.js`                     | Remote skill feature check              | `EXPERIMENTAL_SKILL_SEARCH` |
| `skillSearch/remoteSkillLoader.js`                | Remote skill loader                     | `EXPERIMENTAL_SKILL_SEARCH` |
| `skillSearch/remoteSkillState.js`                 | Remote skill state                      | `EXPERIMENTAL_SKILL_SEARCH` |
| `skillSearch/telemetry.js`                        | Skill search telemetry                  | `EXPERIMENTAL_SKILL_SEARCH` |
| `skillSearch/localSearch.js`                      | Local skill search                      | `EXPERIMENTAL_SKILL_SEARCH` |
| `skillSearch/prefetch.js`                         | Skill prefetch                          | `EXPERIMENTAL_SKILL_SEARCH` |
| `coordinator/workerAgent.js`                      | Multi-agent coordinator worker          | `COORDINATOR_MODE`          |
| `bridge/peerSessions.js`                          | Bridge peer session management          | `BRIDGE_MODE`               |
| `assistant/index.js`                              | Kairos assistant mode                   | `KAIROS`                    |
| `assistant/AssistantSessionChooser.js`            | Assistant session picker                | `KAIROS`                    |
| `compact/reactiveCompact.js`                      | Reactive context compaction             | `CACHED_MICROCOMPACT`       |
| `compact/snipCompact.js`                          | Snip-based compaction                   | `HISTORY_SNIP`              |
| `compact/snipProjection.js`                       | Snip projection                         | `HISTORY_SNIP`              |
| `compact/cachedMCConfig.js`                       | Cached micro-compact config             | `CACHED_MICROCOMPACT`       |
| `sessionTranscript/sessionTranscript.js`          | Session transcript service              | `TRANSCRIPT_CLASSIFIER`     |
| `commands/agents-platform/index.js`               | Internal agents platform                | `ant` (internal)            |
| `commands/assistant/index.js`                     | Assistant command                       | `KAIROS`                    |
| `commands/buddy/index.js`                         | Buddy system notifications              | `BUDDY`                     |
| `commands/fork/index.js`                          | Fork subagent command                   | `FORK_SUBAGENT`             |
| `commands/peers/index.js`                         | Multi-peer commands                     | `BRIDGE_MODE`               |
| `commands/proactive.js`                           | Proactive command                       | `PROACTIVE`                 |
| `commands/remoteControlServer/index.js`           | Remote control server                   | `DAEMON` + `BRIDGE_MODE`    |
| `commands/subscribe-pr.js`                        | GitHub PR subscription                  | `KAIROS_GITHUB_WEBHOOKS`    |
| `commands/torch.js`                               | Internal debug tool                     | `TORCH`                     |
| `commands/workflows/index.js`                     | Workflow commands                       | `WORKFLOW_SCRIPTS`          |
| `jobs/classifier.js`                              | Internal job classifier                 | `TEMPLATES`                 |
| `memdir/memoryShapeTelemetry.js`                  | Memory shape telemetry                  | `MEMORY_SHAPE_TELEMETRY`    |
| `services/sessionTranscript/sessionTranscript.js` | Session transcript                      | `TRANSCRIPT_CLASSIFIER`     |
| `tasks/LocalWorkflowTask/LocalWorkflowTask.js`    | Local workflow task                     | `WORKFLOW_SCRIPTS`          |
| `protectedNamespace.js`                           | Internal namespace guard                | `ant` (internal)            |
| `protectedNamespace.js` (envUtils)                | Protected namespace runtime             | `ant` (internal)            |
| `coreTypes.generated.js`                          | Generated core types                    | `ant` (internal)            |
| `devtools.js`                                     | Internal dev tools                      | `ant` (internal)            |
| `attributionHooks.js`                             | Internal attribution hooks              | `COMMIT_ATTRIBUTION`        |
| `systemThemeWatcher.js`                           | System theme watcher                    | `AUTO_THEME`                |
| `udsClient.js` / `udsMessaging.js`                | UDS messaging client                    | `UDS_INBOX`                 |
| `systemThemeWatcher.js`                           | Theme watcher                           | `AUTO_THEME`                |

</details>

### Feature-Gated Tools (~20 modules, DCE'd from bundle)

These tools have type signatures in `sdk-tools.d.ts` but their implementations were stripped at compile time.

<details>
<summary>Click to expand full list</summary>

| Tool                      | Purpose                       | Feature Gate                |
| ------------------------- | ----------------------------- | --------------------------- |
| `REPLTool`                | Interactive REPL (VM sandbox) | `ant` (internal)            |
| `SnipTool`                | Context snipping              | `HISTORY_SNIP`              |
| `SleepTool`               | Sleep/delay in agent loop     | `PROACTIVE` / `KAIROS`      |
| `MonitorTool`             | MCP monitoring                | `MONITOR_TOOL`              |
| `OverflowTestTool`        | Overflow testing              | `OVERFLOW_TEST_TOOL`        |
| `WorkflowTool`            | Workflow execution            | `WORKFLOW_SCRIPTS`          |
| `WebBrowserTool`          | Browser automation            | `WEB_BROWSER_TOOL`          |
| `TerminalCaptureTool`     | Terminal capture              | `TERMINAL_PANEL`            |
| `TungstenTool`            | Internal perf monitoring      | `ant` (internal)            |
| `VerifyPlanExecutionTool` | Plan verification             | `CLAUDE_CODE_VERIFY_PLAN`   |
| `SendUserFileTool`        | Send files to users           | `KAIROS`                    |
| `SubscribePRTool`         | GitHub PR subscription        | `KAIROS_GITHUB_WEBHOOKS`    |
| `SuggestBackgroundPRTool` | Suggest background PRs        | `KAIROS`                    |
| `PushNotificationTool`    | Push notifications            | `KAIROS`                    |
| `CtxInspectTool`          | Context inspection            | `CONTEXT_COLLAPSE`          |
| `ListPeersTool`           | List active peers             | `UDS_INBOX`                 |
| `DiscoverSkillsTool`      | Skill discovery               | `EXPERIMENTAL_SKILL_SEARCH` |

</details>

### Text/Prompt Assets (~6 files)

These are internal prompt templates and documentation, never published.

<details>
<summary>Click to expand</summary>

| File                                                  | Purpose                                |
| ----------------------------------------------------- | -------------------------------------- |
| `yolo-classifier-prompts/auto_mode_system_prompt.txt` | Auto-mode system prompt for classifier |
| `yolo-classifier-prompts/permissions_anthropic.txt`   | Anthropic-internal permission prompt   |
| `yolo-classifier-prompts/permissions_external.txt`    | External user permission prompt        |
| `verify/SKILL.md`                                     | Verification skill documentation       |
| `verify/examples/cli.md`                              | CLI verification examples              |
| `verify/examples/server.md`                           | Server verification examples           |

</details>

### Why They're Missing

```
  Anthropic Internal Monorepo              Published npm Package
  ──────────────────────────               ─────────────────────
  feature('DAEMON') → true    ──build──→   feature('DAEMON') → false
  ↓                                         ↓
  daemon/main.js  ← INCLUDED    ──bundle─→  daemon/main.js  ← DELETED (DCE)
  tools/REPLTool  ← INCLUDED    ──bundle─→  tools/REPLTool  ← DELETED (DCE)
  proactive/      ← INCLUDED    ──bundle─→  (referenced but absent from src/)
```

Bun's `feature()` is a **compile-time intrinsic**:

- Returns `true` in Anthropic's internal build → code is kept in the bundle
- Returns `false` in the published build → code is dead-code-eliminated
- The 108 modules simply do not exist anywhere in the published artifact

---

## Copyright & Disclaimer

```
Copyright (c) Anthropic. All rights reserved.

All source code in this repository is the intellectual property of Anthropic and Claude.
This repository is provided strictly for technical research and educational purposes.
Commercial use is strictly prohibited.

If you are the copyright owner and believe this repository infringes your rights,
please contact the repository owner for immediate removal.
```

---

## Stats

| Item                                 | Count                                            |
| ------------------------------------ | ------------------------------------------------ |
| Source files (.ts/.tsx)              | ~1,884                                           |
| Lines of code                        | ~512,664                                         |
| Largest single file                  | `query.ts` (~785KB)                              |
| Built-in tools                       | ~40+                                             |
| Slash commands                       | ~80+                                             |
| Dependencies (node_modules)          | ~192 packages                                    |
| Runtime                              | Bun (compiled to Node.js >= 18 bundle)           |
| Agent Studio runtime source (TS/TSX) | 25 files / ~8.4K LOC (excluding build artifacts) |
| Agent Studio desktop source (Dart)   | 7 files / ~3.0K LOC (excluding build artifacts)  |

---

## Agent Studio Snapshot

`agent_studio/` is a local-first agent runtime prototype with a WebSocket backend (`agentd`) and a Flutter desktop frontend.

### Package topology

| Path                      | Responsibility                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/agentd`             | RPC server over WebSocket (`ws://127.0.0.1:4317` by default)                                  |
| `packages/protocol`       | Zod schemas for requests, events, tool contracts, and runtime state                           |
| `packages/storage`        | SQLite persistence (`~/.agent-studio/agent-studio.db`) + transcript/task/tool-result sidecars |
| `packages/control-plane`  | Workspace trust model, rule matching, path safety checks, approval policy                     |
| `packages/model-adapters` | OpenAI-compatible chat adapter (streaming + tool call parsing)                                |
| `packages/tool-runtime`   | Tool registry/orchestrator + built-in read/write/shell tools                                  |
| `packages/agent-system`   | Task manager and agent profile primitives                                                     |
| `packages/core-runtime`   | Main run loop (sessions, status events, tool turns, approvals, cancellation)                  |
| `apps/flutter_app`        | Desktop control plane UI (provider config, sessions, approvals, transcript view)              |

### Implemented RPC methods

`config.get`, `config.updateProvider`, `config.listProfiles`, `config.saveProfile`, `config.selectProfile`, `workspace.open`, `workspace.getTrust`, `workspace.setTrust`, `session.create`, `session.list`, `session.get`, `session.getTranscript`, `chat.send`, `chat.cancel`, `tool.approval`, `task.list`, `task.get`, `task.cancel`.

### Built-in tools (currently wired)

`read_file`, `list_dir`, `glob`, `grep`, `git_status`, `git_diff`, `write_file`, `edit_file`, `run_shell`, `run_powershell`.

Runtime behavior visible in code:

- Read-only tools execute concurrently (`maxConcurrentReadTools`), mutating/execution tools execute serially.
- `run_shell` / `run_powershell` require explicit approval by default.
- Untrusted workspaces block mutating/execution tools.
- Large tool outputs are summarized and written to sidecar files under `~/.agent-studio/tool-results/`.

---

## Run Agent Studio Locally

The most reliable development path is to run `agentd` with `tsx` first, then start Flutter.

```bash
cd agent_studio
npm install
npm run build:packages
npm run dev:agentd
```

Then in a second terminal:

```bash
cd agent_studio/apps/flutter_app
flutter pub get
flutter run -d windows
```

Optional runtime env vars for `agentd`:

- `AGENT_STUDIO_WS_PORT` (default `4317`)
- `AGENT_STUDIO_LOG_LEVEL` (`fatal|error|warn|info|debug|trace`)
- `AGENT_STUDIO_HOME` (default data root `~/.agent-studio`)

Notes:

- Flutter auto-start logic prefers `agent_studio/apps/agentd/dist/index.js`, but the current package exports still point to TypeScript sources. Manual `npm run dev:agentd` is safer during development.
- If port `4317` is already occupied, set `AGENT_STUDIO_WS_PORT` and connect Flutter to the same endpoint.

---

## The Agent Pattern

```
                    THE CORE LOOP
                    =============

    User --> messages[] --> Claude API --> response
                                          |
                                stop_reason == "tool_use"?
                               /                          \
                             yes                           no
                              |                             |
                        execute tools                    return text
                        append tool_result
                        loop back -----------------> messages[]


    That is the minimal agent loop. Claude Code wraps this loop
    with a production-grade harness: permissions, streaming,
    concurrency, compaction, sub-agents, persistence, and MCP.
```

---

## Directory Reference

```
src/
├── main.tsx                 # REPL bootstrap, 4,683 lines
├── QueryEngine.ts           # SDK/headless query lifecycle engine
├── query.ts                 # Main agent loop (785KB, largest file)
├── Tool.ts                  # Tool interface + buildTool factory
├── Task.ts                  # Task types, IDs, state base
├── tools.ts                 # Tool registry, presets, filtering
├── commands.ts              # Slash command definitions
├── context.ts               # User input context
├── cost-tracker.ts          # API cost accumulation
├── setup.ts                 # First-run setup flow
│
├── bridge/                  # Claude Desktop / remote bridge
│   ├── bridgeMain.ts        #   Session lifecycle manager
│   ├── bridgeApi.ts         #   HTTP client
│   ├── bridgeConfig.ts      #   Connection config
│   ├── bridgeMessaging.ts   #   Message relay
│   ├── sessionRunner.ts     #   Process spawning
│   ├── jwtUtils.ts          #   JWT refresh
│   ├── workSecret.ts        #   Auth tokens
│   └── capacityWake.ts      #   Capacity-based wakeup
│
├── cli/                     # CLI infrastructure
│   ├── handlers/            #   Command handlers
│   └── transports/          #   I/O transports (stdio, structured)
│
├── commands/                # ~80 slash commands
│   ├── agents/              #   Agent management
│   ├── compact/             #   Context compaction
│   ├── config/              #   Settings management
│   ├── help/                #   Help display
│   ├── login/               #   Authentication
│   ├── mcp/                 #   MCP server management
│   ├── memory/              #   Memory system
│   ├── plan/                #   Plan mode
│   ├── resume/              #   Session resume
│   ├── review/              #   Code review
│   └── ...                  #   70+ more commands
│
├── components/              # React/Ink terminal UI
│   ├── design-system/       #   Reusable UI primitives
│   ├── messages/            #   Message rendering
│   ├── permissions/         #   Permission dialogs
│   ├── PromptInput/         #   Input field + suggestions
│   ├── LogoV2/              #   Branding + welcome screen
│   ├── Settings/            #   Settings panels
│   ├── Spinner.tsx          #   Loading indicators
│   └── ...                  #   40+ component groups
│
├── entrypoints/             # Application entry points
│   ├── cli.tsx              #   CLI main (version, help, daemon)
│   ├── sdk/                 #   Agent SDK (types, sessions)
│   └── mcp.ts               #   MCP server entry
│
├── hooks/                   # React hooks
│   ├── useCanUseTool.tsx    #   Permission checking
│   ├── useReplBridge.tsx    #   Bridge connection
│   ├── notifs/              #   Notification hooks
│   └── toolPermission/      #   Tool permission handlers
│
├── services/                # Business logic layer
│   ├── api/                 #   Claude API client
│   │   ├── claude.ts        #     Streaming API calls
│   │   ├── errors.ts        #     Error categorization
│   │   └── withRetry.ts     #     Retry logic
│   ├── analytics/           #   Telemetry + GrowthBook
│   ├── compact/             #   Context compression
│   ├── mcp/                 #   MCP connection management
│   ├── tools/               #   Tool execution engine
│   │   ├── StreamingToolExecutor.ts  # Parallel tool runner
│   │   └── toolOrchestration.ts      # Batch orchestration
│   ├── plugins/             #   Plugin loader
│   └── settingsSync/        #   Cross-device settings
│
├── state/                   # Application state
│   ├── AppStateStore.ts     #   Store definition
│   └── AppState.tsx         #   React provider + hooks
│
├── tasks/                   # Task implementations
│   ├── LocalShellTask/      #   Bash command execution
│   ├── LocalAgentTask/      #   Sub-agent execution
│   ├── RemoteAgentTask/     #   Remote agent via bridge
│   ├── InProcessTeammateTask/ # In-process teammate
│   └── DreamTask/           #   Background thinking
│
├── tools/                   # 40+ tool implementations
│   ├── AgentTool/           #   Sub-agent spawning + fork
│   ├── BashTool/            #   Shell command execution
│   ├── FileReadTool/        #   File reading (PDF, image, etc)
│   ├── FileEditTool/        #   String-replace editing
│   ├── FileWriteTool/       #   Full file creation
│   ├── GlobTool/            #   File pattern search
│   ├── GrepTool/            #   Content search (ripgrep)
│   ├── WebFetchTool/        #   HTTP fetching
│   ├── WebSearchTool/       #   Web search
│   ├── MCPTool/             #   MCP tool wrapper
│   ├── SkillTool/           #   Skill invocation
│   ├── AskUserQuestionTool/ #   User interaction
│   └── ...                  #   30+ more tools
│
├── types/                   # Type definitions
│   ├── message.ts           #   Message discriminated unions
│   ├── permissions.ts       #   Permission types
│   ├── tools.ts             #   Tool progress types
│   └── ids.ts               #   Branded ID types
│
├── utils/                   # Utilities (largest directory)
│   ├── permissions/         #   Permission rule engine
│   ├── messages/            #   Message formatting
│   ├── model/               #   Model selection logic
│   ├── settings/            #   Settings management
│   ├── sandbox/             #   Sandbox runtime adapter
│   ├── hooks/               #   Hook execution
│   ├── memory/              #   Memory system utils
│   ├── git/                 #   Git operations
│   ├── github/              #   GitHub API
│   ├── bash/                #   Bash execution helpers
│   ├── swarm/               #   Multi-agent swarm
│   ├── telemetry/           #   Telemetry reporting
│   └── ...                  #   30+ more util groups
│
└── vendor/                  # Native module source stubs
    ├── audio-capture-src/   #   Audio input
    ├── image-processor-src/ #   Image processing
    ├── modifiers-napi-src/  #   Native modifiers
    └── url-handler-src/     #   URL handling
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ENTRY LAYER                                 │
│  cli.tsx ──> main.tsx ──> REPL.tsx (interactive)                   │
│                     └──> QueryEngine.ts (headless/SDK)              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       QUERY ENGINE                                  │
│  submitMessage(prompt) ──> AsyncGenerator<SDKMessage>               │
│    │                                                                │
│    ├── fetchSystemPromptParts()    ──> assemble system prompt       │
│    ├── processUserInput()          ──> handle /commands             │
│    ├── query()                     ──> main agent loop              │
│    │     ├── StreamingToolExecutor ──> parallel tool execution       │
│    │     ├── autoCompact()         ──> context compression          │
│    │     └── runTools()            ──> tool orchestration           │
│    └── yield SDKMessage            ──> stream to consumer           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
┌──────────────────┐ ┌─────────────────┐ ┌──────────────────┐
│   TOOL SYSTEM    │ │  SERVICE LAYER  │ │   STATE LAYER    │
│                  │ │                 │ │                  │
│ Tool Interface   │ │ api/claude.ts   │ │ AppState Store   │
│  ├─ call()       │ │  API client     │ │  ├─ permissions  │
│  ├─ validate()   │ │ compact/        │ │  ├─ fileHistory  │
│  ├─ checkPerms() │ │  auto-compact   │ │  ├─ agents       │
│  ├─ render()     │ │ mcp/            │ │  └─ fastMode     │
│  └─ prompt()     │ │  MCP protocol   │ │                  │
│                  │ │ analytics/      │ │ React Context    │
│ 40+ Built-in:    │ │  telemetry      │ │  ├─ useAppState  │
│  ├─ BashTool     │ │ tools/          │ │  └─ useSetState  │
│  ├─ FileRead     │ │  executor       │ │                  │
│  ├─ FileEdit     │ │ plugins/        │ └──────────────────┘
│  ├─ Glob/Grep    │ │  loader         │
│  ├─ AgentTool    │ │ settingsSync/   │
│  ├─ WebFetch     │ │  cross-device   │
│  └─ MCPTool      │ │ oauth/          │
│                  │ │  auth flow      │
└──────────────────┘ └─────────────────┘
              │                │
              ▼                ▼
┌──────────────────┐ ┌─────────────────┐
│   TASK SYSTEM    │ │   BRIDGE LAYER  │
│                  │ │                 │
│ Task Types:      │ │ bridgeMain.ts   │
│  ├─ local_bash   │ │  session mgmt   │
│  ├─ local_agent  │ │ bridgeApi.ts    │
│  ├─ remote_agent │ │  HTTP client    │
│  ├─ in_process   │ │ workSecret.ts   │
│  ├─ dream        │ │  auth tokens    │
│  └─ workflow     │ │ sessionRunner   │
│                  │ │  process spawn  │
│ ID: prefix+8chr  │ └─────────────────┘
│  b=bash a=agent  │
│  r=remote t=team │
└──────────────────┘
```

---

## Data Flow: A Single Query Lifecycle

```
 USER INPUT (prompt / slash command)
     │
     ▼
 processUserInput()                ← parse /commands, build UserMessage
     │
     ▼
 fetchSystemPromptParts()          ← tools → prompt sections, CLAUDE.md memory
     │
     ▼
 recordTranscript()                ← persist user message to disk (JSONL)
     │
     ▼
 ┌─→ normalizeMessagesForAPI()     ← strip UI-only fields, compact if needed
 │   │
 │   ▼
 │   Claude API (streaming)        ← POST /v1/messages with tools + system prompt
 │   │
 │   ▼
 │   stream events                 ← message_start → content_block_delta → message_stop
 │   │
 │   ├─ text block ──────────────→ yield to consumer (SDK / REPL)
 │   │
 │   └─ tool_use block?
 │       │
 │       ▼
 │   StreamingToolExecutor         ← partition: concurrent-safe vs serial
 │       │
 │       ▼
 │   canUseTool()                  ← permission check (hooks + rules + UI prompt)
 │       │
 │       ├─ DENY ────────────────→ append tool_result(error), continue loop
 │       │
 │       └─ ALLOW
 │           │
 │           ▼
 │       tool.call()               ← execute the tool (Bash, Read, Edit, etc.)
 │           │
 │           ▼
 │       append tool_result        ← push to messages[], recordTranscript()
 │           │
 └─────────┘                      ← loop back to API call
     │
     ▼ (stop_reason != "tool_use")
 yield result message              ← final text, usage, cost, session_id
```

---

## Tool System Architecture

```
                    TOOL INTERFACE
                    ==============

    buildTool(definition) ──> Tool<Input, Output, Progress>

    Every tool implements:
    ┌────────────────────────────────────────────────────────┐
    │  LIFECYCLE                                             │
    │  ├── validateInput()      → reject bad args early     │
    │  ├── checkPermissions()   → tool-specific authz       │
    │  └── call()               → execute and return result │
    │                                                        │
    │  CAPABILITIES                                          │
    │  ├── isEnabled()          → feature gate check        │
    │  ├── isConcurrencySafe()  → can run in parallel?      │
    │  ├── isReadOnly()         → no side effects?          │
    │  ├── isDestructive()      → irreversible ops?         │
    │  └── interruptBehavior()  → cancel or block on user?  │
    │                                                        │
    │  RENDERING (React/Ink)                                 │
    │  ├── renderToolUseMessage()     → input display        │
    │  ├── renderToolResultMessage()  → output display       │
    │  ├── renderToolUseProgressMessage() → spinner/status   │
    │  └── renderGroupedToolUse()     → parallel tool groups │
    │                                                        │
    │  AI FACING                                             │
    │  ├── prompt()             → tool description for LLM  │
    │  ├── description()        → dynamic description       │
    │  └── mapToolResultToAPI() → format for API response   │
    └────────────────────────────────────────────────────────┘
```

### Complete Tool Inventory

```
    FILE OPERATIONS          SEARCH & DISCOVERY        EXECUTION
    ═════════════════        ══════════════════════     ══════════
    FileReadTool             GlobTool                  BashTool
    FileEditTool             GrepTool                  PowerShellTool
    FileWriteTool            ToolSearchTool
    NotebookEditTool                                   INTERACTION
                                                       ═══════════
    WEB & NETWORK           AGENT / TASK              AskUserQuestionTool
    ════════════════        ══════════════════        BriefTool
    WebFetchTool             AgentTool
    WebSearchTool            SendMessageTool           PLANNING & WORKFLOW
                             TeamCreateTool            ════════════════════
    MCP PROTOCOL             TeamDeleteTool            EnterPlanModeTool
    ══════════════           TaskCreateTool            ExitPlanModeTool
    MCPTool                  TaskGetTool               EnterWorktreeTool
    ListMcpResourcesTool     TaskUpdateTool            ExitWorktreeTool
    ReadMcpResourceTool      TaskListTool              TodoWriteTool
                             TaskStopTool
                             TaskOutputTool            SYSTEM
                                                       ════════
                             SKILLS & EXTENSIONS       ConfigTool
                             ═════════════════════     SkillTool
                             SkillTool                 ScheduleCronTool
                             LSPTool                   SleepTool
                                                       TungstenTool
```

---

## Permission System

```
    TOOL CALL REQUEST
          │
          ▼
    ┌─ validateInput() ──────────────────────────────────┐
    │  reject invalid inputs before any permission check │
    └────────────────────┬───────────────────────────────┘
                         │
                         ▼
    ┌─ PreToolUse Hooks ─────────────────────────────────┐
    │  user-defined shell commands (settings.json hooks) │
    │  can: approve, deny, or modify input               │
    └────────────────────┬───────────────────────────────┘
                         │
                         ▼
    ┌─ Permission Rules ─────────────────────────────────┐
    │  alwaysAllowRules:  match tool name/pattern → auto │
    │  alwaysDenyRules:   match tool name/pattern → deny │
    │  alwaysAskRules:    match tool name/pattern → ask  │
    │  Sources: settings, CLI args, session decisions    │
    └────────────────────┬───────────────────────────────┘
                         │
                    no rule match?
                         │
                         ▼
    ┌─ Interactive Prompt ───────────────────────────────┐
    │  User sees tool name + input                       │
    │  Options: Allow Once / Allow Always / Deny         │
    └────────────────────┬───────────────────────────────┘
                         │
                         ▼
    ┌─ checkPermissions() ───────────────────────────────┐
    │  Tool-specific logic (e.g. path sandboxing)        │
    └────────────────────┬───────────────────────────────┘
                         │
                    APPROVED → tool.call()
```

---

## Sub-Agent & Multi-Agent Architecture

```
                        MAIN AGENT
                        ==========
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
     ┌──────────────┐ ┌──────────┐ ┌──────────────┐
     │  FORK AGENT  │ │ REMOTE   │ │ IN-PROCESS   │
     │              │ │ AGENT    │ │ TEAMMATE     │
     │ Fork process │ │ Bridge   │ │ Same process │
     │ Shared cache │ │ session  │ │ Async context│
     │ Fresh msgs[] │ │ Isolated │ │ Shared state │
     └──────────────┘ └──────────┘ └──────────────┘

    SPAWN MODES:
    ├─ default    → in-process, shared conversation
    ├─ fork       → child process, fresh messages[], shared file cache
    ├─ worktree   → isolated git worktree + fork
    └─ remote     → bridge to Claude Code Remote / container

    COMMUNICATION:
    ├─ SendMessageTool     → agent-to-agent messages
    ├─ TaskCreate/Update   → shared task board
    └─ TeamCreate/Delete   → team lifecycle management

    SWARM MODE (feature-gated):
    ┌─────────────────────────────────────────────┐
    │  Lead Agent                                 │
    │    ├── Teammate A ──> claims Task 1         │
    │    ├── Teammate B ──> claims Task 2         │
    │    └── Teammate C ──> claims Task 3         │
    │                                             │
    │  Shared: task board, message inbox          │
    │  Isolated: messages[], file cache, cwd      │
    └─────────────────────────────────────────────┘
```

---

## Context Management (Compact System)

```
    CONTEXT WINDOW BUDGET
    ═════════════════════

    ┌─────────────────────────────────────────────────────┐
    │  System Prompt (tools, permissions, CLAUDE.md)      │
    │  ══════════════════════════════════════════════      │
    │                                                     │
    │  Conversation History                               │
    │  ┌─────────────────────────────────────────────┐    │
    │  │ [compacted summary of older messages]        │    │
    │  │ ═══════════════════════════════════════════  │    │
    │  │ [compact_boundary marker]                    │    │
    │  │ ─────────────────────────────────────────── │    │
    │  │ [recent messages — full fidelity]            │    │
    │  │ user → assistant → tool_use → tool_result   │    │
    │  └─────────────────────────────────────────────┘    │
    │                                                     │
    │  Current Turn (user + assistant response)            │
    └─────────────────────────────────────────────────────┘

    THREE COMPRESSION STRATEGIES:
    ├─ autoCompact     → triggers when token count exceeds threshold
    │                     summarizes old messages via a compact API call
    ├─ snipCompact     → removes zombie messages and stale markers
    │                     (HISTORY_SNIP feature flag)
    └─ contextCollapse → restructures context for efficiency
                         (CONTEXT_COLLAPSE feature flag)

    COMPACTION FLOW:
    messages[] ──> getMessagesAfterCompactBoundary()
                        │
                        ▼
                  older messages ──> Claude API (summarize) ──> compact summary
                        │
                        ▼
                  [summary] + [compact_boundary] + [recent messages]
```

---

## MCP (Model Context Protocol) Integration

```
    ┌─────────────────────────────────────────────────────────┐
    │                  MCP ARCHITECTURE                        │
    │                                                         │
    │  MCPConnectionManager.tsx                               │
    │    ├── Server Discovery (config from settings.json)     │
    │    │     ├── stdio  → spawn child process               │
    │    │     ├── sse    → HTTP EventSource                  │
    │    │     ├── http   → Streamable HTTP                   │
    │    │     ├── ws     → WebSocket                         │
    │    │     └── sdk    → in-process transport              │
    │    │                                                    │
    │    ├── Client Lifecycle                                  │
    │    │     ├── connect → initialize → list tools          │
    │    │     ├── tool calls via MCPTool wrapper              │
    │    │     └── disconnect / reconnect with backoff        │
    │    │                                                    │
    │    ├── Authentication                                   │
    │    │     ├── OAuth 2.0 flow (McpOAuthConfig)            │
    │    │     ├── Cross-App Access (XAA / SEP-990)           │
    │    │     └── API key via headers                        │
    │    │                                                    │
    │    └── Tool Registration                                │
    │          ├── mcp__<server>__<tool> naming convention     │
    │          ├── Dynamic schema from MCP server              │
    │          ├── Permission passthrough to Claude Code       │
    │          └── Resource listing (ListMcpResourcesTool)     │
    │                                                         │
    └─────────────────────────────────────────────────────────┘
```

---

## Bridge Layer (Claude Desktop / Remote)

```
    Claude Desktop / Web / Cowork          Claude Code CLI
    ══════════════════════════            ═════════════════

    ┌───────────────────┐                 ┌──────────────────┐
    │  Bridge Client    │  ←─ HTTP ──→   │  bridgeMain.ts   │
    │  (Desktop App)    │                 │                  │
    └───────────────────┘                 │  Session Manager │
                                          │  ├── spawn CLI   │
    PROTOCOL:                             │  ├── poll status  │
    ├─ JWT authentication                 │  ├── relay msgs   │
    ├─ Work secret exchange               │  └── capacityWake │
    ├─ Session lifecycle                  │                  │
    │  ├── create                         │  Backoff:        │
    │  ├── run                            │  ├─ conn: 2s→2m  │
    │  └─ stop                            │  └─ gen: 500ms→30s│
    └─ Token refresh scheduler            └──────────────────┘
```

---

## Session Persistence

```
    SESSION STORAGE
    ══════════════

    ~/.claude/projects/<hash>/sessions/
    └── <session-id>.jsonl           ← append-only log
        ├── {"type":"user",...}
        ├── {"type":"assistant",...}
        ├── {"type":"progress",...}
        └── {"type":"system","subtype":"compact_boundary",...}

    RESUME FLOW:
    getLastSessionLog() ──> parse JSONL ──> rebuild messages[]
         │
         ├── --continue     → last session in cwd
         ├── --resume <id>  → specific session
         └── --fork-session → new ID, copy history

    PERSISTENCE STRATEGY:
    ├─ User messages  → await write (blocking, for crash recovery)
    ├─ Assistant msgs → fire-and-forget (order-preserving queue)
    ├─ Progress       → inline write (dedup on next query)
    └─ Flush          → on result yield / cowork eager flush
```

---

## Feature Flag System

```
    DEAD CODE ELIMINATION (Bun compile-time)
    ══════════════════════════════════════════

    feature('FLAG_NAME')  ──→  true  → included in bundle
                           ──→  false → stripped from bundle

    FLAGS (observed in source):
    ├─ COORDINATOR_MODE      → multi-agent coordinator
    ├─ HISTORY_SNIP          → aggressive history trimming
    ├─ CONTEXT_COLLAPSE      → context restructuring
    ├─ DAEMON                → background daemon workers
    ├─ AGENT_TRIGGERS        → cron/remote triggers
    ├─ AGENT_TRIGGERS_REMOTE → remote trigger support
    ├─ MONITOR_TOOL          → MCP monitoring tool
    ├─ WEB_BROWSER_TOOL      → browser automation
    ├─ VOICE_MODE            → voice input/output
    ├─ TEMPLATES             → job classifier
    ├─ EXPERIMENTAL_SKILL_SEARCH → skill discovery
    ├─ KAIROS                → push notifications, file sends
    ├─ PROACTIVE             → sleep tool, proactive behavior
    ├─ OVERFLOW_TEST_TOOL    → testing tool
    ├─ TERMINAL_PANEL        → terminal capture
    ├─ WORKFLOW_SCRIPTS      → workflow tool
    ├─ CHICAGO_MCP           → computer use MCP
    ├─ DUMP_SYSTEM_PROMPT    → prompt extraction (ant-only)
    ├─ UDS_INBOX             → peer discovery
    ├─ ABLATION_BASELINE     → experiment ablation
    └─ UPGRADE_NOTICE        → upgrade notifications

    RUNTIME GATES:
    ├─ process.env.USER_TYPE === 'ant'  → Anthropic-internal features
    └─ GrowthBook feature flags         → A/B experiments at runtime
```

---

## State Management

```
    ┌──────────────────────────────────────────────────────────┐
    │                  AppState Store                           │
    │                                                          │
    │  AppState {                                              │
    │    toolPermissionContext: {                              │
    │      mode: PermissionMode,           ← default/plan/etc │
    │      additionalWorkingDirectories,                        │
    │      alwaysAllowRules,               ← auto-approve      │
    │      alwaysDenyRules,                ← auto-reject       │
    │      alwaysAskRules,                 ← always prompt     │
    │      isBypassPermissionsModeAvailable                    │
    │    },                                                    │
    │    fileHistory: FileHistoryState,    ← undo snapshots    │
    │    attribution: AttributionState,    ← commit tracking   │
    │    verbose: boolean,                                     │
    │    mainLoopModel: string,           ← active model       │
    │    fastMode: FastModeState,                              │
    │    speculation: SpeculationState                          │
    │  }                                                       │
    │                                                          │
    │  React Integration:                                      │
    │  ├── AppStateProvider   → creates store via createContext │
    │  ├── useAppState(sel)   → selector-based subscriptions   │
    │  └── useSetAppState()   → immer-style updater function   │
    └──────────────────────────────────────────────────────────┘
```

---

## The 12 Progressive Harness Mechanisms

This source code demonstrates 12 layered mechanisms that a production AI agent harness needs beyond the basic loop. Each builds on the previous:

```
    s01  THE LOOP             "One loop & Bash is all you need"
         query.ts: the while-true loop that calls Claude API,
         checks stop_reason, executes tools, appends results.

    s02  TOOL DISPATCH        "Adding a tool = adding one handler"
         Tool.ts + tools.ts: every tool registers into the dispatch
         map. The loop stays identical. buildTool() factory provides
         safe defaults.

    s03  PLANNING             "An agent without a plan drifts"
         EnterPlanModeTool/ExitPlanModeTool + TodoWriteTool:
         list steps first, then execute. Doubles completion rate.

    s04  SUB-AGENTS           "Break big tasks; clean context per subtask"
         AgentTool + forkSubagent.ts: each child gets fresh messages[],
         keeping the main conversation clean.

    s05  KNOWLEDGE ON DEMAND  "Load knowledge when you need it"
         SkillTool + memdir/: inject via tool_result, not system prompt.
         CLAUDE.md files loaded lazily per directory.

    s06  CONTEXT COMPRESSION  "Context fills up; make room"
         services/compact/: three-layer strategy:
         autoCompact (summarize) + snipCompact (trim) + contextCollapse

    s07  PERSISTENT TASKS     "Big goals → small tasks → disk"
         TaskCreate/Update/Get/List: file-based task graph with
         status tracking, dependencies, and persistence.

    s08  BACKGROUND TASKS     "Slow ops in background; agent keeps thinking"
         DreamTask + LocalShellTask: daemon threads run commands,
         inject notifications on completion.

    s09  AGENT TEAMS          "Too big for one → delegate to teammates"
         TeamCreate/Delete + InProcessTeammateTask: persistent
         teammates with async mailboxes.

    s10  TEAM PROTOCOLS       "Shared communication rules"
         SendMessageTool: one request-response pattern drives
         all negotiation between agents.

    s11  AUTONOMOUS AGENTS    "Teammates scan and claim tasks themselves"
         coordinator/coordinatorMode.ts: idle cycle + auto-claim,
         no need for lead to assign each task.

    s12  WORKTREE ISOLATION   "Each works in its own directory"
         EnterWorktreeTool/ExitWorktreeTool: tasks manage goals,
         worktrees manage directories, bound by ID.
```

---

## Key Design Patterns

| Pattern                      | Where                              | Purpose                                     |
| ---------------------------- | ---------------------------------- | ------------------------------------------- |
| **AsyncGenerator streaming** | `QueryEngine`, `query()`           | Full-chain streaming from API to consumer   |
| **Builder + Factory**        | `buildTool()`                      | Safe defaults for tool definitions          |
| **Branded Types**            | `SystemPrompt`, `asSystemPrompt()` | Prevent string/array confusion              |
| **Feature Flags + DCE**      | `feature()` from `bun:bundle`      | Compile-time dead code elimination          |
| **Discriminated Unions**     | `Message` types                    | Type-safe message handling                  |
| **Observer + State Machine** | `StreamingToolExecutor`            | Tool execution lifecycle tracking           |
| **Snapshot State**           | `FileHistoryState`                 | Undo/redo for file operations               |
| **Ring Buffer**              | Error log                          | Bounded memory for long sessions            |
| **Fire-and-Forget Write**    | `recordTranscript()`               | Non-blocking persistence with ordering      |
| **Lazy Schema**              | `lazySchema()`                     | Defer Zod schema evaluation for performance |
| **Context Isolation**        | `AsyncLocalStorage`                | Per-agent context in shared process         |

---

## Build Notes

This source is **not directly compilable** from this repo alone:

- Missing `tsconfig.json`, build scripts, and Bun bundler config
- `feature()` calls are Bun compile-time intrinsics — resolved during bundling
- `MACRO.VERSION` is injected at build time
- `process.env.USER_TYPE === 'ant'` sections are Anthropic-internal
- The compiled `cli.js` is a self-contained 12MB bundle requiring only Node.js >= 18
- Source maps (`cli.js.map`, 60MB) map back to these source files for debugging

**See [QUICKSTART.md](QUICKSTART.md) for build instructions and workarounds.**

---

## License

All source code in this repository is copyright **Anthropic and Claude**. This repository is for technical research and education only. See the original npm package for full license terms.
"# claude_code_annotated"
"# claude_code_annotated"
"# claude_code_annotated"
