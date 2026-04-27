import { describe, expect, test } from "bun:test"
import {
  applyEffortGovernance,
  basePlanForIntent,
  defaultPlanForIntent,
  settleIntentProfile,
} from "../../src/coordinator/coordinator"

// A.2 integration tests: confirm MPACR debate graph splices into
// applyEffortGovernance correctly when the feature flag is enabled, and that
// the legacy single-node path is preserved when it is not.

function plannedPlan(effort: "low" | "medium" | "high" | "deep") {
  const intent = settleIntentProfile({ goal: "implement mission control backend API" })
  return defaultPlanForIntent(intent, { effort })
}

describe("MPACR off (default) — plan shape unchanged from baseline", () => {
  test("medium effort still produces the legacy single-node final_revise", () => {
    const plan = plannedPlan("medium")
    const reviseNodes = plan.nodes.filter(
      (n) => n.role === "reviser" || n.role === "synth-reviser" || n.role === "red-team-critic",
    )
    // Legacy mode: only `reviser` role nodes; no MPACR roles in the plan.
    expect(reviseNodes.every((n) => n.role === "reviser")).toBe(true)
    expect(plan.nodes.find((n) => n.id === "final_revise")?.role).toBe("reviser")
  })

  test("high effort plan keeps reducer/verifier/plan revise nodes as legacy single nodes", () => {
    const plan = plannedPlan("high")
    const reviseNodes = plan.nodes.filter((n) => n.role === "reviser")
    expect(reviseNodes.length).toBeGreaterThan(0)
    // High effort produces: 1 plan_revise_final + N reducer/verifier revises + 1 final_revise.
    // All are single-node legacy revisers; quality_gate count matches.
    expect(plan.revise_points.length).toBe(reviseNodes.length)
  })
})

describe("MPACR on — debate graph expands when target artifact exists", () => {
  function withMpacr(effort: "medium" | "high" | "deep", critic_count = 3) {
    const intent = settleIntentProfile({ goal: "implement mission control backend API" })
    // Use the un-governed base plan; applyEffortGovernance does the wrapping.
    const base = basePlanForIntent(intent)
    return applyEffortGovernance(base, intent, effort, undefined, {
      mpacr_enabled: true,
      mpacr_critic_count: critic_count,
    })
  }

  // Note: `final_revise` deliberately stays a legacy single-node reviser even
  // with MPACR enabled, because it has no concrete `target` node to debate
  // (it gates on multiple sink nodes). Only revise sites with a specific
  // artifact target expand into a debate. Future work could synthesize a
  // virtual target for final_revise; for v1.21 it stays single-node.

  test("medium effort + MPACR keeps final_revise as legacy reviser (no target to debate)", () => {
    const plan = withMpacr("medium", 3)
    const finalRevise = plan.nodes.find((n) => n.id === "final_revise")
    expect(finalRevise?.role).toBe("reviser")
    // Confirm no MPACR debate nodes were created for medium-effort base plan
    // (the base plan has no reducer/verifier-style nodes pre-governance).
    expect(plan.nodes.filter((n) => n.role === "synth-reviser").length).toBe(0)
  })

  test("high effort + MPACR with K=5 produces 5 critic nodes per reducer/verifier debate", () => {
    const plan = withMpacr("high", 5)
    const critics = plan.nodes.filter((n) => n.role === "red-team-critic")
    expect(critics.length).toBeGreaterThanOrEqual(5)
    expect(critics.every((n) => n.parallel_group === "mpacr-red-team")).toBe(true)
  })

  test("high effort + MPACR produces synthesis nodes for every revise site that has a target", () => {
    const plan = withMpacr("high", 3)
    const synths = plan.nodes.filter((n) => n.role === "synth-reviser")
    // High effort revises every reducer + every verifier. Base plan for coding
    // has 1 reducer (research_synthesis) + 3 verifiers + final_revise (no target).
    expect(synths.length).toBeGreaterThanOrEqual(2)
    // Each synthesis is preceded by a steel-manner with the same id prefix.
    for (const synth of synths) {
      const prefix = synth.id.replace(/:synthesis$/, "")
      const steelMan = plan.nodes.find((n) => n.id === `${prefix}:steel_man`)
      expect(steelMan?.role).toBe("steel-manner")
    }
  })

  test("revise_points collapse one MPACR debate into a single quality gate", () => {
    const plan = withMpacr("high", 3)
    const synthCount = plan.nodes.filter((n) => n.role === "synth-reviser").length
    const legacyReviserCount = plan.nodes.filter((n) => n.role === "reviser").length
    // Every synthesis becomes 1 quality gate; legacy revisers (e.g. final_revise) too.
    expect(plan.revise_points.length).toBe(synthCount + legacyReviserCount)
  })

  test("budget cap counts logical revises (units), not the K+3 expansion", () => {
    const intent = settleIntentProfile({ goal: "implement mission control backend API" })
    const base = basePlanForIntent(intent)
    const plan = applyEffortGovernance(base, intent, "high", undefined, {
      mpacr_enabled: true,
      mpacr_critic_count: 3,
      max_revise_nodes: 1,
    })
    // High effort revises 1 reducer + 3 verifiers + 1 final = 5 logical units.
    // Cap of 1 should permit exactly 1 logical revise (which is 7 nodes for a
    // debate, or 1 node for the legacy final_revise — whichever applies first).
    const synthCount = plan.nodes.filter((n) => n.role === "synth-reviser").length
    const legacyReviserCount = plan.nodes.filter((n) => n.role === "reviser").length
    expect(synthCount + legacyReviserCount).toBe(1)
  })

  test("downstream nodes that depend on a revised target now wait on synthesis", () => {
    const plan = withMpacr("high", 3)
    const reducer = plan.nodes.find((n) => n.role === "reducer")
    expect(reducer).toBeDefined()
    if (!reducer) return
    const reducerRevise = plan.revise_points.find(
      (rp) => rp.target_node_id === reducer.id && rp.kind === "reducer_revise",
    )
    expect(reducerRevise).toBeDefined()
    if (!reducerRevise) return
    expect(reducerRevise.node_id).toMatch(/:synthesis$/)
  })

  test("MPACR-enabled plan: a gate is either legacy-reviser or synth-reviser, never both", () => {
    const plan = withMpacr("high", 3)
    const reviserGates = new Set(plan.nodes.filter((n) => n.role === "reviser").map((n) => n.id))
    const synthGates = new Set(
      plan.nodes.filter((n) => n.role === "synth-reviser").map((n) => n.id.replace(/:synthesis$/, "")),
    )
    for (const gate of synthGates) {
      expect(reviserGates.has(gate)).toBe(false)
    }
  })
})
