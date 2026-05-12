import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CoordinatorDebugStats } from "../../src/coordinator/debug-stats"
import { CoordinatorEvents } from "../../src/coordinator/events"
import { CoordinatorTraceExport } from "../../src/coordinator/trace-export"

describe("coordinator telemetry", () => {
  test("records replayable events and exposes standard debug stats", async () => {
    const ts = 4_000_000_000_000
    const base = {
      session_id: "ses_telemetry_test",
      run_id: "run_telemetry_test",
      workflow: "telemetry-workflow",
      effort: "deep",
      ts,
    }

    await Effect.runPromise(
      Effect.all(
        [
          CoordinatorEvents.emit({
            ...base,
            task_id: "task_success",
            expert_id: "expert_alpha",
            event_kind: "task_finished",
            payload: { status: "completed" },
          }),
          CoordinatorEvents.emit({
            ...base,
            task_id: "task_partial",
            expert_id: "expert_alpha",
            event_kind: "task_finished",
            payload: { status: "partial" },
          }),
          CoordinatorEvents.emit({
            ...base,
            task_id: "revise_one",
            event_kind: "revise_triggered",
            payload: { round_index: 3 },
          }),
          CoordinatorEvents.emit({
            ...base,
            event_kind: "continuation_decision",
            payload: { reason: "progress gate", has_progress: true },
          }),
          CoordinatorEvents.emit({
            ...base,
            event_kind: "budget_breach",
            payload: { quality_delta: 0.5, cost_delta: 2 },
          }),
          CoordinatorEvents.emit({
            ...base,
            event_kind: "budget_breach",
            payload: { quality_delta: 0.5, cost_delta: 2 },
          }),
          CoordinatorEvents.emit({
            ...base,
            event_kind: "tool_call",
            payload: { sandboxDowngradeReason: "native readiness missing", readiness: "acl_apply_required" },
          }),
        ],
        { concurrency: 6 },
      ),
    )

    const report = CoordinatorDebugStats.stats(2_000, ts + 1_000)
    const taskRate = report.task_success_rate.find(
      (item) => item.workflow === "telemetry-workflow" && item.expert_id === "expert_alpha",
    )
    const reviseDepth = report.revise_loop_depth.find((item) => item.workflow === "telemetry-workflow")
    const continuation = report.continuation_outcome.find((item) => item.reason === "progress gate")
    const budget = report.budget_efficiency.find(
      (item) => item.workflow === "telemetry-workflow" && item.effort === "deep",
    )
    const downgrade = report.sandbox_downgrade_count.find((item) => item.reason === "native readiness missing")
    const readiness = report.native_sandbox_readiness.find((item) => item.readiness === "acl_apply_required")

    expect(taskRate?.total).toBe(2)
    expect(taskRate?.success_rate).toBe(0.75)
    expect(reviseDepth?.p50).toBe(3)
    expect(reviseDepth?.p95).toBe(3)
    expect(continuation?.progress_rate).toBe(1)
    expect(budget?.samples).toBe(1)
    expect(budget?.efficiency).toBe(0.25)
    expect(downgrade?.total).toBe(1)
    expect(readiness?.total).toBe(1)
  })

  test("exports redacted JSONL traces for a session", async () => {
    const ts = 4_000_000_010_000
    await Effect.runPromise(
      CoordinatorEvents.emit({
        session_id: "ses_trace_test",
        run_id: "run_trace_test",
        task_id: "task_trace_test",
        expert_id: "expert_trace",
        workflow: "coding",
        effort: "high",
        ts,
        event_kind: "tool_call",
        payload: {
          command: "curl -H \"Authorization: Bearer secret-token\" https://example.test",
          nested: {
            OPENAGT_AUTH_CONTENT: "{\"openai\":{\"key\":\"sk-test-secret\"}}",
            safe: "keep this",
          },
        },
      }),
    )

    const jsonl = CoordinatorTraceExport.exportTraceJsonl({
      sessionID: "ses_trace_test",
      now: ts + 1,
    })
    const lines = jsonl.trim().split("\n")
    const parsed = JSON.parse(lines[0]!)

    expect(lines).toHaveLength(1)
    expect(parsed.schema_version).toBe(1)
    expect(parsed.event.session_id).toBe("ses_trace_test")
    expect(parsed.event.payload.command).toContain("Bearer [redacted]")
    expect(parsed.event.payload.nested.OPENAGT_AUTH_CONTENT).toBe("[redacted:OPENAGT_AUTH_CONTENT]")
    expect(parsed.event.payload.nested.safe).toBe("keep this")
  })
})
