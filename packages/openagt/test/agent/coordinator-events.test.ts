import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CoordinatorDebugStats } from "../../src/coordinator/debug-stats"
import { CoordinatorEvents } from "../../src/coordinator/events"

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

    expect(taskRate?.total).toBe(2)
    expect(taskRate?.success_rate).toBe(0.75)
    expect(reviseDepth?.p50).toBe(3)
    expect(reviseDepth?.p95).toBe(3)
    expect(continuation?.progress_rate).toBe(1)
    expect(budget?.samples).toBe(1)
    expect(budget?.efficiency).toBe(0.25)
  })
})
