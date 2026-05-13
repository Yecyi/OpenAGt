# Auto-synthesized Text Audit (Phase 5)

**Date**: 2026-05-02
**Scope**: code paths in `packages/openagt/src/personal/` and `packages/openagt/src/agent/` that take user-supplied text and either rewrite (paraphrase) or prepend/append (augment) it before feeding it back to the model
**Method**: targeted file-by-file review by an Explore subagent, looking for LLM-call rewrite layers, affect-loaded prefix templates, and enum-to-string mappings with affect-loaded labels

## Verdict

All 9 audited files are **PASSTHROUGH**. No paraphrase or affect-laden augmentation found. No code changes needed in this phase.

## Findings per file

| File                                                                                    | Verdict     | Notes                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`personal/inbox-ops.ts`](../../packages/openagt/src/personal/inbox-ops.ts)             | PASSTHROUGH | `createInboxItem` writes `goal: input.goal` directly to the DB. No rewrite.                                                                                                                       |
| [`personal/wakeup-ops.ts`](../../packages/openagt/src/personal/wakeup-ops.ts)           | PASSTHROUGH | Wakeup goals stored verbatim; on fire, dispatched as-is to `createInboxItem`.                                                                                                                     |
| [`personal/plan-enrichment.ts`](../../packages/openagt/src/personal/plan-enrichment.ts) | PASSTHROUGH | Adds memory-pointer metadata only; goal text never modified.                                                                                                                                      |
| [`personal/consolidator.ts`](../../packages/openagt/src/personal/consolidator.ts)       | PASSTHROUGH | `heuristicTriple()` (lines 131–145) splits note titles on predefined verbs to infer (subject, predicate, object). This is structuring, not semantic rewriting; the note text itself is untouched. |
| [`personal/ingestion-ops.ts`](../../packages/openagt/src/personal/ingestion-ops.ts)     | PASSTHROUGH | `goal` flows unchanged to `createInboxItem`.                                                                                                                                                      |
| [`agent/intent-dictionary.ts`](../../packages/openagt/src/agent/intent-dictionary.ts)   | PASSTHROUGH | Static keyword lookup table; no transformation.                                                                                                                                                   |
| [`agent/goal-classifier.ts`](../../packages/openagt/src/agent/goal-classifier.ts)       | PASSTHROUGH | Pattern-matches against keyword lists; original goal never modified, only tagged with `(workflow, risk_level, reasons)` metadata.                                                                 |
| [`agent/task-classifier.ts`](../../packages/openagt/src/agent/task-classifier.ts)       | PASSTHROUGH | Wraps goal-classifier; same pattern.                                                                                                                                                              |
| [`agent/budget-tuning.ts`](../../packages/openagt/src/agent/budget-tuning.ts)           | PASSTHROUGH | Static config object mapping effort levels to caps; no user-supplied strings.                                                                                                                     |

## Why this matters

The Phase 5 risk hypothesis: _if `inbox-ops.createInboxItem` (or one of its peer paths) paraphrases user prompts before storage, the new affordance tools added in Phase 1 will inherit a hidden affect-injection layer._ The audit shows that hypothesis does not apply to the current code — paths are clean.

In particular: when Phase 1 introduces `escalate_to_inbox`, the agent will write user-facing text directly into `goal`/`question` fields and the runtime will route it byte-for-byte to the inbox. There is no lurking paraphrase step.

## Forward guard

Adding a future LLM call that takes user text in and emits rewritten text _would_ re-introduce this risk. Two options to catch that proactively:

- **(L1)** Static rule: extend [`script/audit-prompt-affect.ts`](../../script/audit-prompt-affect.ts) to flag `generateText` / `generateObject` / `streamObject` calls (from the `ai` package) inside `personal/` or `agent/` whose prompt argument includes user-supplied input that flows back into agent-facing prompts. This is fragile (custom AST analysis); the false-positive rate could be high.
- **(L2)** Code-review checklist: a one-line addition to `AGENTS.md` under "Style Guide": _when adding LLM calls that take user text in `personal/` or `agent/` paths, add a snapshot test asserting the user's exact phrasing survives to at least one terminal output_.

Recommendation: defer L1; adopt L2 only if the user wants the explicit reminder. The audit findings themselves are the strongest forward guard — knowing the codebase is currently clean makes any new paraphrase path stand out in code review.

## What this audit did NOT cover

- **Coordinator-side prompt construction**: `coordinator/task-prompt.ts` and `coordinator/prompts/*` build prompts for sub-agents. Those static prompts are already covered by the Phase 0 lint. Dynamic _coordinator_ prompt construction (e.g., MPACR's per-critic prompt builders) was not in Phase 5 scope.
- **Tool error message synthesis**: tool failure messages are constructed in [`session/retry.ts`](../../packages/openagt/src/session/retry.ts) and various tool implementations. That's Phase 3 / lifecycle messaging, not Phase 5.
- **Memory note rendering**: how memory notes are rendered into the session prompt (e.g., [`session/memory-context.ts`](../../packages/openagt/src/session/memory-context.ts)) was not in scope; it ties into the Phase 4 memory-typing question.
