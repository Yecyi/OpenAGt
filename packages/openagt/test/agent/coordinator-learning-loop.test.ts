import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config"
import { Coordinator } from "../../src/coordinator/coordinator"
import {
  failureSignature,
  hammingDistance64,
  normalizeFailureText,
} from "../../src/coordinator/failure-signature"
import { ExpertRegistry } from "../../src/coordinator/expert-registry"
import { historyForOutcomeRows } from "../../src/coordinator/prompt-templates"
import {
  deterministicChecksForNode,
  missingDeterministicSignals,
} from "../../src/coordinator/verifier-checks"
import { aggregateVerifierSignals, verifierSignalsFromMessages } from "../../src/coordinator/verifier-aggregator"
import { node } from "../../src/coordinator/plan-node-factory"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { PersonalAgent } from "../../src/personal/personal"
import { ThreeLayerMemory } from "../../src/personal/three-layer"
import { Session } from "../../src/session"
import type { MessageV2 } from "../../src/session/message-v2"
import { TaskRuntime } from "../../src/session/task-runtime"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Bus.layer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    TaskRuntime.defaultLayer,
    Coordinator.defaultLayer,
    PersonalAgent.defaultLayer,
    ThreeLayerMemory.defaultLayer,
    ExpertRegistry.defaultLayer,
  ).pipe(Layer.provide(ThreeLayerMemory.defaultLayer), Layer.provide(ExpertRegistry.defaultLayer)),
)

