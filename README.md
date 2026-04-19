# OpenAG

> An enhanced open-source AI coding agent built on [OpenCode](https://github.com/anomalyco/opencode), featuring advanced context compression, tool concurrency control, and Flutter-based mobile/desktop support.

---

## About OpenAG

OpenAG is a research and development project that extends [OpenCode](https://opencode.ai) — the open-source AI coding agent — with enhanced algorithms, improved reliability, and native mobile application support.

**Key Enhancements over OpenAG:**

- **Three-Layer Progressive Compression** — Hierarchical context management inspired by Claude Code and Hermes Agent, reducing token usage by 40-55% while preserving critical information
- **Tool Concurrency Partitioning** — Safe/unsafe tool batching for parallel execution, improving throughput by 2-3x
- **Provider Fallback Chain** — Automatic failover across LLM providers (Anthropic, OpenAI, Google, etc.) on rate limits and server errors
- **Prompt Injection Protection** — Security scanning for adversarial instructions in context files
- **Flutter Mobile Client** — Native iOS/Android application for remote agent control
- **Iterative Compression** — Hermes-style iterative summarization that preserves cross-compression context

---

## Architecture

OpenAG builds upon OpenCode's client/server architecture:

```
┌─────────────────────────────────────────────────────────────┐
│  Clients                                                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│  │  TUI    │ │   Web   │ │ Desktop │ │ Flutter │         │
│  │ (CLI)   │ │  (Vite) │ │ (Tauri) │ │ Mobile  │         │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘         │
└───────┼────────────┼────────────┼────────────┼────────────────┘
        │            │            │            │
        └────────────┴─────┬──────┴────────────┘
                           │ HTTP + SSE/WebSocket
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  OpenAG Server (Hono + Effect Framework)              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Session  │ │   Tool   │ │Provider │ │Compaction│   │
│  │ Manager  │ │ Registry │ │ Manager │ │ Engine   │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │   LSP   │ │   MCP    │ │Permission│ │  ACP    │   │
│  │ Service │ │ Manager  │ │ Engine  │ │Protocol │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  SQLite (WAL Mode) + File System                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.0+ or Node.js 20+
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/openag.git
cd openag

# Install dependencies
bun install

# Start the server
bun run dev

# In another terminal, start the TUI
bun run openag
```

### Development

```bash
# Type checking
bun typecheck

# Linting
bun lint

# Run tests
bun test packages/opencode
```

---

## Project Structure

```
openag/
├── packages/
│   ├── opencode/          # Core agent engine (OpenAG base)
│   │   └── src/
│   │       ├── session/   # Agent loop, compaction, messaging
│   │       ├── tool/      # Tool registry, execution, partitioning
│   │       ├── provider/   # LLM provider abstraction, fallback
│   │       ├── security/   # Injection protection
│   │       └── ...
│   ├── app/              # SolidJS web application
│   ├── desktop/          # Tauri desktop application
│   ├── desktop-electron/ # Electron desktop application
│   ├── sdk/             # Client SDK (JavaScript/TypeScript)
│   └── ...
├── docs/
│   └── TECHNICAL_ANALYSIS_REPORT.md  # Full technical analysis
├── Code Reference/
│   ├── CC Source Code/  # Claude Code reference (for analysis)
│   └── hermes-agent/     # Hermes Agent reference (for analysis)
└── OpenAG Theme Design/ # Design system specification
```

---

## Core Algorithms

### Three-Layer Progressive Compression

| Layer | Trigger | Method | API Cost |
|-------|---------|--------|----------|
| **MicroCompact** | Time threshold | Replace old tool results with 1-line summaries | $0 |
| **AutoCompact** | Token overflow | Session memory pruning | $0 |
| **Full Compact** | Context exceeded | LLM summarization with structured template | ~$0.03-0.09 |

### Tool Concurrency Partitioning

```
Safe Tools (parallel):     read, glob, grep, webfetch, websearch, codesearch, lsp, question, skill
Unsafe Tools (serial):   bash, edit, write, task, todo, plan, apply_patch

Example: [read, glob, edit] → [read + glob] then [edit]
```

### Provider Fallback Chain

```
Primary: anthropic/claude-sonnet-4
  ↓ 429 Rate Limit
Fallback: openai/gpt-4o
  ↓ 500 Server Error
Final Fallback: google/gemini-2.5-pro
```

---

## Documentation

### Technical Analysis

For a comprehensive analysis of OpenAG's architecture, algorithm enhancements, and Flutter feasibility study, see:

- [docs/TECHNICAL_ANALYSIS_REPORT.md](./docs/TECHNICAL_ANALYSIS_REPORT.md)

This report covers:
- Architecture comparison (OpenCode vs Claude Code vs Hermes Agent)
- Three-layer compression algorithm design
- Tool concurrency partitioning implementation
- Provider fallback chain design
- Security threat modeling
- Performance benchmarks
- Flutter mobile application feasibility
- Implementation roadmap

### Design System

For UI/UX specifications following the "Modern Archive" editorial aesthetic:

- [OpenAG Theme Design/](OpenAG%20Theme%20Design/)

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Core Runtime | TypeScript + Bun |
| Framework | Effect v4 (functional programming) |
| AI SDK | Vercel AI SDK (25+ providers) |
| HTTP Server | Hono |
| Database | SQLite (Drizzle ORM) |
| Web Framework | SolidJS |
| Desktop | Tauri 2 + Electron |
| Mobile | Flutter (planned) |
| Terminal UI | @opentui/core + SolidJS |
| Protocol | ACP (Agent Communication Protocol) |

---

## License

MIT License — see [LICENSE](./LICENSE)

---

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

---

## References

- [OpenCode](https://opencode.ai) — Base project
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — Reference implementation
- [Vercel AI SDK](https://sdk.vercel.ai) — AI provider abstraction
- [Effect Framework](https://effect.website) — Functional programming

---

**Note:** OpenAG is an independent research project. It is not affiliated with, endorsed by, or supported by Anthropic, OpenAI, or the OpenAG team.
