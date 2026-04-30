import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Storage } from "@/storage"
import { BudgetTuning } from "@/agent/budget-tuning"
import { SessionID } from "./schema"
import { Effect, Option } from "effect"
import {
  fullMessageText,
  groupState,
  normalizedUsage,
  promptHash,
  resultFromRecord,
  summarizeMessage,
} from "./task-runtime-helpers"
import type { GroupStrategy, TaskGroup, TaskKind, TaskOrigin, TaskPriority, TaskRecord } from "./task-runtime"

function taskKey(parentSessionID: SessionID, taskID: SessionID) {
  return ["task", parentSessionID, taskID]
}

function cancelHandlerKey(parentSessionID: SessionID, taskID: SessionID) {
  return `${parentSessionID}:${taskID}`
}

function groupKey(parentSessionID: SessionID, groupID: string) {
  return ["task_group", parentSessionID, groupID]
}

function recoveryCheckpointFor(record: TaskRecord) {
  return {
    status: record.status,
    result_summary: record.result_summary,
    error_summary: record.error_summary,
    stop_reason: record.stop_reason,
    created_at: Date.now(),
  }
}

export interface CreateInput {
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
}

export interface CompleteInput {
  taskID: SessionID
  parentSessionID: SessionID
  result?: import("./message-v2").MessageV2.WithParts
  output?: string
  metadata?: Record<string, unknown>
}

export interface PartialInput {
  taskID: SessionID
  parentSessionID: SessionID
  result?: import("./message-v2").MessageV2.WithParts
  output?: string
  reason: string
  retryable?: boolean
  remainingScope?: string[]
}

export interface FailInput {
  taskID: SessionID
  parentSessionID: SessionID
  error: string
  metadata?: Record<string, unknown>
}

export interface CancelInput {
  taskID: SessionID
  parentSessionID: SessionID
  reason?: string
}