describe("coordinator learning loop", () => {
  test("failure signatures are stable across small wording changes", () => {
    const first = failureSignature({
      verdict: "revise",
      text: "Typecheck failed because foo_id is possibly undefined in coordinator.ts line 42",
      requiredChanges: ["guard foo_id before use"],
    })
    const second = failureSignature({
      verdict: "revise",
      text: "Typecheck failed because bar_id is possibly undefined in coordinator.ts line 99",
      requiredChanges: ["guard bar_id before use"],
    })

    expect(normalizeFailureText("Line 42: Token ABCDEF1234567890")).not.toContain("42")
    expect(first).toHaveLength(16)
    expect(hammingDistance64(first, second)).toBeLessThan(24)
  })

  test("prompt outcome history can be scoped by expert", () => {
    const history = historyForOutcomeRows(
      [
        { variant: "strict", success: 1, expert_id: "coding.verifier" },
        { variant: "strict", success: 0, expert_id: "research.verifier" },
        { variant: "brief", success: 1, expert_id: "research.verifier" },
        { variant: "shared", success: 1, expert_id: null },
      ],
      "coding.verifier",
    )

    expect(history.get("strict")).toEqual({ success: 1, failure: 0 })
    expect(history.get("brief")).toBeUndefined()
    expect(history.get("shared")).toEqual({ success: 1, failure: 0 })
  })

  test("verifier aggregation is pessimistic for ground-truth hard failures", () => {
    const verdict = aggregateVerifierSignals([
      {
        source: "llm_critic",
        status: "pass",
        summary: "LLM reviewer found no issue",
      },
      {
        source: "typecheck",
        status: "hard_fail",
        summary: "Typecheck failed in changed package",
      },
      {
        source: "lsp_diagnostics",
        status: "warning",
        summary: "Diagnostic stream timed out after partial results",
      },
    ])

    expect(verdict.verdict).toBe("revise_required")
    expect(verdict.hard_fail_sources).toEqual(["typecheck"])
    expect(verdict.warning_sources).toEqual(["lsp_diagnostics"])
    expect(verdict.confidence).toBe("high")
  })

  test("verifier signals are extracted from typecheck and LSP tool evidence", () => {
    const messages = [
      {
        info: {
          id: "msg_1",
          role: "assistant",
          sessionID: "ses_1",
          path: { cwd: "/tmp", root: "/tmp" },
          system: [],
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
        },
        parts: [
          {
            id: "part_1",
            sessionID: "ses_1",
            messageID: "msg_1",
            type: "tool",
            callID: "call_1",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "bun typecheck" },
              title: "typecheck",
              output: "Type error",
              metadata: { exit: 1 },
              time: { start: 1, end: 2 },
            },
          },
          {
            id: "part_2",
            sessionID: "ses_1",
            messageID: "msg_1",
            type: "tool",
            callID: "call_2",
            tool: "apply_patch",
            state: {
              status: "completed",
              input: {},
              title: "patch",
              output: "updated",
              metadata: { diagnostics: { "a.ts": [{ severity: 2, message: "warning" }] } },
              time: { start: 3, end: 4 },
            },
          },
        ],
      },
    ] as unknown as MessageV2.WithParts[]
    const signals = verifierSignalsFromMessages(messages)
    const verdict = aggregateVerifierSignals(signals)

    expect(signals.map((item) => item.source)).toEqual(["typecheck", "lsp_diagnostics"])
    expect(verdict.verdict).toBe("revise_required")
    expect(verdict.hard_fail_sources).toEqual(["typecheck"])
    expect(verdict.warning_sources).toEqual(["lsp_diagnostics"])
  })

  test("deterministic verifier checks are derived from touched code scopes", () => {
    const implement = node({
      id: "implement",
      description: "Implement",
      prompt: "Implement",
      task_kind: "implement",
      subagent_type: "general",
      role: "implementer",
      depends_on: [],
      write_scope: ["packages/openagt/src/coordinator/foo.ts"],
      read_scope: [],
      acceptance_checks: ["implemented"],
      priority: "high",
      origin: "coordinator",
    })
    const verify = node({
      id: "verify_typecheck",
      description: "Verify",
      prompt: "Verify",
      task_kind: "verify",
      subagent_type: "general",
      role: "verifier",
      depends_on: ["implement"],
      write_scope: [],
      read_scope: [],
      acceptance_checks: ["typecheck passes"],
      priority: "high",
      origin: "coordinator",
      output_schema: "verification",
    })

    const checks = deterministicChecksForNode(verify, [implement, verify])
    const missing = missingDeterministicSignals(checks, [])
    const verdict = aggregateVerifierSignals(missing)

    expect(checks.some((item) => item.source === "typecheck" && item.workdir === "packages/openagt")).toBe(true)
    expect(checks.some((item) => item.source === "lsp_diagnostics")).toBe(true)
    expect(missing.map((item) => item.source)).toEqual(["typecheck"])
    expect(verdict.verdict).toBe("inconclusive")
    expect(verdict.confidence).toBe("low")
  })

  it.live("stores failed review verdicts as expert memory patterns", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const coordinator = yield* Coordinator.Service
        const personal = yield* PersonalAgent.Service
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "Learning loop parent" })
        yield* personal.listMemory({ projectID: parent.projectID })

        const run = yield* coordinator.run({
          sessionID: parent.id,
          goal: "Review learning loop memory",
          mode: "assisted",
          nodes: [
            {
              id: "research",
              description: "Gather evidence",
              prompt: "Gather evidence.",
              task_kind: "research",
              subagent_type: "explore",
              depends_on: [],
              write_scope: [],
              read_scope: ["src"],
              acceptance_checks: ["Evidence gathered"],
              priority: "high",
              origin: "coordinator",
            },
          ],
        })
        const records = yield* tasks.list(parent.id)
        const research = records.find((item) => item.metadata?.coordinator_node_id === "research")
        const finalRevise = records.find((item) => item.metadata?.coordinator_node_id === "final_revise")
        if (!research || !finalRevise) throw new Error("Expected research and final revise tasks")

        yield* tasks.complete({ taskID: research.task_id, parentSessionID: parent.id, output: "evidence gathered" })
        yield* tasks.complete({
          taskID: finalRevise.task_id,
          parentSessionID: parent.id,
          output: JSON.stringify({
            verdict: "revise",
            confidence: "high",
            missing_evidence: ["file reference for claim"],
            required_changes: ["add grounded file reference"],
            evidence_for: ["review found an unsupported claim"],
            evidence_against: ["no file citation present"],
          }),
        })

        const memory = yield* Effect.gen(function* () {
          for (const _ of Array.from({ length: 50 })) {
            const notes = yield* personal.listMemory({ projectID: parent.projectID })
            const found = notes.find((item) => item.tags.includes("failure-pattern"))
            if (found) return found
            yield* Effect.sleep("20 millis")
          }
          throw new Error("Timed out waiting for review pattern memory")
        })

        expect(run.task_ids.length).toBeGreaterThan(0)
        expect(memory.source).toBe("reviser")
        expect(memory.tags).toContain("failure-pattern")
        expect(memory.tags.some((tag) => tag.startsWith("failure_signature:"))).toBe(true)
        expect(memory.metadata.verdict).toBe("revise")
        expect(memory.content).toContain("Required changes: add grounded file reference")

        const nextRun = yield* coordinator.run({
          sessionID: parent.id,
          goal: "Review learning loop memory",
          mode: "assisted",
          nodes: [
            {
              id: "research_next",
              description: "Gather evidence again",
              prompt: "Gather evidence again.",
              task_kind: "research",
              subagent_type: "explore",
              depends_on: [],
              write_scope: [],
              read_scope: ["src"],
              acceptance_checks: ["Evidence gathered again"],
              priority: "high",
              origin: "coordinator",
            },
          ],
        })
        const nextFinalRevise = (yield* tasks.list(parent.id)).find(
          (item) =>
            item.group_id === nextRun.id && item.metadata?.coordinator_node_id === "final_revise",
        )
        const patterns = nextFinalRevise?.metadata?.review_memory_patterns

        expect(Array.isArray(patterns) ? patterns.length : 0).toBeGreaterThan(0)
      }),
    ),
  )
})
