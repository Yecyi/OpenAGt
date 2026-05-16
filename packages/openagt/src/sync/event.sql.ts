import { index, sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const EventSequenceTable = sqliteTable("event_sequence", {
  aggregate_id: text().notNull().primaryKey(),
  seq: integer().notNull(),
})

export const EventTable = sqliteTable(
  "event",
  {
    id: text().primaryKey(),
    aggregate_id: text()
      .notNull()
      .references(() => EventSequenceTable.aggregate_id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    type: text().notNull(),
    data: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
  },
  (table) => [index("event_aggregate_seq_idx").on(table.aggregate_id, table.seq)],
)

export const EventSnapshotTable = sqliteTable(
  "event_snapshot",
  {
    id: text().primaryKey(),
    aggregate_id: text()
      .notNull()
      .references(() => EventSequenceTable.aggregate_id, { onDelete: "cascade" }),
    adapter_id: text().notNull(),
    seq: integer().notNull(),
    schema_version: integer().notNull(),
    projector_version: text().notNull(),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [
    index("event_snapshot_aggregate_seq_idx").on(table.aggregate_id, table.seq),
    index("event_snapshot_adapter_idx").on(table.adapter_id, table.aggregate_id),
  ],
)
