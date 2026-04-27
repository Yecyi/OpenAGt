import { describe, expect, test } from "bun:test"
import { buildDebate, buildDegraded, CRITIC_PERSPECTIVES } from "../../src/coordinator/mpacr"
import { CoordinatorNode, EffortProfile } from "../../src/coordinator/schema"

function fakeTarget() {
  return CoordinatorNode.parse({
    id: "implement",
    description: "Implement the change",
    prompt: "Implement",
    task_kind: "implement",
    subagent_type: "general",
    role: "implementer",
    risk: "medium",
    depends_on: [],
    write_scope: ["packages/openagt/src/foo"],
    read_scope: ["packages/openagt/src"],
    acceptance_checks: ["Change applied"],
    output_schema: "implementation",
    requires_user_input: false,
    priority: "normal",
    origin: "coordinator",
  })
}

function profile(count: number) {
  return EffortProfile.parse({
    planning_rounds: 2,
    expert_count_min: 2,
    expert_count_max: 4,
    verifier_count_min: 1,
    reducer_enabled: true,
    reviewer_enabled: true,
    debugger_enabled: false,
    revise_policy: "critical_only",
    max_revise_nodes: 6,
    max_revision_per_artifact: 1,
    reasoning_effort: "high",
    timeout_multiplier: 1.5,
    mpacr_enabled: true,
    mpacr_critic_count: count,
  })
}

describe("MPACR debate graph shape", () => {
  test("K=3 produces 1 steel-man + 3 critics + 1 defender + 1 synthesis + 1 calibrator (= 7 nodes)", () => {
    const out = buildDebate({
      idPrefix: "review_implement",
      target: fakeTarget(),
      goal: "implement mission control backend",
      workflow: "coding",
      effort: "high",
      profile: profile(3),
      dependsOn: ["verify_acceptance"],
    })

    expect(out.all.length).toBe(7)
    expect(out.steelMan.role).toBe("steel-manner")
    expect(out.critics.length).toBe(3)
    out.critics.forEach((c) => {
      expect(c.role).toBe("red-team-critic")
      expect(c.parallel_group).toBe("mpacr-red-team")
    })
    expect(out.defender.role).toBe("defender")
    expect(out.synthesis.role).toBe("synth-reviser")
    expect(out.calibrator.role).toBe("calibrator")
  })

  test("Critics depend on steel-man only; defender depends on steel-man + all critics", () => {
    const out = buildDebate({
      idPrefix: "review_implement",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "high",
      profile: profile(3),
      dependsOn: [],
    })

    out.critics.forEach((c) => {
      expect(c.depends_on).toEqual([out.steelMan.id])
    })
    expect(out.defender.depends_on).toEqual([out.steelMan.id, ...out.critics.map((c) => c.id)])
    expect(out.synthesis.depends_on).toEqual([out.defender.id, ...out.critics.map((c) => c.id)])
    expect(out.calibrator.depends_on).toEqual([out.synthesis.id])
  })

  test("Steel-man inherits dependsOn from caller; downstream graph is internal", () => {
    const out = buildDebate({
      idPrefix: "review_implement",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "high",
      profile: profile(3),
      dependsOn: ["verify_typecheck", "verify_acceptance"],
    })

    expect(out.steelMan.depends_on).toEqual(["verify_typecheck", "verify_acceptance"])
  })

  test("K is clamped to [2, 6] and to the number of available perspectives", () => {
    const tooLow = buildDebate({
      idPrefix: "x",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "high",
      profile: profile(2),
      dependsOn: [],
    })
    expect(tooLow.critics.length).toBe(2)

    const tooHigh = buildDebate({
      idPrefix: "x",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "deep",
      profile: profile(6),
      dependsOn: [],
    })
    expect(tooHigh.critics.length).toBe(Math.min(6, CRITIC_PERSPECTIVES.length))
  })

  test("Critics' expert_role encodes the perspective for telemetry", () => {
    const out = buildDebate({
      idPrefix: "x",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "high",
      profile: profile(3),
      dependsOn: [],
    })

    const roles = out.critics.map((c) => c.expert_role)
    expect(roles).toEqual([
      "red-team-critic-factuality",
      "red-team-critic-coherence",
      "red-team-critic-risk",
    ])
  })

  test("Memory namespaces are scoped per perspective so critic memories do not pollute each other", () => {
    const out = buildDebate({
      idPrefix: "x",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "high",
      profile: profile(3),
      dependsOn: [],
    })

    const namespaces = out.critics.map((c) => c.memory_namespace)
    expect(namespaces).toEqual([
      "coding:red-team:factuality",
      "coding:red-team:coherence",
      "coding:red-team:risk",
    ])
  })

  test("Synthesis node carries the artifact_id chain (revision_of points to target)", () => {
    const out = buildDebate({
      idPrefix: "x",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "high",
      profile: profile(3),
      dependsOn: [],
    })

    expect(out.synthesis.revision_of).toBe("implement:artifact")
    expect(out.synthesis.quality_gate_id).toBe(out.synthesis.id)
  })

  test("Degraded form (budget pressure): 1 steel-man + 1 critic + 1 defender + 1 synthesis (= 4 nodes)", () => {
    const out = buildDegraded({
      idPrefix: "x",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "high",
      profile: profile(3),
      dependsOn: [],
    })

    expect(out.all.length).toBe(4)
    expect(out.critics.length).toBe(1)
    // Calibrator points back to synthesis so callers still have a single
    // terminal node id when the degraded form is selected.
    expect(out.calibrator.id).toBe(out.synthesis.id)
  })
})
