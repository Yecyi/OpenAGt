import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"
import { attachWith } from "@/effect/run-service"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { TaskRuntime } from "@/session/task-runtime"
import { Database, desc, eq } from "@/storage"
import { Context, Effect, Layer, Option, Scope } from "effect"
import { CoordinatorRunTable } from "./coordinator.sql"
import {
  CoordinatorNode,
  CoordinatorPlan,
  CoordinatorRun,
  CoordinatorRunID,
  type CoordinatorNode as CoordinatorNodeType,
  type CoordinatorPlan as CoordinatorPlanType,
  type CoordinatorRun as CoordinatorRunType,
  type CoordinatorRunID as CoordinatorRunIDType,
} from "./schema"

function now() {
  return Date.now()
}

function defaultPlan(goal: string): CoordinatorPlanType {
  return CoordinatorPlan.parse({
    goal,
    nodes: [
      {
        id: "research",
        description: "Research context",
        prompt: `Understand the goal and gather the minimum code context needed.\n\nGoal: ${goal}`,
        task_kind: "research",
        subagent_type: "explore",
        depends_on: [],
        write_scope: [],
        read_scope: [],
        acceptance_checks: ["Relevant files identified"],
        priority: "high",
        origin: "coordinator",
      },
      {
        id: "implement",
        description: "Implement change",
        prompt: `Implement the requested change.\n\nGoal: ${goal}`,
        task_kind: "implement",
        subagent_type: "general",
        depends_on: ["research"],
        write_scope: [],
        read_scope: [],
        acceptance_checks: ["Requested change implemented"],
        priority: "high",
        origin: "coordinator",
      },
      {
        id: "verify",
        description: "Verify result",
        prompt: `Verify the completed result and summarize residual issues.\n\nGoal: ${goal}`,
        task_kind: "verify",
        subagent_type: "general",
        depends_on: ["implement"],
        write_scope: [],
        read_scope: [],
        acceptance_checks: ["Verification completed"],
        priority: "normal",
        origin: "coordinator",
      },
    ],
  })
}

function expandVerifyNodes(plan: CoordinatorPlanType) {
  const seen = new Set(plan.nodes.map((item) => item.id))
  const generated = plan.nodes.flatMap((item) => {
    if (item.task_kind !== "implement") return []
    if (plan.nodes.some((node) => node.task_kind === "verify" && node.depends_on.includes(item.id))) return []
    const id = `${item.id}_verify`
    if (seen.has(id)) return []
    seen.add(id)
    return [
      CoordinatorNode.parse({
        id,
        description: `Verify ${item.description}`,
        prompt: `Verify the implementation and report remaining issues.\n\nAcceptance checks:\n${item.acceptance_checks.join("\n")}`,
        task_kind: "verify",
        subagent_type: "general",
        depends_on: [item.id],
        write_scope: [],
        read_scope: [...item.write_scope],
        acceptance_checks: item.acceptance_checks.length > 0 ? item.acceptance_checks : ["Verification completed"],
        priority: item.priority,
        origin: "coordinator",
      }),
    ]
  })
  return CoordinatorPlan.parse({
    goal: plan.goal,
    nodes: [...plan.nodes, ...generated],
  })
}

function validatePlan(plan: CoordinatorPlanType) {
  const nodes = new Map(plan.nodes.map((item) => [item.id, item]))
  for (const node of plan.nodes) {
    for (const dep of node.depends_on) {
      if (!nodes.has(dep)) throw new Error(`Coordinator dependency missing: ${node.id} depends on unknown node ${dep}`)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const walk = (id: string) => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error(`Coordinator plan contains a cycle at node ${id}`)
    visiting.add(id)
    for (const dep of nodes.get(id)?.depends_on ?? []) walk(dep)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of nodes.keys()) walk(id)
}

function orderPlan(plan: CoordinatorPlanType) {
  const nodes = new Map(plan.nodes.map((item) => [item.id, item]))
  const ordered: CoordinatorNodeType[] = []
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    for (const dependency of nodes.get(id)?.depends_on ?? []) visit(dependency)
    const node = nodes.get(id)
    if (node) ordered.push(node)
  }
  for (const node of plan.nodes) visit(node.id)
  return CoordinatorPlan.parse({
    goal: plan.goal,
    nodes: ordered,
  })
}

