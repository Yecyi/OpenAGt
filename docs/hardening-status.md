# OpenAGt Runtime Hardening Status

This checklist tracks the large coordinator/subagent/runtime hardening pass. It is intentionally split so release fixes do not get mixed with broad subsystem rewrites.

## Release Strategy

| Target | Scope | Gate |
| --- | --- | --- |
| `v1.17.0-rc` | Runtime correctness fixes, subagent partial semantics, coordinator validation, permission precedence, release verification hygiene, and current TUI/task visibility improvements. | Typecheck, focused regression tests, full package test with any transient failures documented, and `release:verify`. |
| `v1.20.0-ga` | Larger architectural hardening: coordinator file split, server local auth, WebFetch SSRF guard, TUI ANSI sanitizer, compaction CAS, storage snapshots/indexes, MCP/provider/LSP scalability, and plugin middleware. | Clean full matrix, packaging smoke, security regression suite, and updated release notes/checksums/SBOM. |

`v1.17.0-rc` is allowed to ship with documented deferred hardening work. GA should not be declared until the v1.20 security/reliability items are implemented or explicitly risk-accepted.

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
| Revise insertion topo safety | needs regression | Validation now catches bad graphs, but a deep revise insertion regression should be added before GA. |
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
| CRLF/Unicode handling | partial | Read/truncate improved; patch/edit round-trip remains v1.20 work. |
| Permission deny-overrides-allow | implemented | Suitable for RC. |
| Sandbox fail-closed/process labeling | deferred | Important for GA trust; keep as v1.20 security blocker. |
| WebFetch redirect SSRF guard | deferred | Security blocker for GA, not implemented in RC scope. |
| TUI ANSI/OSC sanitization | deferred | Security/UX blocker for GA, not implemented in RC scope. |
| Server body limit/local bearer auth | deferred | Security blocker for GA, not implemented in RC scope. |
| Compaction CAS/circuit breaker | deferred | Reliability blocker for GA, not implemented in RC scope. |
| Storage/event snapshots/indexes | deferred | Scalability work for v1.20. |
| Personal memory SQL pushdown/wakeup claim | deferred | Scalability/correctness work for v1.20. |

## Deferred / Next Pass

- WebFetch redirect SSRF guard with per-hop public-IP validation.
- TUI/tool output ANSI/OSC sanitization.
- Server request body limits, deep JSON guard, and local bearer token enforcement.
- Compaction epoch/CAS and circuit-breaker hard stop.
- Static system prompt cache-control and provider tokenizer based estimates.
- Sandbox fail-closed enforcement and clearer process-sandbox labeling.
- Path canonicalization/realpath for grants and path overlap.
- Provider/MCP/plugin/LSP/bus scalability work.
- Storage snapshots, event indexes, fsync policy, and personal memory SQL pushdown.
