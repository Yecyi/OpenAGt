import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { TaskRuntime } from "../../src/session/task-runtime"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Session.defaultLayer, TaskRuntime.defaultLayer),
)

describe("task runtime agentic scheduling", () => {
  it.live("allows implement tasks with distinct write_scope to run in parallel", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "Agentic task runtime" })
        const first = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_scope_a" as never,
          taskKind: "implement",
          subagentType: "general",
          description: "first implement",
          prompt: "update src/a.ts",
          dependsOn: [],
          writeScope: ["src/a.ts"],
        })
        yield* tasks.setRunning(first.task_id, parent.id)
        const second = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_scope_b" as never,
          taskKind: "implement",
          subagentType: "general",
          description: "second implement",
          prompt: "update src/b.ts",
          dependsOn: [],
          writeScope: ["src/b.ts"],
        })

        expect(
          yield* tasks.canRun({
            parentSessionID: parent.id,
            task: second,
          }),
        ).toBe(true)
      }),
    ),
  )

  it.live("starts a pending task only once", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const tasks = yield* TaskRuntime.Service
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ title: "Atomic task parent" })
        const task = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_atomic_start" as never,
          taskKind: "research",
          subagentType: "general",
          description: "atomic start",
          prompt: "start once",
          dependsOn: [],
        })

        const [first, second] = yield* Effect.all(
          [tasks.tryStartPending(task.task_id, parent.id), tasks.tryStartPending(task.task_id, parent.id)],
          { concurrency: "unbounded" },
        )

        expect([first, second].filter(Boolean)).toHaveLength(1)
        expect((yield* tasks.list(parent.id)).find((item) => item.task_id === task.task_id)?.status).toBe("running")
      }),
    ),
  )

  it.live("allows verify tasks to run beside implement tasks when read_scope does not overlap", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "Agentic verify runtime" })
        const implement = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_verify_impl" as never,
          taskKind: "implement",
          subagentType: "general",
          description: "implement task",
          prompt: "change src/a.ts",
          dependsOn: [],
          writeScope: ["src/a.ts"],
        })
        yield* tasks.setRunning(implement.task_id, parent.id)
        const verify = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_verify_reader" as never,
          taskKind: "verify",
          subagentType: "general",
          description: "verify task",
          prompt: "check src/b.ts",
          dependsOn: [],
          readScope: ["src/b.ts"],
        })

        expect(
          yield* tasks.canRun({
            parentSessionID: parent.id,
            task: verify,
          }),
        ).toBe(true)
      }),
    ),
  )

  it.live("serializes verify tasks with overlapping read_scope", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "Verify scope runtime" })
        const first = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_verify_a" as never,
          taskKind: "verify",
          subagentType: "general",
          description: "first verify",
          prompt: "check tests",
          dependsOn: [],
          readScope: ["test"],
        })
        yield* tasks.setRunning(first.task_id, parent.id)
        const second = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_verify_b" as never,
          taskKind: "verify",
          subagentType: "general",
          description: "second verify",
          prompt: "check focused tests",
          dependsOn: [],
          readScope: ["test/focused"],
        })

        expect(yield* tasks.canRun({ parentSessionID: parent.id, task: second })).toBe(false)
      }),
    ),
  )

  // Regression for April 2026-04 finding 4.7 — canRun used to call
  // list() unconditionally, so a sweep of K ready tasks paid O(K*N)
  // storage reads where N is total tasks ever created in the session.
  // The dispatch loop now passes its pre-fetched allTasks snapshot in.
  // This test pins the new contract: when `tasks` is provided, the
  // snapshot is the source of truth and the storage list is bypassed.
  it.live("canRun honors a pre-fetched tasks snapshot for the dispatch sweep fast path", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "canRun snapshot fast path" })
        const upstream = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_canrun_upstream" as never,
          taskKind: "research",
          subagentType: "general",
          description: "upstream",
          prompt: "research",
          dependsOn: [],
        })
        yield* tasks.setRunning(upstream.task_id, parent.id)
        yield* tasks.complete({ taskID: upstream.task_id, parentSessionID: parent.id })
        const downstream = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_canrun_downstream" as never,
          taskKind: "research",
          subagentType: "general",
          description: "downstream",
          prompt: "use upstream",
          dependsOn: [upstream.task_id],
        })

        // Default path: canRun calls list internally and sees the completed
        // upstream dep. Backward compatibility for single-task callers.
        expect(yield* tasks.canRun({ parentSessionID: parent.id, task: downstream })).toBe(true)

        // Snapshot path: an empty snapshot hides the upstream dep entirely,
        // so the dependency check fails even though storage has the dep.
        // This proves the snapshot parameter actually short-circuits list().
        expect(yield* tasks.canRun({ parentSessionID: parent.id, task: downstream, tasks: [] })).toBe(false)

        // Snapshot path with the real list passed in: matches default path.
        const snapshot = yield* tasks.list(parent.id)
        expect(yield* tasks.canRun({ parentSessionID: parent.id, task: downstream, tasks: snapshot })).toBe(true)
      }),
    ),
  )

  it.live("does not double-count Anthropic cache tokens in task usage", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "Token accounting runtime" })
        const task = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_token_task" as never,
          taskKind: "research",
          subagentType: "general",
          description: "token task",
          prompt: "count tokens",
          dependsOn: [],
        })
        const messageID = MessageID.ascending()
        const result: MessageV2.WithParts = {
          info: {
            id: messageID,
            role: "assistant",
            parentID: MessageID.ascending(),
            sessionID: task.child_session_id,
            mode: "general",
            agent: "general",
            cost: 0,
            path: { cwd: "/tmp", root: "/tmp" },
            tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 1000, write: 500 } },
            modelID: ModelID.make("claude-test"),
            providerID: ProviderID.make("anthropic"),
            time: { created: Date.now() },
            finish: "stop",
          },
          parts: [
            {
              id: PartID.ascending(),
              messageID,
              sessionID: task.child_session_id,
              type: "text",
              text: "done",
            },
          ],
        }

        yield* tasks.complete({ taskID: task.task_id, parentSessionID: parent.id, result })

        expect((yield* tasks.list(parent.id)).find((item) => item.task_id === task.task_id)?.usage?.totalTokens).toBe(
          160,
        )
      }),
    ),
  )

  it.live("persists terminal task outcomes and links retry attempts", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "Task outcome runtime" })
        const task = yield* tasks.create({
          parentSessionID: parent.id,
          childSessionID: "ses_outcome_chain" as never,
          taskKind: "research",
          subagentType: "general",
          description: "outcome task",
          prompt: "gather evidence",
          dependsOn: [],
          acceptanceChecks: ["architecture", "algorithms"],
        })

        yield* tasks.partial({
          taskID: task.task_id,
          parentSessionID: parent.id,
          output: "partial architecture notes",
          reason: "step_budget",
          remainingScope: ["algorithms"],
        })

        const first = yield* tasks.latestOutcome({ taskID: task.task_id, parentSessionID: parent.id })
        expect(Option.isSome(first)).toBe(true)
        if (Option.isNone(first)) throw new Error("Missing first task outcome")
        expect(first.value.status).toBe("partial")
        expect(first.value.attempt_no).toBe(1)
        expect(first.value.retryable).toBe(1)
        expect(first.value.limit_reason).toBe("step_budget")
        expect(first.value.result_text).toBe("partial architecture notes")

        yield* tasks.retry({ taskID: task.task_id, parentSessionID: parent.id })
        yield* tasks.complete({
          taskID: task.task_id,
          parentSessionID: parent.id,
          output: "complete architecture and algorithm outline",
        })

        const latest = yield* tasks.latestOutcome({ taskID: task.task_id, parentSessionID: parent.id })
        const history = yield* tasks.listOutcomes({ parentSessionID: parent.id, taskID: task.task_id })

        expect(Option.isSome(latest)).toBe(true)
        if (Option.isNone(latest)) throw new Error("Missing latest task outcome")
        expect(latest.value.status).toBe("completed")
        expect(latest.value.attempt_no).toBe(2)
        expect(latest.value.previous_outcome_id).toBe(first.value.id)
        expect(latest.value.result_text).toBe("complete architecture and algorithm outline")
        expect(history.map((item) => item.status)).toEqual(["completed", "partial"])
      }),
    ),
  )
})
