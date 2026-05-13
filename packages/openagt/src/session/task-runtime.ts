import z from "zod"
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Storage } from "@/storage"
import { SessionID } from "./schema"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { MessageV2 } from "./message-v2"
import { BudgetTuning } from "@/agent/budget-tuning"
import { resultFromRecord, scopeOverlap, scopedReadOverlap } from "./task-runtime-helpers"
import { latestTaskOutcome, listTaskOutcomes, type TaskOutcome } from "./task-outcomes"
import { createTaskWriteOps } from "./task-runtime-write-ops"

export const TaskStatus = z.enum(["pending", "running", "completed", "partial", "failed", "cancelled"])
export type TaskStatus = z.infer<typeof TaskStatus>

export const TaskKind = z.enum(["research", "implement", "verify", "generic"])
export type TaskKind = z.infer<typeof TaskKind>

export const GroupStrategy = z.enum(["parallel", "serial", "mixed"])
export type GroupStrategy = z.infer<typeof GroupStrategy>

export const ReturnMode = z.enum(["id", "summary"])
export type ReturnMode = z.infer<typeof ReturnMode>

export const TaskUsage = z
  .object({
    totalTokens: z.number().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
    toolUses: z.number().optional(),
    durationMs: z.number().optional(),
  })
  .optional()

export const TaskPriority = z.enum(["high", "normal", "low"])
export type TaskPriority = z.infer<typeof TaskPriority>

export const TaskOrigin = z.enum(["user", "coordinator", "scheduler", "gateway"])
export type TaskOrigin = z.infer<typeof TaskOrigin>

export const TaskRecord = z.object({
  task_id: SessionID.zod,
  group_id: z.string().optional(),
  parent_session_id: SessionID.zod,
  child_session_id: SessionID.zod,
  status: TaskStatus,
  task_kind: TaskKind,
  subagent_type: z.string(),
  description: z.string(),
  prompt_hash: z.string(),
  depends_on: z.array(SessionID.zod),
  result_summary: z.string().optional(),
  error_summary: z.string().optional(),
  write_scope: z.array(z.string()),
  read_scope: z.array(z.string()),
  acceptance_checks: z.array(z.string()),
  priority: TaskPriority,
  origin: TaskOrigin,
  metadata: z.record(z.string(), z.unknown()).optional(),
  created_at: z.number(),
  started_at: z.number().optional(),
  finished_at: z.number().optional(),
  usage: TaskUsage,
  stop_reason: z.string().optional(),
})
export type TaskRecord = z.infer<typeof TaskRecord>

export const TaskGroup = z.object({
  group_id: z.string(),
  parent_session_id: SessionID.zod,
  strategy: GroupStrategy,
  created_at: z.number(),
  summary_state: z.string(),
})
export type TaskGroup = z.infer<typeof TaskGroup>

