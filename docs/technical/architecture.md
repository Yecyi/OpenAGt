# OpenAGt Technical Architecture

## Summary

OpenAGt is a backend-first agentic coding runtime. The core design is session-centric: a request becomes a persistent runtime session, the model emits tool calls inside that session, and tool output feeds back into the same loop until the task reaches a terminal state.

The system is organized around five backend pillars:

- session runtime
- tool and permission system
- coordinator and task graph execution
- personal agent memory and inbox primitives
- server, SSE, and SDK integration

This document focuses on the current stable backend and release-facing architecture.

## OpenCode Comparison

The comparison below uses the public OpenCode repository and README as the source baseline, then compares that baseline with the current OpenAGt codebase.

```mermaid
flowchart LR
  A["OpenCode"] --> A1["TUI-first client/server coding agent"]
  A --> A2["Provider-agnostic model surface"]
  A --> A3["Built-in LSP and agent modes"]
  B["OpenAGt"] --> B1["Session-centric backend runtime"]
  B --> B2["Structured safety envelope"]
  B --> B3["Coordinator + personal-agent backend"]
```

| Topic | OpenCode | OpenAGt |
| --- | --- | --- |
| Architectural emphasis | TUI-first coding agent with explicit client/server architecture | Backend-first runtime where CLI, TUI, server, and SDK are clients of the same session engine |
| Session model | Interactive coding agent loop with built-in agent modes | Persistent session runtime with prompt assembly, compaction, memory, and tool scheduling in one loop |
| Tooling emphasis | Official docs emphasize LSP, agent modes, provider choice, and terminal workflows | Local runtime emphasizes tool mediation across file I/O, shell, MCP, LSP, tasking, and safety metadata |
| Safety / approvals | Permission prompts are part of the user-facing agent flow | Safety is modeled as a first-class backend layer with approval kinds, policy sources, and boundary metadata |
| Multi-step orchestration | Subagent support is part of the coding workflow | Coordinator Runtime v1 turns work into task graphs with dependency checks, write scopes, verify stages, and dispatch |
| Long-running agent state | README emphasis is remote-driving and terminal workflows | Personal Agent Core adds durable profile/workspace/session memory, inbox items, scheduled wakeups, and synthesis |
| Client surfaces | TUI-first, client/server, desktop beta | CLI/TUI, headless server, SSE, generated JS SDK, and deferred Flutter frontend |

## System Overview

```mermaid
flowchart TD
  A["CLI / TUI / Web / SDK"] --> B["Session Runtime"]
  B --> C["Prompt Assembly"]
  C --> D["Model Call"]
  D --> E{"Tool calls?"}
  E -- "yes" --> F["Permission + Safety Envelope"]
  F --> G["Tool Scheduler"]
  G --> H["Read / Edit / Bash / MCP / LSP / Task"]
  H --> B
  E -- "no" --> I["Final Response"]
```

## Core Runtime

### Session Model

The session layer is the main execution boundary.

Responsibilities:

- store message history
- assemble prompt context
- inject memory
- resolve tools
- execute the model loop
- compact context when the conversation grows
- preserve run state across iterative calls

Primary implementation area:

- `packages/openagt/src/session`

Important subareas:

- `prompt.ts`
- `compaction.ts`
- `processor.ts`
- `task-runtime.ts`

### Prompt Assembly

Prompt assembly combines:

- system instructions
- agent instructions
- project and user config
- skills and plugins
- prior session messages
- session memory and summaries

The prompt layer is not a separate planner service. It is a continuation-oriented runtime that repeatedly executes model calls inside one session.

## Tooling and Permissions

### Tool Model

OpenAGt treats coding work as tool-mediated execution.

Built-in capabilities include:

- file read and search
- edit and patch operations
- shell execution
- MCP access
- LSP access
- task delegation
- TODO writing

Primary implementation area:

- `packages/openagt/src/tool`

### Safety Envelope

Tool calls pass through a safety model before execution.

Key concepts:

- permission decision: `allow`, `confirm`, `block`
- shell safety metadata: `shell_safety`
- policy source: permission rules and exec policy
- boundary state: sandbox, filesystem, and network constraints
- approval kind: why the user is being asked

