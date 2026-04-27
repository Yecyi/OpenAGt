import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Coordinator } from "../../src/coordinator/coordinator"
import { ExpertRegistry } from "../../src/coordinator/expert-registry"
import { shouldUseDegradedMpacr } from "../../src/coordinator/coordinator"
import { buildDebate, buildDegraded, computeQuorum } from "../../src/coordinator/mpacr"
import { skippedVerdict } from "../../src/coordinator/mpacr-validation"
import { Config } from "../../src/config"
import { CoordinatorNode, EffortProfile } from "../../src/coordinator/schema"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { PersonalAgent } from "../../src/personal/personal"
import { ThreeLayerMemory } from "../../src/personal/three-layer"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { TaskRuntime } from "../../src/session/task-runtime"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const coordinatorLayer = Layer.mergeAll(
  Bus.layer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Session.defaultLayer,
  TaskRuntime.defaultLayer,
  Coordinator.defaultLayer,
  PersonalAgent.defaultLayer,
  ThreeLayerMemory.defaultLayer,
  ExpertRegistry.defaultLayer,
).pipe(Layer.provide(ThreeLayerMemory.defaultLayer), Layer.provide(ExpertRegistry.defaultLayer))

const it = testEffect(coordinatorLayer)

function sessionPromptLayer(prompt: SessionPrompt.Interface["prompt"]) {
  return Layer.succeed(
    SessionPrompt.Service,
    SessionPrompt.Service.of({
      cancel: () => Effect.void,
      prompt,
      loop: () => Effect.die(new Error("not used")),
      shell: () => Effect.die(new Error("not used")),
      command: () => Effect.die(new Error("not used")),
      resolvePromptParts: () => Effect.succeed([]),
    }),
  )
}

const promptFailureIt = testEffect(
  Layer.mergeAll(coordinatorLayer, sessionPromptLayer(() => Effect.die(new Error("critic exploded")))),
)
const promptTimeoutIt = testEffect(Layer.mergeAll(coordinatorLayer, sessionPromptLayer(() => Effect.never)))

function mpacrCriticNode(input: { id: string; timeoutMs?: number }) {
  return {
    id: input.id,
    description: "MPACR critic",
    prompt: "Critique the artifact.",
    task_kind: "verify" as const,
    subagent_type: "general",
    role: "red-team-critic" as const,
    risk: "low" as const,
    depends_on: [],
    write_scope: [],
    read_scope: ["src"],
    acceptance_checks: ["Critic verdict recorded"],
    output_schema: "revise" as const,
    requires_user_input: false,
    priority: "normal" as const,
    origin: "coordinator" as const,
    mpacr_role: "critic" as const,
    mpacr_per_critic_timeout_ms: input.timeoutMs ?? 180_000,
  }
}