export const TaskResult = z.object({
  task_id: SessionID.zod,
  status: TaskStatus,
  summary: z.string(),
  child_session_id: SessionID.zod,
  usage: TaskUsage,
  result_excerpt: z.string().optional(),
  error_excerpt: z.string().optional(),
  group_id: z.string().optional(),
  task_kind: TaskKind,
  subagent_type: z.string(),
  description: z.string(),
  write_scope: z.array(z.string()),
  read_scope: z.array(z.string()),
  acceptance_checks: z.array(z.string()),
  priority: TaskPriority,
  origin: TaskOrigin,
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type TaskResult = z.infer<typeof TaskResult>

const TaskNotification = z.object({
  parent_session_id: SessionID.zod,
  result: TaskResult,
})

export const Event = {
  Updated: BusEvent.define("task.updated", TaskNotification),
}

function taskKey(parentSessionID: SessionID, taskID: SessionID) {
  return ["task", parentSessionID, taskID]
}

function cancelHandlerKey(parentSessionID: SessionID, taskID: SessionID) {
  return `${parentSessionID}:${taskID}`
}

function groupKey(parentSessionID: SessionID, groupID: string) {
  return ["task_group", parentSessionID, groupID]
}

function isMpacrCritic(task: TaskRecord) {
  return task.metadata?.mpacr_role === "critic" || task.metadata?.role === "red-team-critic"
}

export interface Interface {
  readonly create: (input: {
    parentSessionID: SessionID
    childSessionID: SessionID
    groupID?: string
    strategy?: GroupStrategy
    taskKind: TaskKind
    subagentType: string
    description: string
    prompt: string
    dependsOn: SessionID[]
    writeScope?: string[]
    readScope?: string[]
    acceptanceChecks?: string[]
    priority?: TaskPriority
    origin?: TaskOrigin
    metadata?: Record<string, unknown>
  }) => Effect.Effect<TaskRecord, Error>
  readonly setRunning: (taskID: SessionID, parentSessionID: SessionID) => Effect.Effect<TaskRecord, Error>
  readonly tryStartPending: (
    taskID: SessionID,
    parentSessionID: SessionID,
  ) => Effect.Effect<TaskRecord | undefined, Error>
  readonly registerCancelHandler: (input: {
    taskID: SessionID
    parentSessionID: SessionID
    cancel: () => void
  }) => Effect.Effect<() => void>
  readonly complete: (input: {
    taskID: SessionID
    parentSessionID: SessionID
    result?: MessageV2.WithParts
    output?: string
    metadata?: Record<string, unknown>
  }) => Effect.Effect<TaskRecord, Error>
  readonly partial: (input: {
    taskID: SessionID
    parentSessionID: SessionID
    result?: MessageV2.WithParts
    output?: string
    reason: string
    retryable?: boolean
    remainingScope?: string[]
    metadata?: Record<string, unknown>
  }) => Effect.Effect<TaskRecord, Error>
  readonly fail: (input: {
    taskID: SessionID
    parentSessionID: SessionID
    error: string
    metadata?: Record<string, unknown>
  }) => Effect.Effect<TaskRecord, Error>
  readonly cancel: (input: {
    taskID: SessionID
    parentSessionID: SessionID
    reason?: string
  }) => Effect.Effect<TaskRecord, Error>
  readonly retry: (input: { taskID: SessionID; parentSessionID: SessionID }) => Effect.Effect<TaskRecord, Error>
  readonly latestOutcome: (input: {
    taskID: SessionID
    parentSessionID: SessionID
  }) => Effect.Effect<Option.Option<TaskOutcome>, Error>
  readonly listOutcomes: (input: {
    parentSessionID: SessionID
    taskID?: SessionID
  }) => Effect.Effect<TaskOutcome[], Error>
  readonly get: (input: {
    taskID: SessionID
    parentSessionID: SessionID
  }) => Effect.Effect<Option.Option<TaskRecord>, Error>
  readonly list: (parentSessionID: SessionID) => Effect.Effect<TaskRecord[], Error>
  readonly wait: (input: {
    parentSessionID: SessionID
    taskIDs: SessionID[]
    mode: "all" | "any"
    timeoutMs?: number
  }) => Effect.Effect<TaskResult[], Error>
  /**
   * Decide whether `task` is eligible to dispatch right now.
   *
   * Pass `tasks` to evaluate against a pre-fetched snapshot — required when
   * the caller dispatches multiple ready tasks in one sweep (the dispatch
   * loop). Without `tasks` canRun calls list() itself (O(N) storage reads
   * per call), so a sweep of K ready tasks becomes O(K*N) — see April
   * 2026-04 finding 4.7. The snapshot path is the dispatch-loop fast path;
   * the no-snapshot path is the single-task tool/test fast path.
   */
  readonly canRun: (input: {
    parentSessionID: SessionID
    task: TaskRecord
    tasks?: TaskRecord[]
  }) => Effect.Effect<boolean, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TaskRuntime") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* Storage.Service
    const bus = yield* Bus.Service
    const cancelHandlers = new Map<string, () => void>()

    const get: Interface["get"] = Effect.fn("TaskRuntime.get")(function* (input) {
      return yield* storage.read<TaskRecord>(taskKey(input.parentSessionID, input.taskID)).pipe(Effect.option)
    })

    const writeOps = createTaskWriteOps({
      storage,
      bus,
      cancelHandlers,
      TaskUpdated: Event.Updated,
      get,
    })

    const list: Interface["list"] = Effect.fn("TaskRuntime.list")(function* (parentSessionID) {
      const keys = yield* storage.list(["task", parentSessionID])
      const items = yield* Effect.all(
        keys.map((key) => storage.read<TaskRecord>(key).pipe(Effect.catch(() => Effect.succeed(undefined)))),
        { concurrency: BudgetTuning.concurrency.storageRead },
      )
      return items.filter((item): item is TaskRecord => Boolean(item)).toSorted((a, b) => b.created_at - a.created_at)
    })

    const canRun: Interface["canRun"] = Effect.fn("TaskRuntime.canRun")(function* (input) {
      const tasks = input.tasks ?? (yield* list(input.parentSessionID))
      if (
        !input.task.depends_on.every((taskID) =>
          tasks.some((item) => item.task_id === taskID && item.status === "completed"),
        )
      ) {
        return false
      }
      const running = tasks.filter((item) => item.status === "running")
      if (input.task.task_kind === "research" || input.task.task_kind === "generic") return true
      if (input.task.task_kind === "implement") {
        return !running.some(
          (item) => item.task_kind === "implement" && scopeOverlap(item.write_scope, input.task.write_scope),
        )
      }
      if (input.task.task_kind !== "verify") return true
      return !running.some(
        (item) =>
          (item.task_kind === "implement" && scopeOverlap(item.write_scope, input.task.read_scope)) ||
          (item.task_kind === "verify" &&
            scopedReadOverlap(item.read_scope, input.task.read_scope) &&
            !(isMpacrCritic(item) && isMpacrCritic(input.task))),
      )
    })

    const wait: Interface["wait"] = Effect.fn("TaskRuntime.wait")(function* (input) {
      const terminal = new Set<TaskStatus>(["completed", "partial", "failed", "cancelled"])
      const matched = (records: TaskRecord[]) => records.filter((item) => input.taskIDs.includes(item.task_id))
      const terminalMatched = (records: TaskRecord[]) => matched(records).filter((item) => terminal.has(item.status))
      const ready = (records: TaskRecord[]) => {
        const current = matched(records)
        if (input.mode === "all") {
          if (current.length !== input.taskIDs.length) return false
          return current.every((item) => terminal.has(item.status))
        }
        return terminalMatched(records).length > 0
      }

      const initial = yield* list(input.parentSessionID)
      if (ready(initial)) {
        const records = input.mode === "all" ? matched(initial) : terminalMatched(initial)
        return records.map(resultFromRecord)
      }

      const stream = bus.subscribe(Event.Updated).pipe(
        Stream.filter((event) => event.properties.parent_session_id === input.parentSessionID),
        Stream.mapEffect(() => list(input.parentSessionID)),
        Stream.filter(ready),
        Stream.take(1),
        Stream.runHead,
      )
      const waitForRecords = stream.pipe(
        Effect.map((records) => (Option.isSome(records) ? records.value : [])),
        Effect.map((records) =>
          (input.mode === "all" ? matched(records) : terminalMatched(records)).map(resultFromRecord),
        ),
      )
      if (!input.timeoutMs) return yield* waitForRecords
      return yield* waitForRecords.pipe(
        Effect.timeout(`${input.timeoutMs} millis`),
        Effect.catchTag("TimeoutError", () => Effect.fail(new Error("Task wait timed out"))),
      )
    })

    return Service.of({
      create: writeOps.create,
      setRunning: writeOps.setRunning,
      tryStartPending: writeOps.tryStartPending,
      registerCancelHandler: writeOps.registerCancelHandler,
      complete: writeOps.complete,
      partial: writeOps.partial,
      fail: writeOps.fail,
      cancel: writeOps.cancel,
      retry: writeOps.retry,
      latestOutcome: latestTaskOutcome,
      listOutcomes: listTaskOutcomes,
      get,
      list,
      wait,
      canRun,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Storage.defaultLayer), Layer.provide(Bus.layer))

export * as TaskRuntime from "./task-runtime"
