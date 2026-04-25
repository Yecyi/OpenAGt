import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config"
import { Coordinator } from "../../src/coordinator/coordinator"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { PersonalAgent } from "../../src/personal/personal"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { TaskRuntime } from "../../src/session/task-runtime"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

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
  ),
)

describe("coordinator runtime", () => {
  it.live("orders DAG nodes, creates verify follow-up, and summarizes the run", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const coordinator = yield* Coordinator.Service
        const personal = yield* PersonalAgent.Service
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "Coordinator parent" })
        yield* personal.listMemory({ projectID: parent.projectID })
        const seen: string[] = []
        const unsub = yield* bus.subscribeAllCallback((event) => {
          if (event.type.startsWith("coordinator.")) seen.push(event.type)
        })

        const run = yield* coordinator.run({
          sessionID: parent.id,
          goal: "Ship runtime scheduling",
          nodes: [
            {
              id: "implement",
              description: "Apply runtime change",
              prompt: "Implement the runtime change.",
              task_kind: "implement",
              subagent_type: "general",
              depends_on: ["research"],
              write_scope: ["src/runtime.ts"],
              read_scope: [],
              acceptance_checks: ["Runtime change applied"],
              priority: "high",
              origin: "coordinator",
            },
            {
              id: "research",
              description: "Inspect runtime state",
              prompt: "Inspect the runtime first.",
              task_kind: "research",
              subagent_type: "explore",
              depends_on: [],
              write_scope: [],
              read_scope: ["src/runtime.ts"],
              acceptance_checks: ["Context gathered"],
              priority: "high",
              origin: "coordinator",
            },
          ],
        })

        expect(run.plan.nodes.map((item) => item.id)).toEqual(["research", "implement", "implement_verify"])

        const records = yield* tasks.list(parent.id)
        expect(records).toHaveLength(3)
        const research = records.find((item) => item.task_kind === "research")
        const implement = records.find((item) => item.task_kind === "implement")
        const verify = records.find((item) => item.task_kind === "verify")
        if (!research || !implement || !verify) throw new Error("Coordinator tasks were not created")

        expect(implement.depends_on).toEqual([research.task_id])
        expect(verify.depends_on).toEqual([implement.task_id])
        expect(verify.read_scope).toEqual(["src/runtime.ts"])

        yield* tasks.complete({
          taskID: research.task_id,
          parentSessionID: parent.id,
          output: "researched",
        })
        yield* tasks.setRunning(implement.task_id, parent.id)
        expect(
          yield* tasks.canRun({
            parentSessionID: parent.id,
            task: verify,
          }),
        ).toBe(false)

        yield* tasks.complete({
          taskID: implement.task_id,
          parentSessionID: parent.id,
          output: "implemented",
        })
        expect(
          yield* tasks.canRun({
            parentSessionID: parent.id,
            task: verify,
          }),
        ).toBe(true)

        yield* tasks.complete({
          taskID: verify.task_id,
          parentSessionID: parent.id,
          output: "verified",
        })

        const summary = yield* coordinator.summarize(run.id)
        const projection = yield* coordinator.projection(run.id)
        const resumeError = yield* Effect.flip(coordinator.resume(run.id))
        yield* Effect.sleep("10 millis")
        const memory = yield* personal.listMemory({ projectID: parent.projectID })

        expect(summary).toContain("3/3 completed")
        expect(resumeError.message).toContain("cannot be resumed from state: completed")
        expect(projection.counts.completed).toBe(3)
        expect(projection.tasks).toHaveLength(3)
        expect(memory.some((item) => item.tags.includes(`coordinator_run:${run.id}`))).toBe(true)
        expect(seen).toContain("coordinator.created")
        expect(seen).toContain("coordinator.completed")
        unsub()
      }),
    ),
  )

  it.live("requires approval for high-risk runs and retries failed coordinator tasks", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const coordinator = yield* Coordinator.Service
        const sessions = yield* Session.Service
        const tasks = yield* TaskRuntime.Service
        const parent = yield* sessions.create({ title: "Coordinator approval parent" })

        const run = yield* coordinator.run({
          sessionID: parent.id,
          goal: "automate production cleanup and delete stale credentials",
        })
        expect(run.state).toBe("awaiting_approval")

        const dispatchError = yield* Effect.flip(coordinator.dispatch(run.id))
        expect(dispatchError.message).toContain("cannot dispatch from state: awaiting_approval")

        const approved = yield* coordinator.approve(run.id)
        expect(approved.state).toBe("active")

        const first = (yield* tasks.list(parent.id)).find((item) => item.status === "pending")
        if (!first) throw new Error("Expected a pending coordinator task")

        yield* tasks.fail({
          taskID: first.task_id,
          parentSessionID: parent.id,
          error: "verification failed",
        })
        yield* coordinator.summarize(run.id)
        expect((yield* coordinator.projection(run.id)).run.state).toBe("failed")

        const retried = yield* coordinator.retry({
          id: run.id,
          taskID: first.task_id,
        })
        const retriedTask = (yield* coordinator.projection(run.id)).tasks.find((item) => item.task_id === first.task_id)

        expect(retried.state).toBe("active")
        expect(retriedTask?.status).toBe("pending")
      }),
    ),
  )

  it.live("projects parallel groups and respects max parallel dispatch slots", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const coordinator = yield* Coordinator.Service
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ title: "Coordinator parallel parent" })

        const run = yield* coordinator.run({
          sessionID: parent.id,
          goal: "implement parallel mission control planner",
          mode: "assisted",
          parallel_policy: {
            max_parallel_agents: 2,
          },
        })

        expect(run.state).toBe("awaiting_approval")
        expect(run.plan.nodes.filter((item) => item.parallel_group === "research")).toHaveLength(4)
        expect(run.plan.nodes.find((item) => item.id === "research_synthesis")?.depends_on).toEqual([
          "research_repo_structure",
          "research_domain",
          "research_tests",
          "research_risk",
        ])

        yield* coordinator.approve(run.id)
        const dispatched = yield* coordinator.dispatch(run.id)
        const projection = yield* coordinator.projection(run.id)
        const researchGroup = projection.groups.find((item) => item.id === "research")

        expect(dispatched.dispatched).toBeLessThanOrEqual(2)
        expect(researchGroup?.node_ids).toEqual([
          "research_repo_structure",
          "research_domain",
          "research_tests",
          "research_risk",
        ])
        expect(researchGroup?.merge_status).toBe("waiting")
      }),
    ),
  )

  it.live("cancels pending coordinator tasks from an approval gate", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const coordinator = yield* Coordinator.Service
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ title: "Coordinator cancel parent" })
        const run = yield* coordinator.run({
          sessionID: parent.id,
          goal: "delete production credentials",
        })
        const cancelled = yield* coordinator.cancel(run.id)
        const projection = yield* coordinator.projection(run.id)

        expect(cancelled.state).toBe("cancelled")
        expect(projection.counts.cancelled).toBe(run.task_ids.length)
      }),
    ),
  )
})

