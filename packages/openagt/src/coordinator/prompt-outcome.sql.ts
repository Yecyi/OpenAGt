import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

// Prompt-outcome telemetry — C.5 of the v1.21 plan.
//
// One row per (role, variant, task) triple capturing whether the chosen
// prompt template produced a successful artifact downstream. Powers the
// Thompson sampling-lite picker in `pickWithHistory()` and the per-variant
// Brier dashboard.
//
// `success` is 0/1; `quality` is an optional [0, 1] soft signal (e.g. user
// thumbs ratio or verifier confidence). Both feed Beta(s+1, f+1) sampling.
export const PromptOutcomeTable = sqliteTable(
  "prompt_outcome",
  {
    id: text().primaryKey(),
    role: text().notNull(),
    variant: text().notNull(),
    task_id: text(),
    expert_id: text(),
    success: integer().notNull(), // 0 or 1
    quality: real(),
    duration_ms: integer(),
    time_recorded: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("prompt_outcome_role_variant_idx").on(table.role, table.variant),
    index("prompt_outcome_time_recorded_idx").on(table.time_recorded),
  ],
)
