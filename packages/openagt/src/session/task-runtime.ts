import z from "zod"
import { Context, Effect, Layer, Option, Stream } from "effect"
import { Storage } from "@/storage"
import { SessionID } from "./schema"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { MessageV2 } from "./message-v2"

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

function summarizeMessage(text: string | undefined) {
  if (!text) return ""
  const line = text
    .replace(/<\/?task_result(?:\s[^>]*)?>/g, "")
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean)
  return line ? line.slice(0, 400) : ""
}

function fullMessageText(text: string | undefined) {
  if (!text) return ""
  return text.replace(/<\/?task_result(?:\s[^>]*)?>/g, "").trim().slice(0, 8_000)
}

function promptHash(prompt: string) {
  return Buffer.from(prompt).toString("base64url").slice(0, 64)
}

function resultFromRecord(record: TaskRecord): TaskResult {
  const metadata = record.metadata
    ? Object.fromEntries(
        [
          "coordinator_node_id",
          "coordinator_run_id",
          "role",
          "expert_id",
          "expert_role",
          "workflow",
          "effort",
          "artifact_type",
          "artifact_id",
          "revision_of",
          "quality_gate_id",
          "memory_namespace",
          "confidence",
          "revise_policy",
          "output_schema",
          "parallel_group",
          "partial",
          "retryable",
          "limit_reason",
          "partial_summary",
        ].flatMap((key) => (key in record.metadata! ? [[key, record.metadata![key]] as const] : [])),
      )
    : undefined
  return {
    task_id: record.task_id,
    status: record.status,
    summary: record.result_summary ?? record.error_summary ?? `Task ${record.status}`,
    child_session_id: record.child_session_id,
    usage: record.usage,
    result_excerpt: record.result_summary,
    error_excerpt: record.error_summary,
    group_id: record.group_id,
    task_kind: record.task_kind,
    subagent_type: record.subagent_type,
    description: record.description,
    write_scope: record.write_scope,
    read_scope: record.read_scope,
    acceptance_checks: record.acceptance_checks,
    priority: record.priority,
    origin: record.origin,
    metadata,
  }
}

function groupState(records: TaskRecord[]) {
  if (records.some((item) => item.status === "failed")) return "failed"
  if (records.some((item) => item.status === "cancelled")) return "cancelled"
  if (records.some((item) => item.status === "partial")) return "partial"
  if (records.every((item) => item.status === "completed")) return "completed"
  if (records.some((item) => item.status === "running")) return "running"
  return "pending"
}

function scopeOverlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return true
  return left.some((item) =>
    right.some((other) => item === other || item.startsWith(other + "/") || other.startsWith(item + "/")),
  )
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
  }) => Effect.Effect<TaskRecord, Error>
  readonly partial: (input: {
    taskID: SessionID
    parentSessionID: SessionID
    result?: MessageV2.WithParts
    output?: string
    reason: string
    retryable?: boolean
  }) => Effect.Effect<TaskRecord, Error>
  readonly fail: (input: {
    taskID: SessionID
    parentSessionID: SessionID
    error: string
  }) => Effect.Effect<TaskRecord, Error>
  readonly cancel: (input: {
    taskID: SessionID
    parentSessionID: SessionID
    reason?: string
  }) => Effect.Effect<TaskRecord, Error>
  readonly retry: (input: { taskID: SessionID; parentSessionID: SessionID }) => Effect.Effect<TaskRecord, Error>
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
  readonly canRun: (input: { parentSessionID: SessionID; task: TaskRecord }) => Effect.Effect<boolean, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TaskRuntime") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* Storage.Service
    const bus = yield* Bus.Service
    const cancelHandlers = new Map<string, () => void>()

    const publishUpdate = Effect.fn("TaskRuntime.publishUpdate")(function* (record: TaskRecord) {
      yield* bus.publish(Event.Updated, {
        parent_session_id: record.parent_session_id,
        result: resultFromRecord(record),
      })
    })

    const refreshGroup = Effect.fn("TaskRuntime.refreshGroup")(function* (record: TaskRecord) {
      if (!record.group_id) return
      const tasks = yield* storage.list(["task", record.parent_session_id])
      const records = yield* Effect.all(
        tasks.map((key) =>
          storage
            .read<TaskRecord>(taskKey(record.parent_session_id, key[key.length - 1] as SessionID))
            .pipe(Effect.option),
        ),
        { concurrency: "unbounded" },
      )
      const all = records
        .filter(Option.isSome)
        .map((item) => item.value)
        .filter((item) => item.group_id === record.group_id)
      const group = yield* storage
        .read<TaskGroup>(groupKey(record.parent_session_id, record.group_id))
        .pipe(Effect.option)
      if (Option.isNone(group)) return
      yield* storage.write(groupKey(record.parent_session_id, record.group_id), {
        ...group.value,
        summary_state: groupState(all),
      })
    })

    const create: Interface["create"] = Effect.fn("TaskRuntime.create")(function* (input) {
      const now = Date.now()
      const current = yield* storage.read<TaskRecord>(taskKey(input.parentSessionID, input.childSessionID)).pipe(Effect.option)
      if (Option.isSome(current)) {
        return yield* Effect.fail(new Error(`Task already exists: ${input.childSessionID}`))
      }
      const record: TaskRecord = {
        task_id: input.childSessionID,
        group_id: input.groupID,
        parent_session_id: input.parentSessionID,
        child_session_id: input.childSessionID,
        status: "pending",
        task_kind: input.taskKind,
        subagent_type: input.subagentType,
        description: input.description,
        prompt_hash: promptHash(input.prompt),
        depends_on: input.dependsOn,
        write_scope: input.writeScope ?? [],
        read_scope: input.readScope ?? [],
        acceptance_checks: input.acceptanceChecks ?? [],
        priority: input.priority ?? "normal",
        origin: input.origin ?? "user",
        metadata: input.metadata,
        created_at: now,
      }
      const existing = yield* list(input.parentSessionID)
      const known = new Set(existing.map((item) => item.task_id))
      for (const dependency of input.dependsOn) {
        if (!known.has(dependency)) {
          return yield* Effect.fail(new Error(`Task dependency not found: ${dependency}`))
        }
      }
      yield* storage.write(taskKey(input.parentSessionID, input.childSessionID), record)
      if (input.groupID) {
        const existing = yield* storage
          .read<TaskGroup>(groupKey(input.parentSessionID, input.groupID))
          .pipe(Effect.option)
        if (Option.isNone(existing)) {
          yield* storage.write(groupKey(input.parentSessionID, input.groupID), {
            group_id: input.groupID,
            parent_session_id: input.parentSessionID,
            strategy: input.strategy ?? "parallel",
            created_at: now,
            summary_state: "pending",
          } satisfies TaskGroup)
        }
      }
      return record
    })

    const get: Interface["get"] = Effect.fn("TaskRuntime.get")(function* (input) {
      return yield* storage.read<TaskRecord>(taskKey(input.parentSessionID, input.taskID)).pipe(Effect.option)
    })

    const update = (
      parentSessionID: SessionID,
      taskID: SessionID,
      fn: (draft: TaskRecord) => void,
    ): Effect.Effect<TaskRecord, Error> =>
      Effect.gen(function* () {
        const record = yield* storage.update<TaskRecord>(taskKey(parentSessionID, taskID), fn)
        yield* refreshGroup(record)
        yield* publishUpdate(record)
        return record
      })

    const setRunning: Interface["setRunning"] = Effect.fn("TaskRuntime.setRunning")(
      function* (taskID, parentSessionID) {
        return yield* update(parentSessionID, taskID, (draft) => {
          draft.status = "running"
          draft.started_at = draft.started_at ?? Date.now()
        })
      },
    )

    const tryStartPending: Interface["tryStartPending"] = Effect.fn("TaskRuntime.tryStartPending")(
      function* (taskID, parentSessionID) {
        const started = { value: false }
        const record = yield* storage.update<TaskRecord>(taskKey(parentSessionID, taskID), (draft) => {
          if (draft.status !== "pending") return
          started.value = true
          draft.status = "running"
          draft.started_at = draft.started_at ?? Date.now()
        })
        if (!started.value) return
        yield* refreshGroup(record)
        yield* publishUpdate(record)
        return record
      },
    )

    const registerCancelHandler: Interface["registerCancelHandler"] = Effect.fn("TaskRuntime.registerCancelHandler")(
      function* (input) {
        const key = cancelHandlerKey(input.parentSessionID, input.taskID)
        return yield* Effect.sync(() => {
          cancelHandlers.set(key, input.cancel)
          return () => {
            cancelHandlers.delete(key)
          }
        })
      },
    )

    const complete: Interface["complete"] = Effect.fn("TaskRuntime.complete")(function* (input) {
      return yield* update(input.parentSessionID, input.taskID, (draft) => {
        const text = input.output ?? input.result?.parts.findLast((item) => item.type === "text")?.text
        draft.status = "completed"
        draft.finished_at = Date.now()
        draft.result_summary = summarizeMessage(text)
        draft.error_summary = undefined
        draft.metadata = {
          ...(draft.metadata ?? {}),
          result_text: fullMessageText(text),
        }
        if (draft.metadata?.output_schema === "revise" || draft.metadata?.role === "reviser") {
          draft.metadata = {
            ...draft.metadata,
            review_text: fullMessageText(text),
          }
        }
        if (input.result?.info.role === "assistant") {
          draft.usage = {
            totalTokens:
              input.result.info.tokens.input +
              input.result.info.tokens.output +
              input.result.info.tokens.reasoning +
              input.result.info.tokens.cache.read +
              input.result.info.tokens.cache.write,
            inputTokens: input.result.info.tokens.input,
            outputTokens: input.result.info.tokens.output,
            reasoningTokens: input.result.info.tokens.reasoning,
            durationMs:
              draft.started_at && input.result.info.time.created
                ? Math.max(0, input.result.info.time.created - draft.started_at)
                : undefined,
          }
        }
      })
    })

    const partial: Interface["partial"] = Effect.fn("TaskRuntime.partial")(function* (input) {
      return yield* update(input.parentSessionID, input.taskID, (draft) => {
        const text = input.output ?? input.result?.parts.findLast((item) => item.type === "text")?.text
        draft.status = "partial"
        draft.finished_at = Date.now()
        draft.result_summary = summarizeMessage(text)
        draft.error_summary = undefined
        draft.stop_reason = input.reason
        draft.metadata = {
          ...(draft.metadata ?? {}),
          partial: true,
          retryable: input.retryable ?? true,
          limit_reason: input.reason,
          partial_summary: fullMessageText(text),
        }
        if (input.result?.info.role === "assistant") {
          draft.usage = {
            totalTokens:
              input.result.info.tokens.input +
              input.result.info.tokens.output +
              input.result.info.tokens.reasoning +
              input.result.info.tokens.cache.read +
              input.result.info.tokens.cache.write,
            inputTokens: input.result.info.tokens.input,
            outputTokens: input.result.info.tokens.output,
            reasoningTokens: input.result.info.tokens.reasoning,
            durationMs:
              draft.started_at && input.result.info.time.created
                ? Math.max(0, input.result.info.time.created - draft.started_at)
                : undefined,
          }
        }
      })
    })

    const fail: Interface["fail"] = Effect.fn("TaskRuntime.fail")(function* (input) {
      return yield* update(input.parentSessionID, input.taskID, (draft) => {
        draft.status = "failed"
        draft.finished_at = Date.now()
        draft.error_summary = input.error.slice(0, 400)
      })
    })

    const cancel: Interface["cancel"] = Effect.fn("TaskRuntime.cancel")(function* (input) {
      const record = yield* update(input.parentSessionID, input.taskID, (draft) => {
        draft.status = "cancelled"
        draft.finished_at = Date.now()
        draft.stop_reason = input.reason
        draft.error_summary = input.reason?.slice(0, 400) ?? "Task cancelled"
      })
      yield* Effect.sync(() => {
        const key = cancelHandlerKey(input.parentSessionID, input.taskID)
        const handler = cancelHandlers.get(key)
        cancelHandlers.delete(key)
        handler?.()
      })
      return record
    })

    const retry: Interface["retry"] = Effect.fn("TaskRuntime.retry")(function* (input) {
      const current = yield* get({ taskID: input.taskID, parentSessionID: input.parentSessionID })
      if (Option.isNone(current)) return yield* Effect.fail(new Error(`Task not found: ${input.taskID}`))
      if (current.value.status !== "failed" && current.value.status !== "cancelled" && current.value.status !== "partial") {
        return yield* Effect.fail(new Error(`Task cannot be retried from state: ${current.value.status}`))
      }
      return yield* update(input.parentSessionID, input.taskID, (draft) => {
        draft.status = "pending"
        draft.started_at = undefined
        draft.finished_at = undefined
        draft.result_summary = undefined
        draft.error_summary = undefined
        draft.stop_reason = undefined
        draft.usage = undefined
        if (draft.metadata) {
          draft.metadata = {
            ...draft.metadata,
            partial: undefined,
            retryable: undefined,
            limit_reason: undefined,
            partial_summary: undefined,
            result_text: undefined,
          }
        }
      })
    })

    const list: Interface["list"] = Effect.fn("TaskRuntime.list")(function* (parentSessionID) {
      const keys = yield* storage.list(["task", parentSessionID])
      const items = yield* Effect.all(
        keys.map((key) => storage.read<TaskRecord>(key).pipe(Effect.catch(() => Effect.succeed(undefined)))),
        { concurrency: "unbounded" },
      )
      return items.filter((item): item is TaskRecord => Boolean(item)).toSorted((a, b) => b.created_at - a.created_at)
    })

    const canRun: Interface["canRun"] = Effect.fn("TaskRuntime.canRun")(function* (input) {
      const tasks = yield* list(input.parentSessionID)
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
        (item) => item.task_kind === "implement" && scopeOverlap(item.write_scope, input.task.read_scope),
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
      create,
      setRunning,
      tryStartPending,
      registerCancelHandler,
      complete,
      partial,
      fail,
      cancel,
      get,
      list,
      wait,
      canRun,
      retry,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Storage.defaultLayer), Layer.provide(Bus.layer))

export * as TaskRuntime from "./task-runtime"
