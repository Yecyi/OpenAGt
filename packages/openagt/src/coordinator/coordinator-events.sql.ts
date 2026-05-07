import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { SessionID } from "@/session/schema"
import type { CoordinatorRunID } from "./schema"
import { Timestamps } from "@/storage/schema.sql"

export const CoordinatorEventTable = sqliteTable(
  "coordinator_event",
  {
    event_id: text().primaryKey(),
    ts: integer().notNull(),
    session_id: text().$type<SessionID>().notNull(),
    run_id: text().$type<CoordinatorRunID>(),
    task_id: text(),
    expert_id: text(),
    workflow: text(),
    effort: text(),
    event_kind: text().notNull(),
    payload_json: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    schema_version: integer().notNull(),
    idempotency_key: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("coordinator_event_session_ts_idx").on(table.session_id, table.ts),
    index("coordinator_event_run_ts_idx").on(table.run_id, table.ts),
    index("coordinator_event_kind_ts_idx").on(table.event_kind, table.ts),
    index("coordinator_event_expert_workflow_idx").on(table.expert_id, table.workflow),
    uniqueIndex("coordinator_event_idempotency_idx").on(table.idempotency_key),
  ],
)
