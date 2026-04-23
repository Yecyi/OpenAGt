import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import type { ProjectID } from "@/project/schema"
import type { SessionID } from "@/session/schema"
import type { InboxItemID, MemoryNoteID, ScheduledWakeupID } from "./schema"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const PersonalMemoryNoteTable = sqliteTable(
  "personal_memory_note",
  {
    id: text().$type<MemoryNoteID>().primaryKey(),
    scope: text().notNull(),
    project_id: text().$type<ProjectID>().references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionID>().references(() => SessionTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    content: text().notNull(),
    tags: text({ mode: "json" }).$type<string[]>().notNull(),
    source: text().notNull(),
    importance: integer().notNull().default(0),
    pinned: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("personal_memory_scope_idx").on(table.scope),
    index("personal_memory_project_idx").on(table.project_id),
    index("personal_memory_session_idx").on(table.session_id),
  ],
)

export const InboxItemTable = sqliteTable(
  "inbox_item",
  {
    id: text().$type<InboxItemID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionID>().references(() => SessionTable.id, { onDelete: "cascade" }),
    source: text().notNull(),
    scope: text().notNull(),
    goal: text().notNull(),
    context_refs: text({ mode: "json" }).$type<string[]>().notNull(),
    priority: text().notNull(),
    state: text().notNull(),
    scheduled_for: integer(),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("inbox_project_idx").on(table.project_id),
    index("inbox_session_idx").on(table.session_id),
    index("inbox_state_idx").on(table.state),
  ],
)

export const ScheduledWakeupTable = sqliteTable(
  "scheduled_wakeup",
  {
    id: text().$type<ScheduledWakeupID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionID>().references(() => SessionTable.id, { onDelete: "cascade" }),
    inbox_item_id: text().$type<InboxItemID>().references(() => InboxItemTable.id, { onDelete: "set null" }),
    goal: text().notNull(),
    context_refs: text({ mode: "json" }).$type<string[]>().notNull(),
    priority: text().notNull(),
    scheduled_for: integer().notNull(),
    state: text().notNull(),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>(),
    time_fired: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("wakeup_project_idx").on(table.project_id),
    index("wakeup_state_idx").on(table.state),
    index("wakeup_scheduled_for_idx").on(table.scheduled_for),
  ],
)
