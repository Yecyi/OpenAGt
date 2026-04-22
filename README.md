# OpenAGt

OpenAGt is an OpenCode-derived AI coding agent project. The current repository is best understood as a fork/customization layer on top of [OpenCode](https://github.com/anomalyco/opencode), with OpenAGt branding, extra runtime experiments, and a Flutter mobile client MVP.

This is not a clean-room reimplementation. The lineage is visible throughout the repo:

- `openagt` is the primary CLI name in this fork.
- `opencode` is still shipped as a compatibility alias.
- Internal paths, UI copy, installer behavior, package names, and some environment variables still retain `opencode` naming.

If you are describing this project externally, the accurate phrasing is: "OpenAGt is based on OpenCode and extends it with additional runtime, security, and client-side work."

## Repository Status

This README describes the repository as it exists today, not every historical claim that has appeared in older documentation.

What is present and actively relevant in this snapshot:

| Path | Role |
| --- | --- |
| `packages/openagt` | Core agent runtime, CLI, Hono server, local persistence, tools, MCP/LSP/ACP integration |
| `packages/app` | Solid/Vite web client |
| `packages/sdk/js` | Generated JavaScript SDK used by the runtime and clients |
| `packages/openagt_flutter` | Flutter mobile MVP |
| `packages/console/*` | Console/control-plane services and web app |
| `packages/web` | Astro/Starlight docs and site |
| `packages/opencode` | Small leftover compatibility package, currently not the main runtime |

Important caveat:

- The root `package.json` still contains stale references such as `packages/desktop-electron`, but that package is not present in this repo snapshot. Do not document desktop packaging as a verified local target unless that package is restored.

## Codebase Lineage

The codebase is structurally much closer to OpenCode than the old root README suggested.

Evidence visible in the repo:

- `packages/openagt/bin/opencode` exists as a compatibility launcher.
- The installer creates both `openagt` and `opencode` symlinks.
- The primary runtime still exposes `OPENCODE_*` compatibility environment variables alongside `OPENAGT_*`.
- Large parts of the UI and configuration ecosystem still reference "OpenCode" in prose or identifiers.
- `.opencode/` and `packages/opencode/` are still present in the repository.

That does not make OpenAGt "just a rename". It is a fork with real local modifications, but the README should be explicit about the base project instead of implying a completely separate origin.

## Verified Technical Architecture

### Core Runtime

`packages/openagt` is the actual heart of the system. It contains:

- the CLI entrypoint and command tree
- the headless server built on Hono
- session/message orchestration
- tool registration and execution
- model/provider loading
- local SQLite storage and JSON-to-SQLite migration logic
- permission, shell review, and sandbox-related logic
- MCP, LSP, ACP, plugin, and agent integration

The runtime is Bun-first, but it keeps some Bun/Node compatibility branches through import maps such as `#db`, `#pty`, and `#hono`.

### Tool Scheduling and Concurrency

The codebase does implement tool concurrency control, but the accurate description is narrower than the older README claimed.

What is implemented:

- `packages/openagt/src/tool/partition.ts` classifies a fixed set of tools as concurrency-safe.
- Safe tools are currently `read`, `glob`, `grep`, `webfetch`, `codesearch`, `websearch`, `lsp`, `question`, and `skill`.
- Unsafe tools such as `bash`, `edit`, `write`, `task`, `todo`, `plan`, and `apply_patch` are serialized.
- `packages/openagt/src/session/prompt/tool-resolution.ts` adds path extraction and path-conflict blocking so overlapping file operations do not run at the same time.

What should not be overstated:

- This is not a full global DAG scheduler.
- The repo does not currently provide reproducible benchmark data proving fixed `2x-3x` latency wins.

So the README should describe this as "safe/unsafe tool partitioning with path-conflict checks", not as a universally optimized scheduler with hard performance guarantees.

### Provider Abstraction and Fallback

The provider layer is real and reasonably substantial.

What is implemented:

- multi-provider model loading through the AI SDK ecosystem
- config-driven fallback chains in `packages/openagt/src/config/provider.ts`
- fallback state handling in `packages/openagt/src/provider/fallback-service.ts`
- retry decisions based on rate limits and server errors
- metrics such as fallback rate, reason buckets, provider buckets, and hop latencies
- bus events for fallback hops

This is a concrete feature in the fork and worth documenting. The README should describe it as config-driven fallback and observability, not just "automatic failover" in the abstract.

### Security and Shell Review

The security layer also exists in code, but it needs precise wording.

What is implemented:

- shell danger heuristics for POSIX-style commands
- PowerShell-specific checks for encoded commands, remote execution, and dangerous cmdlets
- a custom lightweight PowerShell tokenizer/AST pass in `packages/openagt/src/security/powershell-ast.ts`
- a unified detector in `packages/openagt/src/security/dangerous-command-detector.ts`

What that means in practice:

- the repo can flag patterns like `Invoke-Expression`, `Invoke-Command`, `-EncodedCommand`, AMSI bypass strings, and common LOLBins such as `rundll32.exe`, `regsvr32.exe`, and `mshta.exe`
- this goes beyond plain regex matching
- it is still a project-specific parser, not the official PowerShell parser or a formal sandbox proof

That distinction matters. The README should present it as "heuristic command security analysis with a custom PowerShell AST layer", which is accurate and still useful.

### Context and Session Management

The runtime contains compaction-related code under the session subsystem, including `micro`, `auto`, and `full` compaction strategies.

What is safe to say:

- the repo has multiple context-compaction paths
- session/message state is a first-class subsystem
- there is explicit logic for retries, overflow handling, summaries, memory, and tool-aware prompt assembly

What should not be claimed without benchmarks:

- fixed token savings such as `40%-55%`
- fixed cost reductions
- guaranteed quality retention under all workloads

If you want those numbers in the future, add a benchmark document and link it from the README.

### Clients

The repository currently contains multiple client surfaces:

- CLI/TUI through `packages/openagt`
- Web app through `packages/app`
- Console web surfaces through `packages/console/app`
- Flutter mobile MVP through `packages/openagt_flutter`

The Flutter app is real code, not just a placeholder. The package includes API, SSE, chat, session, and theme layers. Still, it should be documented as an MVP client, not as a feature-complete mobile product.

## Quick Start

### Prerequisites

- Bun 1.3+
- Git
- Flutter 3.41+ if you want to run the mobile client

### Fresh Clone Setup

After a fresh clone, generate the JavaScript SDK before trying to start the CLI or server.

```bash
bun install
bun run --cwd packages/sdk/js script/build.ts
```

This step is required because `packages/openagt` imports generated SDK files under `packages/sdk/js/src/v2/gen`.

### Run the Core CLI

```bash
bun run --cwd packages/openagt src/index.ts --help
bun run --cwd packages/openagt src/index.ts
```

Compatibility note:

- `openagt` is the preferred command name in this fork.
- `opencode` still exists as a compatibility entrypoint.

### Run the Headless Server

```bash
bun run --cwd packages/openagt src/index.ts serve
```

### Run the Web Client

```bash
bun run --cwd packages/app dev
```

### Run the Docs Site

```bash
bun run --cwd packages/web dev
```

### Run the Flutter Mobile MVP

```bash
cd packages/openagt_flutter
flutter pub get
flutter run
```

## Development Workflow

### SDK Regeneration

Whenever the API surface changes, regenerate the JS SDK:

```bash
bun run --cwd packages/sdk/js script/build.ts
```

### Type Checking

Per repository guidance, run type checking from package directories instead of invoking `tsc` directly:

```bash
cd packages/openagt
bun typecheck
```

Other useful package-local checks:

```bash
cd packages/app
bun typecheck
```

### Tests

Do not run tests from the repo root. The root `test` script intentionally exits with `do not run tests from root`.

Run tests from the relevant package instead:

```bash
cd packages/openagt
bun test
```

## Recommended README Positioning

If this project is being presented to users, contributors, or investors, the README should emphasize these points:

1. OpenAGt is based on OpenCode, not independent from it.
2. The repo contains meaningful fork-specific work in provider fallback, shell security, scheduling, and mobile/client experimentation.
3. Some naming and package layout are still in transition, so compatibility aliases and OpenCode references remain intentional or unfinished.
4. Performance claims should be benchmark-backed before they appear in the README.

## Known Documentation Corrections

These are the main corrections from the older README:

- Replace self-referential "built on OpenAGt" wording with explicit OpenCode lineage.
- Remove or soften unverified numeric claims about token savings and latency improvements.
- Do not present desktop packaging as part of the verified local repo when the corresponding package is missing.
- Document the required SDK generation step for fresh clones.
- Clarify that `openagt` and `opencode` both exist, with `opencode` kept for compatibility.
- Treat the Flutter client as an MVP, not as a fully complete cross-platform product.

## Further Reading

- [OpenCode upstream](https://github.com/anomalyco/opencode)
- [Technical analysis report](./docs/TECHNICAL_ANALYSIS_REPORT.md)
- [Core runtime package](./packages/openagt/README.md)
- [Web app](./packages/app/README.md)
- [JavaScript SDK](./packages/sdk/js/package.json)
- [Flutter client](./packages/openagt_flutter/pubspec.yaml)

## License

MIT. See [LICENSE](./LICENSE).