function runFromRow(row: typeof CoordinatorRunTable.$inferSelect) {
  return CoordinatorRun.parse({
    id: row.id,
    sessionID: row.session_id,
    goal: row.goal,
    state: row.state,
    plan: row.plan,
    task_ids: row.task_ids,
    summary: row.summary ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      finished: row.time_finished ?? undefined,
    },
  })
}

export const Event = {
  Created: BusEvent.define("coordinator.created", CoordinatorRun),
  Updated: BusEvent.define("coordinator.updated", CoordinatorRun),
  Completed: BusEvent.define("coordinator.completed", CoordinatorRun),
}

export interface Interface {
  readonly plan: (input: { goal: string; nodes?: CoordinatorNodeType[] }) => Effect.Effect<CoordinatorPlanType, Error>
  readonly run: (input: { sessionID: SessionID; goal: string; nodes?: CoordinatorNodeType[] }) => Effect.Effect<CoordinatorRunType, Error>
  readonly get: (id: CoordinatorRunIDType) => Effect.Effect<Option.Option<CoordinatorRunType>, Error>
  readonly list: (sessionID: SessionID) => Effect.Effect<CoordinatorRunType[], Error>
  readonly dispatch: (id: CoordinatorRunIDType) => Effect.Effect<{ run: CoordinatorRunType; dispatched: number }, Error>
  readonly projection: (id: CoordinatorRunIDType) => Effect.Effect<{
    run: CoordinatorRunType
    tasks: TaskRuntime.TaskRecord[]
    counts: Record<"pending" | "running" | "completed" | "failed" | "cancelled", number>
  }, Error>
  readonly resume: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorRunType, Error>
  readonly summarize: (id: CoordinatorRunIDType) => Effect.Effect<string, Error>
}

