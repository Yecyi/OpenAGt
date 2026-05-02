# Behavior Audit Stream

**Status**: shipped (Wave 6, 2026-05-02)
**Scope**: unified `behavior.*` event family covering tool calls, permission decisions, memory injections, sub-agent dispatch, and file touches
**Source**: [`packages/openagt/src/bus/behavior-events.ts`](../../packages/openagt/src/bus/behavior-events.ts)

## Why this exists

The 2024–2026 LLM-behavior research (CoT faithfulness 25–39% on misaligned hints; Anthropic's emotion-concepts paper §1.3 reward-hacking case B) shows the agent's stated reasoning is an unreliable audit signal. Internal state and external presentation are separable; what the agent *says* it will do diverges from what it *actually does* a meaningful fraction of the time.

The behavior audit stream addresses this with **action-level audit**: a single observable that captures every observable action the agent takes — tool invocations, permission decisions, memory loads, sub-agent spawns, file touches — independent of the model's stated reasoning. Downstream consumers reconstruct an action timeline without joining cross-family events.

## Event taxonomy

Six event types, all in the `behavior.*` namespace and registered via the existing `BusEvent.define` pattern:

| Event | Fires when | Key correlation IDs |
|---|---|---|
| `behavior.tool.invoked` | Tool call starts (defined; not currently emitted in v1 — see Step B note) | `tool_call_id`, `session_id`, `message_id` |
| `behavior.tool.completed` | Tool call ends, success or fail | `tool_call_id`, `session_id`, `message_id` |
| `behavior.permission.decided` | Permission reply lands (primary or cascade) | `request_id`, `session_id` |
| `behavior.memory.injected` | Plan-enrichment attaches semantic facts / procedural recipes to a plan | `goal_hash`, `note_ids` |
| `behavior.subagent.dispatched` | Coordinator task transitions pending → running | `parent_session_id`, `child_session_id`, `node_id`, `goal_hash` |
| `behavior.file.touched` | Edit/Write/Read tool succeeds | `path`, `session_id`, `tool_call_id` |

Full payload schemas live in [`packages/openagt/src/bus/behavior-events.ts`](../../packages/openagt/src/bus/behavior-events.ts).

## Correlation paths

Three correlation keys let a downstream consumer rebuild execution history without joining across event families:

- **`session_id`** — links a tool call, its permission decision, and the file it touched within a single session
- **`tool_call_id`** — links the tool's `behavior.tool.completed` to the file mutations it caused (`behavior.file.touched`) and any permission decisions it triggered
- **`goal_hash`** — links coordinator-level plan enrichment (`behavior.memory.injected`) to the eventual sub-agent dispatch (`behavior.subagent.dispatched`) when the plan's nodes get executed

## Persistence gate

Behavior events are **not persisted to disk by default**. Forcing every tool call to journal would add disk I/O on every action.

- **In-memory PubSub**: behavior events flow through the bus to subscribers regardless of persistence — SSE consumers, in-process audit hooks, etc. all see them.
- **Disk-backed ring buffer**: only persisted when `OPENAGT_BEHAVIOR_AUDIT=1` (alias `OPENCODE_BEHAVIOR_AUDIT=1`) is set. The persistence is bounded by the same `OPENCODE_EVENT_BUFFER_SIZE` / `OPENCODE_EVENT_BUFFER_BYTES` envs as the existing critical event types.

The gate lives in [`packages/openagt/src/bus/index.ts`](../../packages/openagt/src/bus/index.ts) via `isBehaviorAuditEnabled()` consulted from `isCriticalEventType()`.

## Subscribing

Static helpers are exported from [`packages/openagt/src/bus/index.ts`](../../packages/openagt/src/bus/index.ts):

```ts
import * as Bus from "@/bus"
import { Event as BehaviorEvent } from "@/bus/behavior-events"

// Subscribe to one specific event type:
const unsub = Bus.subscribe(BehaviorEvent.ToolCompleted, (event) => {
  console.log("tool", event.properties.tool_id, "completed in", event.properties.duration_ms, "ms")
})

// Or subscribe to everything and filter:
Bus.subscribeAll((event) => {
  if (event.type.startsWith("behavior.")) {
    // ...
  }
})
```

Effect-style consumers can use the existing `Bus.Service` interface and call `bus.subscribe(BehaviorEvent.X, handler)`.

## Emission points

| Event | Source | File |
|---|---|---|
| `behavior.tool.completed` | `ProcessorToolCalls.complete()` and `.fail()` | [`session/processor-tool-calls.ts`](../../packages/openagt/src/session/processor-tool-calls.ts) |
| `behavior.permission.decided` | `Permission.reply()` (3 spots: primary, reject cascade, always cascade) | [`permission/index.ts`](../../packages/openagt/src/permission/index.ts) |
| `behavior.memory.injected` | `enrichPlanMemory()` after fact + recipe search | [`personal/plan-enrichment.ts`](../../packages/openagt/src/personal/plan-enrichment.ts) |
| `behavior.subagent.dispatched` | `CoordinatorTaskExecutor.execute()` after `tryStartPending()` | [`coordinator/task-executor.ts`](../../packages/openagt/src/coordinator/task-executor.ts) |
| `behavior.file.touched` | `WriteTool` / `EditTool` / `ReadTool` success paths | [`tool/write.ts`](../../packages/openagt/src/tool/write.ts), [`tool/edit.ts`](../../packages/openagt/src/tool/edit.ts), [`tool/read.ts`](../../packages/openagt/src/tool/read.ts) |

## Failure semantics

All `behavior.*` emissions go through `.pipe(Effect.ignore)` — a publish failure cannot break the path that triggered the event. The audit stream is best-effort observability, not a strong-consistency log.

## What this enables

- **Reward-hacking detection** — compare a sequence of `behavior.tool.completed` failures with the model's stated reasoning. The emotion-concepts paper §1.3 case B showed reward-hacking presents with calm, organized reasoning text but a desperate-vector trace; the behavior trace is what actually lets you spot the pattern.
- **Permission-decision histograms** — per-pattern, per-risk-level acceptance rates, cascade frequency.
- **Memory-injection auditing** — track which `note_id`s flow into which sessions, the kind_breakdown over time. With Wave 5's `kind=fact` filtering on critic dispatch, this is the audit trail proving sycophancy mitigation is actually load-bearing.
- **Sub-agent isolation tracking** — `isolation_level` per dispatch records what context guardrails were in effect for each subagent (Wave 5's `personal_memory_access`).
- **Filesystem footprint reconstruction** — what files did the agent read / write / edit in a session, in what order, against which permissions.

## Known limitations (v1)

- `behavior.tool.invoked` is **defined but not emitted**. The pending → running transition happens inside the AI SDK upstream of `ProcessorToolCalls`. `behavior.tool.completed` carries `duration_ms` so consumers can reconstruct invocation timing; if a real-time in-flight observer is needed later, the event constructor stays available.
- `behavior.subagent.dispatched.isolation_level` reads from `TaskRecord.metadata.personal_memory_access`, which is not yet propagated from `CoordinatorNode.personal_memory_access` (Wave 5 Step 4) through the `CoordinatorNode → TaskRecord` conversion. Until that lands, the field is `"full"` for all dispatches even when the upstream node says `"facts_only"`. The audit event still carries the most accurate value available at this layer.
- `behavior.memory.injected.kind_breakdown` is currently `{fact: N, preference: 0, belief: 0}` because both `searchSemantic` and `searchProcedural` filter to `kind=fact` (Wave 5 Step 5). The breakdown shape is stable for the day preference/belief notes flow through alternative search paths.

## Related work

- **Wave 1–3** — static prompt-affect lint and stop affordances. Methodology in [`prompt-affect-baseline-2026-05-02.md`](prompt-affect-baseline-2026-05-02.md).
- **Wave 5** — memory typing + critic isolation. Schema-level guarantees that pair with Wave 6's emission. Design in [`../design/affordance-tools.md`](../design/affordance-tools.md).
