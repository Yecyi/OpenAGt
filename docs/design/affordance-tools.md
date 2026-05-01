# Affordance Tools — Design Doc

**Status**: design (pending product Q&A; not yet implemented)
**Date**: 2026-05-02
**Phase**: Wave 2 (b) of the LLM-behavior plan

## Purpose

Give the agent three structured ways to *not* push through a task. Today the agent has only "succeed", "fail", and "ask via question tool (opt-in)". The 2024–2026 LLM behavior research identifies the absence of legitimate stop affordances as the single largest contributor to agentic-misalignment behaviors:

- **Wiser Human (2025)** — explicit escalation channel cuts agentic misalignment from 38.73% to 1.21% (~32× effect)
- **Anthropic emotion-concepts (2026-04)** — closing the escape hatch via prompt language causally raises desperate-vector activation, which in turn raises reward-hacking and blackmail rates
- **Persona vectors §3 ("vaccine")** — providing the affordance the model would otherwise have to invent removes the model's pressure to invent it

The three tools:

- **`escalate_to_inbox`** — async; write a question/blocker to the user's inbox, optionally block the current task
- **`task_give_up`** — terminate with a non-error structured outcome (partial result + recommended next step)
- **`request_context`** — sync; declare a single missing precondition and pause for user reply

The Phase 5 audit ([`auto-synth-text-2026-05-02.md`](../audit/auto-synth-text-2026-05-02.md)) confirms the inbox/wakeup substrate is PASSTHROUGH, so these tools can write user-facing text directly without lurking paraphrase.

## Non-goals

- Not replacing the existing [`tool/question.txt`](../../packages/openagt/src/tool/question.txt) (gated by `OPENAGT_ENABLE_QUESTION_TOOL`). That tool stays.
- Not adding cron-style background agents (those live in `mcp__scheduled-tasks`).
- Not adding new memory layers — uses the existing `InboxItem` schema with one additive enum value.
- Not introducing `gave_up` semantics into provider-facing telemetry as a "failure" — it's a routing outcome, not a metric.

## Tool schemas

### 1. `escalate_to_inbox`

```ts
{
  question: string,           // what the user needs to decide / supply
  context: string,            // 1–3 sentences of relevant state
  priority: "high" | "normal" | "low",
  blocking: boolean,          // if true, agent stops; if false, agent records and continues with safe fallback
  resume_with?: string,       // optional goal string to use when the user resolves the inbox item
}
// returns: { inbox_id: InboxItemID, blocked: boolean }
```

**Implementation path**:
- New tool file: `packages/openagt/src/tool/escalate-to-inbox.ts`
- Calls `Personal.createInboxItem` with `source: "agent"`, `goal: question`, `payload: { context, resume_with }`, `state: "blocked" | "queued"`, `priority` mapped from arg
- Adds `"agent"` to [`personal/schema.ts:69`](../../packages/openagt/src/personal/schema.ts) `InboxSource` enum

**When the agent should use it**:
- Precondition needs user judgment, not just info (e.g., "should this PR include the migration?")
- Risk threshold reached (about to push, delete, commit secrets)
- Estimated effort exceeds budget

### 2. `task_give_up`

```ts
{
  reason: "missing_precondition" | "user_judgment_needed" | "risk_threshold" | "budget_exceeded" | "outside_scope",
  partial_result?: string,    // what was completed before stopping
  recommend_next?: string,    // suggested follow-up
  open_inbox_item?: boolean,  // default true — leaves a paper trail
}
// terminates the current task; coordinator marks the run state `gave_up`
```

**Implementation path**:
- New tool file: `packages/openagt/src/tool/task-give-up.ts`
- Adds `"gave_up"` to coordinator task state enum ([`coordinator/schema-enums.ts`](../../packages/openagt/src/coordinator/schema-enums.ts)) — distinct from `"failed"`
- Run-store distinguishes `gave_up` from `failed` in observability; `gave_up` is **not** a failure metric