describe("personal agent core", () => {
  it.live("uses memory ranking and normalizes inbox work items from multiple sources", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const personal = yield* PersonalAgent.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "Personal agent parent" })
        const projectID = Instance.project.id
        const seen: string[] = []
        const unsub = yield* bus.subscribeAllCallback((event) => {
          if (
            event.type === "memory.updated" ||
            event.type === "inbox.created" ||
            event.type === "scheduler.scheduled" ||
            event.type === "scheduler.fired"
          ) {
            seen.push(event.type)
          }
        })

        yield* personal.synthesize({
          kind: "manual_preference",
          title: "Preference",
          content: "Prefer lint verify summaries",
        })
        const workspace = yield* personal.remember({
          scope: "workspace",
          projectID,
          title: "Workspace rule",
          content: "Run lint before verify and summarize the result",
          source: "manual",
          importance: 8,
          pinned: true,
        })

        const search = yield* personal.searchMemory({
          query: "lint verify",
          projectID,
          sessionID: session.id,
        })
        expect(search[0]?.id).toBe(workspace.id)
        expect(search[0]?.match).toBe("fts")

        const sessionItem = yield* personal.ingestSession({
          projectID,
          sessionID: session.id,
          goal: "Handle current coding request",
          contextRefs: ["thread"],
          priority: "high",
        })
        const wakeup = yield* personal.scheduleWakeup({
          projectID,
          sessionID: session.id,
          goal: "Follow up on verification",
          contextRefs: ["verify"],
          priority: "normal",
          scheduledFor: Date.now() - 1000,
        })
        const dispatched = yield* personal.dispatchDueWakeups({
          projectID,
          now: Date.now(),
        })
        const webhookItem = yield* personal.ingestWebhook({
          projectID,
          goal: "Process webhook task",
          priority: "low",
          payload: { source: "webhook" },
        })
        yield* personal.updateInboxState({
          id: webhookItem.id,
          state: "done",
        })
        const completedWakeup = yield* personal.completeWakeup(wakeup.id)
        const inbox = yield* personal.listInboxItems({ projectID })
        yield* Effect.sleep("10 millis")
        const memory = yield* personal.listMemory({ projectID })
        const overview = yield* personal.overview({ projectID, now: Date.now() })

        expect(sessionItem.source).toBe("session")
        expect(dispatched).toHaveLength(1)
        expect(dispatched[0]?.source).toBe("scheduled")
        expect(completedWakeup.state).toBe("completed")
        expect(inbox.map((item) => item.source).toSorted()).toEqual(["scheduled", "session", "webhook"])
        expect(memory.some((item) => item.tags.includes(`follow_up:${wakeup.id}`))).toBe(true)
        expect(overview.inbox.queued).toBe(2)
        expect(overview.inbox.done).toBe(1)
        expect(overview.wakeups.pending).toBe(0)
        expect(seen).toContain("memory.updated")
        expect(seen).toContain("inbox.created")
        expect(seen).toContain("scheduler.scheduled")
        expect(seen).toContain("scheduler.fired")
        unsub()
      }),
    ),
  )
})
