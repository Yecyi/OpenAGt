import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"
import type { SessionID } from "./schema"
import type { TaskStatus } from "./task-runtime"

export const TaskOutcomeTable = sqliteTable(
  "task_outcome",
  {
    id: text().primaryKey(),
    parent_session_id: text().$type<SessionID>().notNull(),
    task_id: text().$type<SessionID>().notNull(),
    child_session_id: text().$type<SessionID>().notNull(),
    status: text().$type<TaskStatus>().notNull(),
    task_kind: text().notNull(),
    subagent_type: text().notNull(),
    description: text().notNull(),
    attempt_no: integer().notNull(),
    previous_outcome_id: text(),
    retryable: integer().notNull().default(0),
    limit_reason: text(),
    summary: text(),
    result_text: text(),
    error_text: text(),
    verdict: text({ mode: "json" }).$type<Record<string, unknown>>(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    usage: text({ mode: "json" }).$type<Record<string, unknown>>(),
    time_recorded: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("task_outcome_parent_task_idx").on(table.parent_session_id, table.task_id),
    index("task_outcome_parent_status_idx").on(table.parent_session_id, table.status),
    index("task_outcome_task_attempt_idx").on(table.task_id, table.attempt_no),
    index("task_outcome_time_recorded_idx").on(table.time_recorded),
  ],
)
