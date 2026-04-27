import { describe, expect, test } from "bun:test"
import { effortProfileFor } from "../../src/coordinator/coordinator"

// Plan-shape snapshot for effortProfileFor.
// Locks the current behavior across the four effort levels.
// Future stream changes (MPACR/3LMA/DXR) must keep these baselines intact
// or update them deliberately as part of the change.
describe("effortProfileFor baseline (P0 plan-shape)", () => {
  test("low effort disables reviewer/reducer/debugger and uses minimal budgets", () => {
    const profile = effortProfileFor("low")
    expect(profile.planning_rounds).toBe(1)
    expect(profile.expert_count_min).toBe(1)
    expect(profile.expert_count_max).toBe(1)
    expect(profile.verifier_count_min).toBe(0)
    expect(profile.reducer_enabled).toBe(false)
    expect(profile.reviewer_enabled).toBe(false)
    expect(profile.debugger_enabled).toBe(false)
    expect(profile.revise_policy).toBe("none")
    expect(profile.max_revise_nodes).toBe(0)
    expect(profile.max_revision_per_artifact).toBe(0)
    expect(profile.reasoning_effort).toBe("low")
    expect(profile.timeout_multiplier).toBe(0.75)
  })

  test("medium effort enables reviewer with critical_only revise policy", () => {
    const profile = effortProfileFor("medium")
    expect(profile.planning_rounds).toBe(1)
    expect(profile.expert_count_min).toBe(1)
    expect(profile.expert_count_max).toBe(2)
    expect(profile.verifier_count_min).toBe(1)
    expect(profile.reducer_enabled).toBe(false)
    expect(profile.reviewer_enabled).toBe(true)
    expect(profile.debugger_enabled).toBe(false)
    expect(profile.revise_policy).toBe("critical_only")
    expect(profile.max_revise_nodes).toBe(1)
    expect(profile.max_revision_per_artifact).toBe(1)
    expect(profile.reasoning_effort).toBe("medium")
    expect(profile.timeout_multiplier).toBe(1)
  })

  test("high effort enables reducer + reviewer with broader expert range", () => {
    const profile = effortProfileFor("high")
    expect(profile.planning_rounds).toBe(2)
    expect(profile.expert_count_min).toBe(2)
    expect(profile.expert_count_max).toBe(4)
    expect(profile.verifier_count_min).toBe(1)
    expect(profile.reducer_enabled).toBe(true)
    expect(profile.reviewer_enabled).toBe(true)
    expect(profile.debugger_enabled).toBe(false)
    expect(profile.revise_policy).toBe("critical_only")
    expect(profile.max_revise_nodes).toBe(6)
    expect(profile.max_revision_per_artifact).toBe(1)
    expect(profile.reasoning_effort).toBe("high")
    expect(profile.timeout_multiplier).toBe(1.5)
  })

  test("deep effort enables debugger and all_artifacts revise policy", () => {
    const profile = effortProfileFor("deep")
    expect(profile.planning_rounds).toBe(3)
    expect(profile.expert_count_min).toBe(3)
    expect(profile.expert_count_max).toBe(6)
    expect(profile.verifier_count_min).toBe(2)
    expect(profile.reducer_enabled).toBe(true)
    expect(profile.reviewer_enabled).toBe(true)
    expect(profile.debugger_enabled).toBe(true)
    expect(profile.revise_policy).toBe("all_artifacts")
    expect(profile.max_revise_nodes).toBe(24)
    expect(profile.max_revision_per_artifact).toBe(2)
    expect(profile.reasoning_effort).toBe("high")
    expect(profile.timeout_multiplier).toBe(3)
  })
})