export function createTaskWriteOps(deps: {
  storage: Storage.Interface
  bus: Bus.Interface
  cancelHandlers: Map<string, () => void>
  TaskUpdated: BusEvent.Definition
  get: (input: { taskID: SessionID; parentSessionID: SessionID }) => Effect.Effect<Option.Option<TaskRecord>, Error>
}) {
  const { storage, bus, cancelHandlers, TaskUpdated, get } = deps

  const publishUpdate = Effect.fn("TaskRuntime.publishUpdate")(function* (record: TaskRecord) {
    yield* bus.publish(TaskUpdated, {
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
      { concurrency: BudgetTuning.concurrency.storageRead },
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

  const update = (
    parentSessionID: SessionID,
    taskID: SessionID,
    fn: (draft: TaskRecord) => void,
  ): Effect.Effect<TaskRecord, Error> =>
    Effect.gen(function* () {
      const before = yield* storage.read<TaskRecord>(taskKey(parentSessionID, taskID)).pipe(Effect.option)
      const record = yield* storage.update<TaskRecord>(taskKey(parentSessionID, taskID), fn)
      const beforeStatus = Option.isSome(before) ? before.value.status : undefined
      const groupStateChanged =
        Option.isNone(before) || before.value.group_id !== record.group_id || beforeStatus !== record.status
      if (groupStateChanged) {
        yield* refreshGroup(record)
      }
      yield* publishUpdate(record)
      return record
    })

  const create = Effect.fn("TaskRuntime.create")(function* (input: CreateInput) {
    const now = Date.now()
    const current = yield* storage
      .read<TaskRecord>(taskKey(input.parentSessionID, input.childSessionID))
      .pipe(Effect.option)
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
    const existing = yield* listAll(input.parentSessionID)
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

  const listAll = (parentSessionID: SessionID): Effect.Effect<TaskRecord[], Error> =>
    Effect.gen(function* () {
      const keys = yield* storage.list(["task", parentSessionID])
      const items = yield* Effect.all(
        keys.map((key) => storage.read<TaskRecord>(key).pipe(Effect.catch(() => Effect.succeed(undefined)))),
        { concurrency: BudgetTuning.concurrency.storageRead },
      )
      return items.filter((item): item is TaskRecord => Boolean(item)).toSorted((a, b) => b.created_at - a.created_at)
    })

  const setRunning = Effect.fn("TaskRuntime.setRunning")(function* (taskID: SessionID, parentSessionID: SessionID) {
    return yield* update(parentSessionID, taskID, (draft) => {
      const timestamp = Date.now()
      draft.status = "running"
      draft.started_at = draft.started_at ?? timestamp
      draft.metadata = {
        ...(draft.metadata ?? {}),
        lease_started_at: draft.metadata?.lease_started_at ?? timestamp,
        lease_heartbeat_at: timestamp,
      }
    })
  })

  const tryStartPending = Effect.fn("TaskRuntime.tryStartPending")(function* (
    taskID: SessionID,
    parentSessionID: SessionID,
  ) {
    const started = { value: false }
    const record = yield* storage.update<TaskRecord>(taskKey(parentSessionID, taskID), (draft) => {
      if (draft.status !== "pending") return
      const timestamp = Date.now()
      started.value = true
      draft.status = "running"
      draft.started_at = draft.started_at ?? timestamp
      draft.metadata = {
        ...(draft.metadata ?? {}),
        lease_started_at: draft.metadata?.lease_started_at ?? timestamp,
        lease_heartbeat_at: timestamp,
      }
    })
    if (!started.value) return
    yield* refreshGroup(record)
    yield* publishUpdate(record)
    return record
  })

  const registerCancelHandler = Effect.fn("TaskRuntime.registerCancelHandler")(function* (input: {
    taskID: SessionID
    parentSessionID: SessionID
    cancel: () => void
  }) {
    const key = cancelHandlerKey(input.parentSessionID, input.taskID)
    return yield* Effect.sync(() => {
      cancelHandlers.set(key, input.cancel)
      return () => {
        cancelHandlers.delete(key)
      }
    })
  })

  const complete = Effect.fn("TaskRuntime.complete")(function* (input: CompleteInput) {
    return yield* update(input.parentSessionID, input.taskID, (draft) => {
      const text = input.output ?? input.result?.parts.findLast((item) => item.type === "text")?.text
      draft.status = "completed"
      draft.finished_at = Date.now()
      draft.result_summary = summarizeMessage(text)
      draft.error_summary = undefined
      draft.metadata = {
        ...(draft.metadata ?? {}),
        ...(input.metadata ?? {}),
        result_text: fullMessageText(text),
      }
      if (draft.metadata?.output_schema === "revise" || draft.metadata?.role === "reviser") {
        draft.metadata = {
          ...draft.metadata,
          review_text: fullMessageText(text),
        }
      }
      if (input.result?.info.role === "assistant") {
        const usage = normalizedUsage(input.result.info)
        draft.usage = {
          ...usage,
          durationMs:
            draft.started_at && input.result.info.time.created
              ? Math.max(0, input.result.info.time.created - draft.started_at)
              : undefined,
        }
      }
    })
  })

  const partial = Effect.fn("TaskRuntime.partial")(function* (input: PartialInput) {
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
        result_text: fullMessageText(text),
        remaining_scope: input.remainingScope ?? draft.acceptance_checks ?? draft.read_scope ?? draft.write_scope,
      }
      if (input.result?.info.role === "assistant") {
        const usage = normalizedUsage(input.result.info)
        draft.usage = {
          ...usage,
          durationMs:
            draft.started_at && input.result.info.time.created
              ? Math.max(0, input.result.info.time.created - draft.started_at)
              : undefined,
        }
      }
    })
  })

  const fail = Effect.fn("TaskRuntime.fail")(function* (input: FailInput) {
    return yield* update(input.parentSessionID, input.taskID, (draft) => {
      draft.status = "failed"
      draft.finished_at = Date.now()
      draft.error_summary = input.error.slice(0, 400)
      draft.metadata = {
        ...(draft.metadata ?? {}),
        ...(input.metadata ?? {}),
      }
    })
  })

  const cancel = Effect.fn("TaskRuntime.cancel")(function* (input: CancelInput) {
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

  const retry = Effect.fn("TaskRuntime.retry")(function* (input: { taskID: SessionID; parentSessionID: SessionID }) {
    const current = yield* get({ taskID: input.taskID, parentSessionID: input.parentSessionID })
    if (Option.isNone(current)) return yield* Effect.fail(new Error(`Task not found: ${input.taskID}`))
    if (
      current.value.status !== "failed" &&
      current.value.status !== "cancelled" &&
      current.value.status !== "partial"
    ) {
      return yield* Effect.fail(new Error(`Task cannot be retried from state: ${current.value.status}`))
    }
    return yield* update(input.parentSessionID, input.taskID, (draft) => {
      const previous = Array.isArray(draft.metadata?.recovery_checkpoints)
        ? draft.metadata.recovery_checkpoints.filter(
            (item): item is ReturnType<typeof recoveryCheckpointFor> =>
              typeof item === "object" && item !== null && !Array.isArray(item),
          )
        : []
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
          recovery_checkpoints: [...previous, recoveryCheckpointFor(current.value)].slice(-5),
          partial: undefined,
          retryable: undefined,
          limit_reason: undefined,
          partial_summary: undefined,
          result_text: undefined,
          remaining_scope: undefined,
          review_text: undefined,
        }
      }
    })
  })

  return {
    create,
    setRunning,
    tryStartPending,
    registerCancelHandler,
    complete,
    partial,
    fail,
    cancel,
    retry,
  }
}
