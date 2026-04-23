import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import type { SessionID } from "@/session/schema"
import type { CoordinatorRunID } from "./schema"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const CoordinatorRunTable = sqliteTable(
  "coordinator_run",
  {
    id: text().$type<CoordinatorRunID>().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    goal: text().notNull(),
    state: text().notNull(),
    plan: text({ mode: "json" }).notNull(),
    task_ids: text({ mode: "json" }).notNull().$type<SessionID[]>(),
    summary: text(),
    time_finished: integer(),
    ...Timestamps,
  },
  (table) => [index("coordinator_session_idx").on(table.session_id), index("coordinator_state_idx").on(table.state)],
)
