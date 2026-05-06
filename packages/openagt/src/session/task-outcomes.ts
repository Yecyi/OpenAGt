import { and, desc, eq } from "drizzle-orm"
import { Effect, Option } from "effect"
import { Identifier } from "@/id/id"
import * as Database from "@/storage/db"
import type { SessionID } from "./schema"
import type { TaskRecord } from "./task-runtime"
import { TaskOutcomeTable } from "./task-outcome.sql"

export type TaskOutcome = typeof TaskOutcomeTable.$inferSelect

function stringMetadata(record: TaskRecord, key: string) {
  const value = record.metadata?.[key]
  return typeof value === "string" && value.trim() ? value : undefined
}

function booleanMetadata(record: TaskRecord, key: string) {
  return record.metadata?.[key] === true
}

function outcomeText(record: TaskRecord) {
  return stringMetadata(record, "result_text") ?? stringMetadata(record, "partial_summary")
}

function outcomeError(record: TaskRecord) {
  return record.status === "failed" || record.status === "cancelled" ? record.error_summary : undefined
}

function outcomeSummary(record: TaskRecord) {
  return record.result_summary ?? record.error_summary ?? `Task ${record.status}`
}

function latestInTransaction(db: Database.TxOrDb, parentSessionID: SessionID, taskID: SessionID) {
  return db
    .select()
    .from(TaskOutcomeTable)
    .where(and(eq(TaskOutcomeTable.parent_session_id, parentSessionID), eq(TaskOutcomeTable.task_id, taskID)))
    .orderBy(desc(TaskOutcomeTable.attempt_no), desc(TaskOutcomeTable.time_recorded))
    .limit(1)
    .get()
}

export const latestTaskOutcome = Effect.fn("TaskOutcome.latest")(function* (input: {
  parentSessionID: SessionID
  taskID: SessionID
}) {
  return yield* Effect.sync(() =>
    Database.use((db) => {
      const row = latestInTransaction(db, input.parentSessionID, input.taskID)
      return row ? Option.some(row) : Option.none<TaskOutcome>()
    }),
  )
})

export const listTaskOutcomes = Effect.fn("TaskOutcome.list")(function* (input: {
  parentSessionID: SessionID
  taskID?: SessionID
}) {
  return yield* Effect.sync(() =>
    Database.use((db) => {
      const query = db
        .select()
        .from(TaskOutcomeTable)
        .where(
          input.taskID
            ? and(eq(TaskOutcomeTable.parent_session_id, input.parentSessionID), eq(TaskOutcomeTable.task_id, input.taskID))
            : eq(TaskOutcomeTable.parent_session_id, input.parentSessionID),
        )
        .orderBy(desc(TaskOutcomeTable.time_recorded), desc(TaskOutcomeTable.id))
      return query.all()
    }),
  )
})

export const recordTaskOutcome = Effect.fn("TaskOutcome.record")(function* (record: TaskRecord) {
  return yield* Effect.sync(() =>
    Database.transaction(
      (db) => {
        const latest = latestInTransaction(db, record.parent_session_id, record.task_id)
        const time = Date.now()
        const resultText = outcomeText(record)
        const errorText = outcomeError(record)
        const retryable = booleanMetadata(record, "retryable") || record.status === "partial"
        db.insert(TaskOutcomeTable)
          .values({
            id: Identifier.ascending("taskOutcome"),
            parent_session_id: record.parent_session_id,
            task_id: record.task_id,
            child_session_id: record.child_session_id,
            status: record.status,
            task_kind: record.task_kind,
            subagent_type: record.subagent_type,
            description: record.description,
            attempt_no: (latest?.attempt_no ?? 0) + 1,
            previous_outcome_id: latest?.id,
            retryable: retryable ? 1 : 0,
            limit_reason: stringMetadata(record, "limit_reason") ?? record.stop_reason,
            summary: outcomeSummary(record),
            result_text: resultText,
            error_text: errorText,
            metadata: record.metadata ?? {},
            usage: record.usage,
            time_recorded: time,
            time_created: time,
            time_updated: time,
          })
          .run()
      },
      { behavior: "immediate" },
    ),
  )
})
