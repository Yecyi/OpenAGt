# OpenAGt Runtime Hardening Status

This checklist tracks the large coordinator/subagent/runtime hardening pass. It is intentionally split so release fixes do not get mixed with broad subsystem rewrites.

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