export class Service extends Context.Service<Service, Interface>()("@openagt/Coordinator") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const sessions = yield* Session.Service
    const tasks = yield* TaskRuntime.Service
    const agents = yield* Agent.Service
    const prompt = yield* Effect.serviceOption(SessionPrompt.Service)
    const scope = yield* Scope.Scope

    const publish = (def: typeof Event.Created | typeof Event.Updated | typeof Event.Completed, run: CoordinatorRunType) =>
      bus.publish(def, run)

    const plan: Interface["plan"] = Effect.fn("Coordinator.plan")(function* (input) {
      const base = input.nodes && input.nodes.length > 0 ? CoordinatorPlan.parse({ goal: input.goal, nodes: input.nodes }) : defaultPlan(input.goal)
      const expanded = expandVerifyNodes(base)
      validatePlan(expanded)
      return orderPlan(expanded)
    })

    const createTaskSession = Effect.fn("Coordinator.createTaskSession")(function* (input: {
      sessionID: SessionID
      node: CoordinatorNodeType
    }) {
      const fallback = input.node.task_kind === "research" ? "explore" : "general"
      const agent = (yield* agents.get(input.node.subagent_type)) ?? (yield* agents.get(fallback))
      if (!agent) throw new Error(`Coordinator could not resolve subagent ${input.node.subagent_type}`)
      return yield* sessions.create({
        parentID: input.sessionID,
        title: `${input.node.description} (@${agent.name} subagent)`,
      })
    })

    const taskPrompt = (record: TaskRuntime.TaskRecord) => {
      const metadata = record.metadata ?? {}
      const promptText = typeof metadata.prompt === "string" ? metadata.prompt : record.description
      const checks = record.acceptance_checks.length
        ? `\n\nAcceptance checks:\n${record.acceptance_checks.map((item: string) => `- ${item}`).join("\n")}`
        : ""
      return `${promptText}${checks}`
    }

    const relevantTasks = Effect.fn("Coordinator.relevantTasks")(function* (run: CoordinatorRunType) {
      const all = yield* tasks.list(SessionID.make(run.sessionID))
      const taskIDs = new Set(run.task_ids.map((item) => SessionID.make(item)))
      return all.filter((item) => taskIDs.has(item.task_id))
    })

    const executeTask = Effect.fn("Coordinator.executeTask")(function* (record: TaskRuntime.TaskRecord) {
      const current = yield* tasks.get({
        taskID: record.task_id,
        parentSessionID: record.parent_session_id,
      })
      if (Option.isNone(prompt)) return
      if (Option.isNone(current) || current.value.status !== "pending") return
      yield* tasks.setRunning(record.task_id, record.parent_session_id)
      const result = yield* prompt.value
        .prompt({
          sessionID: record.child_session_id,
          agent: record.subagent_type,
          parts: [
            {
              type: "text",
              text: taskPrompt(record),
            },
          ],
        })
        .pipe(
          Effect.tap((message: MessageV2.WithParts) =>
            tasks.complete({
              taskID: record.task_id,
              parentSessionID: record.parent_session_id,
              result: message,
            }),
          ),
          Effect.tapError((error) =>
            tasks.fail({
              taskID: record.task_id,
              parentSessionID: record.parent_session_id,
              error: error instanceof Error ? error.message : String(error),
            }),
          ),
          Effect.ignore,
        )
      return result
    })

    const dispatchReady = Effect.fn("Coordinator.dispatchReady")(function* (id: CoordinatorRunIDType) {
      const instance = yield* InstanceState.context
      const workspace = yield* InstanceState.workspaceID
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      const run = runOpt.value
      const pending = (yield* relevantTasks(run)).filter((item) => item.status === "pending")
      const ready = yield* Effect.filter(pending, (item) =>
        tasks.canRun({
          parentSessionID: SessionID.make(run.sessionID),
          task: item,
        }),
      )
      yield* Effect.forEach(
        ready,
        (item) => attachWith(executeTask(item), { instance, workspace }).pipe(Effect.forkIn(scope)),
        {
          concurrency: "unbounded",
          discard: true,
        },
      )
      if (ready.length === 0) yield* summarize(id).pipe(Effect.ignore)
      return {
        run,
        dispatched: ready.length,
      }
    })

    const subscriptions = yield* InstanceState.make(
      Effect.fn("Coordinator.subscriptions")(function* () {
        const instance = yield* InstanceState.context
        const workspace = yield* InstanceState.workspaceID
        const stopTaskSubscription = yield* bus.subscribeCallback(TaskRuntime.Event.Updated, (event) => {
          if (!event.properties.result.group_id) return
          const runID = event.properties.result.group_id as CoordinatorRunIDType
          void Effect.runPromise(
            attachWith(dispatchReady(runID), {
              instance,
              workspace,
            }).pipe(
              Effect.catch(() => Effect.void),
            ),
          )
        })
        yield* Effect.addFinalizer(() => Effect.sync(stopTaskSubscription))
        return true as const
      }),
    )

    const ensureSubscribed = Effect.fn("Coordinator.ensureSubscribed")(function* () {
      yield* InstanceState.get(subscriptions)
    })

    const run: Interface["run"] = Effect.fn("Coordinator.run")(function* (input) {
      yield* ensureSubscribed()
      const planned = yield* plan(input)
      const runID = CoordinatorRunID.ascending()
      const nodeTaskIDs = new Map<string, SessionID>()
      for (const node of planned.nodes) {
        const session = yield* createTaskSession({ sessionID: input.sessionID, node })
        nodeTaskIDs.set(node.id, session.id)
      }
      for (const node of planned.nodes) {
        const taskID = nodeTaskIDs.get(node.id)
        if (!taskID) continue
        yield* tasks.create({
          parentSessionID: input.sessionID,
          childSessionID: taskID,
          groupID: runID,
          strategy: "mixed",
          taskKind: node.task_kind,
          subagentType: node.subagent_type,
          description: node.description,
          prompt: node.prompt,
          dependsOn: node.depends_on.flatMap((item) => {
            const dependency = nodeTaskIDs.get(item)
            return dependency ? [dependency] : []
          }),
          metadata: {
            prompt: node.prompt,
            write_scope: node.write_scope,
            read_scope: node.read_scope,
            acceptance_checks: node.acceptance_checks,
            priority: node.priority,
            origin: node.origin,
            coordinator_node_id: node.id,
            coordinator_run_id: runID,
          },
          writeScope: node.write_scope,
          readScope: node.read_scope,
          acceptanceChecks: node.acceptance_checks,
          priority: node.priority,
          origin: node.origin,
        })
      }
      const timestamp = now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db.insert(CoordinatorRunTable)
            .values({
              id: runID,
              session_id: input.sessionID,
              goal: input.goal,
              state: "active",
              plan: planned,
              task_ids: [...nodeTaskIDs.values()],
              time_created: timestamp,
              time_updated: timestamp,
            })
            .run(),
        ),
      )
      const created = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, runID)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Created, created)
      yield* dispatchReady(created.id)
      return created
    })

    const get: Interface["get"] = Effect.fn("Coordinator.get")(function* (id) {
      yield* ensureSubscribed()
      const row = yield* Effect.sync(() => Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()))
      return row ? Option.some(runFromRow(row)) : Option.none()
    })

    const list: Interface["list"] = Effect.fn("Coordinator.list")(function* (sessionID) {
      yield* ensureSubscribed()
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.session_id, sessionID)).orderBy(desc(CoordinatorRunTable.time_created)).all(),
        ),
      )
      return rows.map(runFromRow)
    })

    const projection: Interface["projection"] = Effect.fn("Coordinator.projection")(function* (id) {
      yield* ensureSubscribed()
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      const run = runOpt.value
      const taskList = yield* relevantTasks(run)
      return {
        run,
        tasks: taskList,
        counts: {
          pending: taskList.filter((item) => item.status === "pending").length,
          running: taskList.filter((item) => item.status === "running").length,
          completed: taskList.filter((item) => item.status === "completed").length,
          failed: taskList.filter((item) => item.status === "failed").length,
          cancelled: taskList.filter((item) => item.status === "cancelled").length,
        },
      }
    })

    const summarize: Interface["summarize"] = Effect.fn("Coordinator.summarize")(function* (id) {
      yield* ensureSubscribed()
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      const info = runOpt.value
      const taskIDs = info.task_ids.map((item) => SessionID.make(item))
      const all = yield* tasks.list(SessionID.make(info.sessionID))
      const relevant = all.filter((item: (typeof all)[number]) => taskIDs.includes(item.task_id))
      const completed = relevant.filter((item) => item.status === "completed").length
      const failed = relevant.filter((item) => item.status === "failed").length
      const running = relevant.filter((item) => item.status === "running").length
      const pending = relevant.filter((item) => item.status === "pending").length
      const summary = `${completed}/${relevant.length} completed, ${running} running, ${pending} pending, ${failed} failed`
      const state =
        failed > 0 ? "failed" : completed === relevant.length && relevant.length > 0 ? "completed" : "active"
      const finished = state === "completed" || state === "failed" ? now() : null
      yield* Effect.sync(() =>
        Database.use((db) =>
          db.update(CoordinatorRunTable)
            .set({
              state,
              summary,
              time_updated: now(),
              time_finished: finished,
            })
            .where(eq(CoordinatorRunTable.id, id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(state === "completed" ? Event.Completed : Event.Updated, updated)
      return summary
    })

    const resume: Interface["resume"] = Effect.fn("Coordinator.resume")(function* (id) {
      yield* ensureSubscribed()
      yield* dispatchReady(id).pipe(Effect.ignore)
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      return runOpt.value
    })

    return Service.of({
      plan,
      run,
      get,
      list,
      dispatch: dispatchReady,
      projection,
      resume,
      summarize,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(TaskRuntime.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(Agent.defaultLayer),
)

export * as Coordinator from "./coordinator"