```mermaid
flowchart LR
  A["Tool Call"] --> B["Permission Rules"]
  B --> C["Exec Policy"]
  C --> D["Shell Security"]
  D --> E["Sandbox Policy"]
  E --> F["Final Decision"]
  F --> G["Allow / Confirm / Block"]
```

Security-related implementation areas:

- `packages/openagt/src/permission`
- `packages/openagt/src/security`
- `packages/openagt/src/sandbox`

## Coordinator Runtime v1

Coordinator Runtime extends task delegation into a task graph model.

Task graph metadata includes:

- `depends_on`
- `write_scope`
- `read_scope`
- `acceptance_checks`
- `priority`
- `origin`

Scheduling rules:

- dependency graph must be acyclic
- `research` tasks may run in parallel
- `implement` tasks may run in parallel only when `write_scope` does not overlap
- read-only `verify` tasks may run in parallel with safe `implement` work

```mermaid
flowchart TD
  A["User Goal"] --> B["Coordinator Plan"]
  B --> C["Task Graph"]
  C --> D["Research"]
  C --> E["Implement"]
  E --> F["Verify"]
  D --> G["Task Runtime"]
  E --> G
  F --> G
  G --> H["Completion + Summary"]
```

Primary implementation areas:

- `packages/openagt/src/coordinator`
- `packages/openagt/src/session/task-runtime.ts`
- `packages/openagt/src/tool/task*.ts`

## Personal Agent Core v1

Personal Agent Core adds longer-lived backend state beyond a single session.

The design has three memory scopes:

- profile memory
- workspace memory
- session memory

It also adds:

- inbox items
- scheduled wakeups
- normalized multi-entry ingestion
- memory synthesis from durable backend events

```mermaid
flowchart LR
  A["Session Input"] --> D["Inbox"]
  B["Scheduled Wakeup"] --> D
  C["Webhook Input"] --> D
  D --> E["Coordinator / Runtime"]
  E --> F["Memory Synthesizer"]
  F --> G["Profile Memory"]
  F --> H["Workspace Memory"]
  F --> I["Session Memory"]
```

Retrieval model in the current backend:

- scope-aware lookup
- SQLite-backed persistence
- FTS5 for text retrieval
- ranking by scope, recency, and importance

Primary implementation areas:

- `packages/openagt/src/personal`
- `packages/openagt/src/coordinator`
- `packages/openagt/src/storage`

## Server and SDK

The same backend can be consumed through:

- CLI / TUI
- server routes
- SSE events
- generated JavaScript SDK

Stable backend-facing event families:

- `coordinator.*`
- `inbox.*`
- `scheduler.*`
- `memory.updated`

Primary implementation areas:

- `packages/openagt/src/server`
- `packages/sdk/js`

## Repository Map

| Path | Role |
| --- | --- |
| `packages/openagt` | Core runtime, tools, providers, CLI, server |
| `packages/app` | Web client |
| `packages/sdk/js` | Generated JavaScript SDK |
| `packages/openagt_flutter` | Flutter MVP |
| `packages/console/*` | Control-plane packages |
| `packages/web` | Docs/site package |

## Release Architecture

Stable release packaging currently targets:

- Windows MSI
- Windows portable zip
- macOS tarballs
- Linux tarball

Packaging and release behavior:

- `openagt` is the primary CLI identity
- `opencode` remains as a compatibility alias
- `SHA256SUMS.txt` is published with assets
- Windows signing is a separate release concern, not part of the runtime model itself

Windows signing details are documented separately in [C:\Users\Administrator\Desktop\OpenAG\docs\release\windows-signing.md](C:\Users\Administrator\Desktop\OpenAG\docs\release\windows-signing.md).

## Current Limitations

- naming transition is still incomplete in parts of the repo
- Flutter is not part of the stable release support matrix
- some compatibility paths still refer to historical `opencode` naming
- Windows release signing requires Azure Trusted Signing configuration and is not yet always present on shipped assets

## Reading Guide

If you are new to the codebase, start in this order:

1. `packages/openagt/src/index.ts`
2. `packages/openagt/src/session`
3. `packages/openagt/src/tool`
4. `packages/openagt/src/permission`
5. `packages/openagt/src/security`
6. `packages/openagt/src/coordinator`
7. `packages/openagt/src/personal`
