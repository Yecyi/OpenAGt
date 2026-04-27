import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

// Calibration record table — A.4 of the v1.21 plan.
// One row per (expert, observation) pair. Brier score is precomputed at
// insert time so meanBrier() over a time window is a simple AVG without
// recomputation. Outcome is in [0,1] to allow soft signals (verifier
// confidence, user thumbs up/down → 0/1) — not just binary.
export const CalibrationRecordTable = sqliteTable(
  "calibration_record",
  {
    id: text().primaryKey(),
    expert_id: text().notNull(),
    workflow: text().notNull(),
    prior: real().notNull(),
    posterior: real().notNull(),
    outcome: real().notNull(),
    brier: real().notNull(),
    time_recorded: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("calibration_expert_idx").on(table.expert_id),
    index("calibration_workflow_idx").on(table.workflow),
    index("calibration_time_recorded_idx").on(table.time_recorded),
  ],
)
