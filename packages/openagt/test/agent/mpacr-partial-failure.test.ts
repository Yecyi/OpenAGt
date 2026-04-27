import { describe, expect, test } from "bun:test"
import { buildDebate, buildDegraded, computeQuorum } from "../../src/coordinator/mpacr"
import { skippedVerdict } from "../../src/coordinator/mpacr-validation"
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

describe("computeQuorum", () => {
  test("K=1 → quorum=1 (no tolerance)", () => {
    expect(computeQuorum(1)).toBe(1)
  })
  test("K=2 → quorum=2 (must have both — small samples can't tolerate loss)", () => {
    expect(computeQuorum(2)).toBe(2)
  })
  test("K=3 → quorum=2 (60% of 3 = 1.8, ceil = 2)", () => {
    expect(computeQuorum(3)).toBe(2)
  })
  test("K=5 → quorum=3 (60% of 5 = 3)", () => {
    expect(computeQuorum(5)).toBe(3)
  })
  test("K=6 → quorum=4 (60% of 6 = 3.6, ceil = 4)", () => {
    expect(computeQuorum(6)).toBe(4)
  })
  test("K=0 still yields quorum=1 (caller error guard)", () => {
    expect(computeQuorum(0)).toBe(1)
  })
})

describe("MPACR debate carries quorum metadata", () => {
  test("buildDebate exposes quorum on the output and wires it into synthesis prompt", () => {
    const out = buildDebate({
      idPrefix: "review_implement",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "high",
      profile: profile(3),
      dependsOn: [],
    })
    expect(out.quorum).toBe(2)
    expect(out.synthesis.prompt).toContain("Quorum required: 2")
    expect(out.synthesis.prompt).toContain("verdict: \"skipped\"")
  })

  test("buildDegraded fixes quorum at 1 (lone critic must produce)", () => {
    const out = buildDegraded({
      idPrefix: "x",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "high",
      profile: profile(3),
      dependsOn: [],
    })
    expect(out.quorum).toBe(1)
    expect(out.synthesis.prompt).toContain("Quorum required: 1")
  })

  test("synthesis acceptance checks include the quorum value for traceability", () => {
    const out = buildDebate({
      idPrefix: "x",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "deep",
      profile: profile(5),
      dependsOn: [],
    })
    expect(out.quorum).toBe(3)
    expect(out.synthesis.acceptance_checks).toContain("Skipped critics handled (quorum=3)")
  })
})

describe("Synthesis prompt instructs the model to handle skipped verdicts", () => {
  test("explicitly tells the model not to count skipped critics against the artifact", () => {
    const out = buildDebate({
      idPrefix: "x",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "high",
      profile: profile(3),
      dependsOn: [],
    })
    expect(out.synthesis.prompt).toContain("do NOT count them against the artifact")
  })

  test("falls back to ask_user when too few critics returned valid output", () => {
    const out = buildDebate({
      idPrefix: "x",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "high",
      profile: profile(3),
      dependsOn: [],
    })
    expect(out.synthesis.prompt).toContain("ask_user")
    expect(out.synthesis.prompt).toContain("missing perspectives")
  })
})

describe("skippedVerdict round-trip integration", () => {
  test("skipped verdicts carry the skip reason in unsupported_claims", () => {
    const skipped = skippedVerdict("critic timed out at 180s")
    expect(skipped.verdict).toBe("skipped")
    expect(skipped.unsupported_claims).toContain("critic timed out at 180s")
    expect(skipped.confidence).toBe("low")
  })

  test("synthesis can identify skipped critics by checking verdict === 'skipped'", () => {
    // The contract: when task-runtime injects a synthetic verdict for a
    // failed/timeout critic, it uses skippedVerdict(). Synthesis then iterates
    // verdicts and counts non-"skipped" entries to compare against quorum.
    const verdicts = [
      skippedVerdict("timeout"),
      skippedVerdict("error: model returned 500"),
      // Plus one real verdict somewhere downstream
    ]
    const skippedCount = verdicts.filter((v) => v.verdict === "skipped").length
    expect(skippedCount).toBe(2)
  })
})
