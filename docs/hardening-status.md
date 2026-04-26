# OpenAGt Runtime Hardening Status

This checklist tracks the large coordinator/subagent/runtime hardening pass. It is intentionally split so release fixes do not get mixed with broad subsystem rewrites.

## Release Strategy

| Target | Scope | Gate |
| --- | --- | --- |
| `v1.17.0-rc` | Runtime correctness fixes, subagent partial semantics, coordinator validation, permission precedence, release verification hygiene, and current TUI/task visibility improvements. | Typecheck, focused regression tests, full package test with any transient failures documented, and `release:verify`. |
| `v1.20.x` | Trustworthy Agent Runtime Foundation: stable local CLI/server/SDK runtime, clear safety boundaries, recoverable long sessions, verifiable assets, and client-consumable diagnostics. | `bun run verify:v1.20`, packaging smoke, checksums, SBOM, and release notes that do not claim deferred Expert Mesh work. |

`v1.17.0-rc` was allowed to ship with documented deferred hardening work. `v1.20.0-ga` is limited to the implemented audit foundation; Expert Registry, Typed Handoffs, Council, Memory v2, and specialist workflow packs remain roadmap items.

## Current Pass

| Area | Status | Notes |
| --- | --- | --- |
| Bash test runtime disposal | regression-only | Current tests dispose managed runtimes; keep full-suite hang regression. |
| `release:verify` schema mutation | regression-only | Current verifier writes temp schema output before compare; keep dirty-worktree gate. |
| Coordinator duplicate IDs | implemented | Plan validation rejects duplicate node ids. |
| Coordinator dangling dependencies | implemented | Plan validation rejects missing `depends_on` targets. |
| Coordinator cycles | implemented | Plan validation reports explicit dependency cycle path. |
| Subagent max-step partial | implemented | Step-budget and timeout results are stored as retryable `partial`, not `completed`. |
| Task result retrieval | implemented | Full result text is persisted and returned through task metadata/tool output. |
| Anthropic token accounting | implemented | Task usage uses provider-normalized total tokens. |
| Permission deny precedence | implemented | Matching deny rules override allow/ask. |
| Chinese intent dictionary | implemented | Mojibake terms replaced with valid bilingual workflow/risk terms. |
| AsyncQueue close/abort | implemented | Queue supports close, abortable take, and bounded capacity. |
| CRLF byte accounting | partial | Read/truncate account for CRLF; patch/edit EOL preservation remains open. |
| Grep partial metadata | partial | Tool result now exposes `partial`; skipped count needs ripgrep stderr parsing. |
| Local `.claude` state | implemented | `.claude/` is ignored; the old tracked local gitlink is removed from the index so machine state does not pollute release status. |

## Plan / EBI Check

| Requirement | Current status | Release decision |
| --- | --- | --- |
| Baseline hygiene | implemented for RC | `.claude/` is ignored and removed from the tracked release baseline. Remaining hardening source changes are tracked in this checklist. |
| Coordinator DAG correctness | implemented | Duplicate ids, dangling dependencies, and cycles are covered by validation. Suitable for `v1.17.0-rc`. |
| Revise insertion topo safety | regression-covered | Deep effort revise gates and checkpoint synthesis are covered by coordinator intent/runtime tests. |
| Token usage normalization | implemented | Anthropic cache double-count is addressed for task runtime usage. Suitable for RC. |
| Continue budget velocity floor | partial | Blind default budget growth is blocked. Full progress/evidence velocity floor remains v1.20 work. |
| Absolute ceiling enforcement | partial | Current work improves budget semantics, but all resource dimensions still need a dedicated enforcement pass. Keep out of RC scope unless a regression appears. |
| Partial/max-step semantics | implemented | Partial is terminal but not success. Suitable for RC, with continued coordinator retry/checkpoint tests. |
| Full result text for review verdict parsing | implemented | Runtime persists full result text; reviewers are no longer limited to first-line summaries. |
| Unified bilingual classifier | implemented | Mojibake fixed and broad-task overmatch reduced. More LLM fallback/classifier confidence work belongs to v1.20. |
| Magic budget constants | partial | `BudgetTuning` exists and min resource limits are centralized. More `Why:` rationale/comments can wait for v1.20 cleanup. |
| Safe subagent scheduler cap | implemented previously | Keep focused concurrency regression in RC gate. |
| Coordinator split | deferred | Do not block `v1.17.0-rc`; required for v1.20 maintainability. |
| Workflow/role coverage | deferred | Public enum/template audit belongs to v1.20 unless a visible workflow is broken. |
| Runtime efficiency O(n2) fetches | deferred | Not RC-blocking unless full test or real usage shows stalls. |
| CRLF/Unicode handling | partial | Read/truncate improved; patch/edit round-trip remains future hardening work. |
| Permission deny-overrides-allow | implemented | Suitable for RC. |
| Sandbox process labeling | implemented | Process backend status now calls out process-level enforcement instead of implying OS-native isolation. Full OS-native sandboxing remains roadmap work. |
| WebFetch redirect SSRF guard | implemented | Redirect hops are checked and private/local/metadata targets are blocked by default. |
| TUI ANSI/OSC sanitization | implemented | Unsafe control sequences are stripped before TUI render. |
| Server body limit/local bearer auth | implemented | Body limit, JSON depth guard, local origin check, and optional local bearer/cookie support are implemented. |
| Compaction CAS/circuit breaker | implemented | Compaction uses epoch checks and hard-stops after repeated failures. |
| Prompt timeout / child env stripping | implemented | Prompt steps use local timeout; child processes strip OpenAGt auth-content env values. |
| Static prompt cache-control / token estimates | implemented | System-prompt zones are marked for cache-control transforms and non-ASCII token estimates are safer. |
| Path canonicalization | implemented | External-directory grants and path-overlap checks use canonical path comparison. |
| Storage/event snapshots/indexes | deferred | Scalability work for a later expert-runtime release line. |
| Personal memory SQL pushdown/wakeup claim | deferred | Scalability/correctness work for a later expert-runtime release line. |

## Deferred / Next Pass

- Full OS-native sandbox backend enforcement beyond process-level semantics.
- Measured cache-control hit-rate benchmark in CI.
- Full provider tokenizer integration beyond the safer fallback estimator.
- Provider/MCP/plugin/LSP/bus scalability work.
- Storage snapshots, event indexes, fsync policy, and personal memory SQL pushdown.
- Expert Registry, Typed Handoffs, Council, Memory v2, specialist workflow packs, and automation rollback safety.