function waitForNodeStatus(input: {
  tasks: TaskRuntime.Interface
  parentSessionID: Session.Info["id"]
  nodeID: string
  status: TaskRuntime.TaskStatus
}) {
  return Effect.gen(function* () {
    for (const _ of Array.from({ length: 40 })) {
      const record = (yield* input.tasks.list(input.parentSessionID)).find(
        (item) => item.metadata?.coordinator_node_id === input.nodeID,
      )
      if (record?.status === input.status) return record
      yield* Effect.sleep("20 millis")
    }
    throw new Error(`Timed out waiting for ${input.nodeID} to become ${input.status}`)
  })
}

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

  test("budget-constrained MPACR switches to degraded graph", () => {
    expect(shouldUseDegradedMpacr(profile(3), { budget: "small" })).toBe(true)
    expect(shouldUseDegradedMpacr(profile(3), { maxSubagents: 6 })).toBe(true)
    expect(shouldUseDegradedMpacr(profile(3), { budget: "normal", maxSubagents: 7 })).toBe(false)
  })

  test("critic and synthesis nodes carry runtime quorum metadata", () => {
    const out = buildDebate({
      idPrefix: "x",
      target: fakeTarget(),
      goal: "g",
      workflow: "coding",
      effort: "high",
      profile: profile(3),
      dependsOn: [],
    })
    expect(out.critics[0]?.mpacr_role).toBe("critic")
    expect(out.critics[0]?.mpacr_per_critic_timeout_ms).toBe(180_000)
    expect(out.synthesis.mpacr_quorum).toBe(2)
    expect(out.synthesis.mpacr_critic_node_ids).toEqual(out.critics.map((item) => item.id))
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

describe("MPACR skipped critic runtime contract", () => {
  it.live("coordinator completes MPACR critic as skipped when executor is unavailable", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const coordinator = yield* Coordinator.Service
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "MPACR unavailable executor parent" })

        yield* coordinator.run({
          sessionID: parent.id,
          goal: "Review partial failure behavior",
          mode: "autonomous",
          approved: true,
          effort: "low",
          nodes: [mpacrCriticNode({ id: "critic_unavailable" })],
        })

        const completed = yield* waitForNodeStatus({
          tasks,
          parentSessionID: parent.id,
          nodeID: "critic_unavailable",
          status: "completed",
        })

        expect(completed.metadata?.mpacr_skipped).toBe(true)
        expect(completed.metadata?.mpacr_skip_reason).toContain("SessionPrompt.Service is not available")
        expect(completed.metadata?.result_text).toContain('"verdict":"skipped"')
      }),
    ),
  )

  promptFailureIt.live("coordinator converts MPACR critic prompt errors into skipped verdicts", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const coordinator = yield* Coordinator.Service
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "MPACR prompt failure parent" })

        yield* coordinator.run({
          sessionID: parent.id,
          goal: "Review prompt failure behavior",
          mode: "autonomous",
          approved: true,
          effort: "low",
          nodes: [mpacrCriticNode({ id: "critic_failure" })],
        })

        const completed = yield* waitForNodeStatus({
          tasks,
          parentSessionID: parent.id,
          nodeID: "critic_failure",
          status: "completed",
        })

        expect(completed.metadata?.mpacr_skipped).toBe(true)
        expect(completed.metadata?.mpacr_skip_reason).toBe("critic exploded")
        expect(completed.error_summary).toBeUndefined()
      }),
    ),
  )

  promptTimeoutIt.live("coordinator converts MPACR critic prompt timeouts into skipped verdicts", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const coordinator = yield* Coordinator.Service
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "MPACR prompt timeout parent" })

        yield* coordinator.run({
          sessionID: parent.id,
          goal: "Review timeout behavior",
          mode: "autonomous",
          approved: true,
          effort: "low",
          nodes: [mpacrCriticNode({ id: "critic_timeout", timeoutMs: 5 })],
        })

        const completed = yield* waitForNodeStatus({
          tasks,
          parentSessionID: parent.id,
          nodeID: "critic_timeout",
          status: "completed",
        })

        expect(completed.metadata?.mpacr_skipped).toBe(true)
        expect(completed.metadata?.mpacr_skip_reason).toBe("MPACR critic timed out after 5ms")
        expect(completed.error_summary).toBeUndefined()
      }),
    ),
  )

  it.live("synthetic skipped critic completion unblocks defender dependencies", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "MPACR skipped critic parent" })
        const steel = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_mpacr_steel" as never,
          taskKind: "verify",
          subagentType: "general",
          description: "steel",
          prompt: "steel",
          dependsOn: [],
        })
        const critic = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_mpacr_critic" as never,
          taskKind: "verify",
          subagentType: "general",
          description: "critic",
          prompt: "critic",
          dependsOn: [steel.task_id],
          metadata: { output_schema: "revise", role: "red-team-critic", mpacr_role: "critic" },
        })
        const defender = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_mpacr_defender" as never,
          taskKind: "verify",
          subagentType: "general",
          description: "defender",
          prompt: "defender",
          dependsOn: [steel.task_id, critic.task_id],
        })

        yield* tasks.complete({ taskID: steel.task_id, parentSessionID: parent.id, output: "steel complete" })
        expect(yield* tasks.canRun({ parentSessionID: parent.id, task: defender })).toBe(false)
        yield* tasks.complete({
          taskID: critic.task_id,
          parentSessionID: parent.id,
          output: JSON.stringify(skippedVerdict("critic timed out")),
          metadata: { mpacr_skipped: true, mpacr_skip_reason: "critic timed out" },
        })
        const completed = yield* tasks.get({ taskID: critic.task_id, parentSessionID: parent.id })

        expect(yield* tasks.canRun({ parentSessionID: parent.id, task: defender })).toBe(true)
        expect(completed._tag === "Some" ? completed.value.metadata?.mpacr_skipped : undefined).toBe(true)
      }),
    ),
  )
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
