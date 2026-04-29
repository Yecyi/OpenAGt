// Coordinator run row mapper from database shape to runtime schema.
// This file does not query or mutate storage.

import { CoordinatorRunTable } from "./coordinator.sql"
import { settleIntentProfile } from "./intent-profile"
import { CoordinatorMode, CoordinatorPlan, CoordinatorRun, IntentProfile, TaskType } from "./schema"
import type { CoordinatorRun as CoordinatorRunType } from "./schema"

export function runFromRow(row: typeof CoordinatorRunTable.$inferSelect): CoordinatorRunType {
  const intent = IntentProfile.safeParse(row.intent)
  const mode = CoordinatorMode.safeParse(row.mode)
  const workflow = TaskType.safeParse(row.workflow)
  const plan = CoordinatorPlan.parse(row.plan)
  const fallback = settleIntentProfile({ goal: row.goal })
  return CoordinatorRun.parse({
    id: row.id,
    sessionID: row.session_id,
    goal: row.goal,
    intent: intent.success ? intent.data : fallback,
    mode: mode.success ? mode.data : "autonomous",
    workflow: workflow.success ? workflow.data : fallback.workflow,
    effort: plan.effort,
    effort_profile: plan.effort_profile,
    state: row.state,
    plan,
    task_ids: row.task_ids,
    summary: row.summary ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      finished: row.time_finished ?? undefined,
    },
  })
}