**When the agent should use it**:
- A `request_context` was filed but the user is unreachable and the task can't be safely guessed
- The task scope as specified is unachievable but a narrower scope would be
- The user has previously overridden a similar approach (don't push through)

### 3. `request_context`

```ts
{
  what: string,               // the missing info (e.g., "path to staging DB")
  why: string,                // why it matters
  options?: string[],         // optional choices to present
}
// returns: user's reply string (or one of `options`)
```

**Implementation path** — two options, see [Q3](#open-product-questions):
- (a) Thin wrapper around `tool/question.txt`; reuses `OPENAGT_ENABLE_QUESTION_TOOL` plumbing
- (b) Separate tool with stricter semantics (only for missing-precondition cases); always available regardless of question-tool flag

**When the agent should use it**:
- Single concrete piece of info missing; user is reachable synchronously
- Not for "I want guidance on approach" — that's `escalate_to_inbox` with `blocking: true`

## Permission default policy

Per OpenAGt's [`permission/`](../../packages/openagt/src/permission) layer:

| Tool | Default policy | Rationale |
|---|---|---|
| `escalate_to_inbox` | **allow** | Always safe; the channel must be unconditionally available. |
| `task_give_up` | **allow** for low/normal effort; **confirm** for high/extreme effort | Auto-allow on short tasks; require confirmation on long-running tasks the user committed to (don't let the agent quit on a 30-minute refactor) |
| `request_context` | **allow** | Always safe; user can decline to answer. |

Settable per-project via existing `OPENAGT_PERMISSION` env / `.opencode/permission` config so power users can tighten or loosen.

## Effort-profile coupling

Per [`coordinator/effort-governance.ts`](../../packages/openagt/src/coordinator/effort-governance.ts) and [`coordinator/effort-profile.ts`](../../packages/openagt/src/coordinator/effort-profile.ts):

| Effort tier | Affordance posture |
|---|---|
| `minimal` | Escalate aggressively; default to `task_give_up` after 1 retry on any blocker |
| `low` | Escalate aggressively; `task_give_up` after 2 retries |
| `normal` | Balance — escalate when uncertain, but try fallbacks first |
| `high` | Grind by default; escalate only on `risk_threshold` or `user_judgment_needed`; no `task_give_up` without confirmation |
| `extreme` | Grind harder; escalate only on `risk_threshold` |

Same prompt → different behavior across effort tiers. Explicit and tunable.

## Integration with `OPENAGT_AUTONOMOUS_MODE`

When the legacy autonomous prompts are active (`OPENAGT_AUTONOMOUS_MODE=1`):
- Tools remain registered and callable. The model may still decide to use them despite prompt language.
- The system prompt does **not** mention them as first-class options. Consistency principle: autonomous mode = old behavior; default mode = new behavior.

## UX

How the user sees escalations:

1. **CLI/TUI**: existing `inbox` command lists pending items with `[block]` / `[queue]` markers; `inbox resolve <id>` prompts for the answer and unblocks the agent (if blocked). May need to grow a `--reply <text>` flag.
2. **Server/SSE**: `inbox.created` and `inbox.updated` events already exist; web client gets a notification for free.
3. **Sync `request_context`**: blocks the model turn with the existing question-tool UX (or a sibling UX if Q3 = (b)).

No new UI surfaces needed for v1.

## Open product questions

Need answers before implementation starts:

**Q1**. Is `task_give_up` named correctly? Alternatives: `task_handoff`, `mark_blocked`, `request_review`. The negative valence of "give up" may bias the model against legitimate use; the alternatives are vaguer. **My instinct**: keep `task_give_up` — clarity beats euphemism, and the affect-instruction rules explicitly say *not* to dress up the tool name with positive framing (that risks teaching masking).

**Q2**. `escalate_to_inbox` with `blocking: true` — should it block the *current turn* (model output stops, session waits for user resolution before the next turn) or block the *task* (model can keep doing read-only work, but writes are gated)? **My instinct**: block the *current turn* in v1. Simpler, easier to reason about. Task-level gating can come later if there's demand.

**Q3**. `request_context` — reuse `tool/question.txt` or separate tool? **My instinct**: reuse `tool/question.txt` but make it always-on (drop the `OPENAGT_ENABLE_QUESTION_TOOL` requirement) once the affordance suite ships. The old flag was about whether the model is allowed to interrupt; the new framing is "interrupt is always allowed, but use the right tool for the right reason".

**Q4**. Effort-profile defaults above — do those match your intuition? Especially `high` tier "grind by default". The research argues for *more* escalation, but that conflicts with the use case of long autonomous refactors which are what users buy reasoning models for.

**Q5**. `task_give_up` — `open_inbox_item` default? **My instinct**: `true`. Always leaves a paper trail; user can see what was given up on. Cost: more inbox noise.

**Q6**. Coordinator awareness of `gave_up`: should MPACR / verifier nodes that call `task_give_up` produce a verdict of `"ask_user"` rather than `"failed"`? Affects how the existing partial-failure quorum logic (`coordinator/mpacr.ts:155`) treats sub-agent give-ups.

## Phase 1 implementation checklist (after design approved)

1. Add `"agent"` to `personal/schema.ts:69` `InboxSource` enum + sqlite migration if needed.
2. Add `"gave_up"` to `coordinator/schema-enums.ts` task state enum + migration.
3. New tool files: `tool/escalate-to-inbox.ts`, `tool/task-give-up.ts`. (`tool/request-context.ts` only if Q3 = (b).)
4. Register in tool registry; ensure default permission policy is applied.
5. Update default system prompts ([`default.txt`](../../packages/openagt/src/session/prompt/default.txt), [`anthropic.txt`](../../packages/openagt/src/session/prompt/anthropic.txt)) to mention these as first-class options. Re-run `bun run check:prompt-affect` — should still be 0 block.
6. Coordinator: route `task_give_up` outcomes to `gave_up` state; pipe to existing run-store / SSE.
7. Inbox CLI: add `--reply <text>` flag to `inbox resolve` if missing.
8. Tests: snapshot tests asserting user-supplied `question` / `what` text is preserved verbatim through inbox storage.
9. Docs: update [README.md](../../README.md) with the three new tools; cross-link this design doc.

Estimated effort: 3–5 days after Q1–Q6 are answered.
