export * as CoordinatorDebugStats from "./debug-stats"

import { CoordinatorEvents } from "./events"
import { Database } from "@/storage"

export type DebugStats = {
  schema_version: 1
  generated_at: string
  window_ms: number
  since: number
  task_success_rate: Array<{
    expert_id: string
    workflow: string
    total: number
    success_rate: number
  }>
  revise_loop_depth: Array<{
    workflow: string
    p50: number
    p95: number
    samples: number
  }>
  continuation_outcome: Array<{
    reason: string
    has_progress: boolean
    total: number
    progress_rate: number
  }>
  budget_efficiency: Array<{
    workflow: string
    effort: string
    samples: number
    efficiency: number
  }>
}

type TaskSuccessRow = {
  expert_id: string | null
  workflow: string | null
  total: number
  success_rate: number
}

type ReviseRow = {
  workflow: string | null
  depth: number | null
}

type ContinuationRow = {
  reason: string | null
  has_progress: number | null
  total: number
  progress_rate: number
}

type BudgetRow = {
  workflow: string | null
  effort: string | null
  samples: number
  efficiency: number | null
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] ?? 0
}

function reviseDepth(rows: ReviseRow[]) {
  const groups = new Map<string, number[]>()
  for (const item of rows) {
    const workflow = item.workflow ?? "unknown"
    groups.set(workflow, [...(groups.get(workflow) ?? []), Number(item.depth ?? 1)])
  }
  return Array.from(groups.entries(), ([workflow, depths]) => ({
    workflow,
    p50: percentile(depths.filter((item) => Number.isFinite(item)), 0.5),
    p95: percentile(depths.filter((item) => Number.isFinite(item)), 0.95),
    samples: depths.length,
  })).toSorted((a, b) => b.samples - a.samples)
}

export function stats(windowMs: number, now = Date.now()): DebugStats {
  CoordinatorEvents.flushSync()
  const since = now - windowMs
  const sqlite = Database.Client().$client
  return {
    schema_version: 1,
    generated_at: new Date(now).toISOString(),
    window_ms: windowMs,
    since,
    task_success_rate: sqlite
      .query<TaskSuccessRow, [number]>(
        `
        SELECT
          COALESCE(expert_id, 'unknown') AS expert_id,
          COALESCE(workflow, 'unknown') AS workflow,
          COUNT(*) AS total,
          AVG(
            CASE json_extract(payload_json, '$.status')
              WHEN 'completed' THEN 1.0
              WHEN 'partial' THEN 0.5
              ELSE 0.0
            END
          ) AS success_rate
        FROM coordinator_event
        WHERE event_kind = 'task_finished' AND ts >= ?
        GROUP BY COALESCE(expert_id, 'unknown'), COALESCE(workflow, 'unknown')
        ORDER BY total DESC
        LIMIT 50
        `,
      )
      .all(since)
      .map((item) => ({
        expert_id: item.expert_id ?? "unknown",
        workflow: item.workflow ?? "unknown",
        total: Number(item.total),
        success_rate: Number(item.success_rate ?? 0),
      })),
    revise_loop_depth: reviseDepth(
      sqlite
        .query<ReviseRow, [number]>(
          `
          SELECT workflow, json_extract(payload_json, '$.round_index') AS depth
          FROM coordinator_event
          WHERE event_kind = 'revise_triggered' AND ts >= ?
          `,
        )
        .all(since),
    ),
    continuation_outcome: sqlite
      .query<ContinuationRow, [number]>(
        `
        SELECT
          COALESCE(json_extract(payload_json, '$.reason'), 'unknown') AS reason,
          COALESCE(json_extract(payload_json, '$.has_progress'), 0) AS has_progress,
          COUNT(*) AS total,
          AVG(CASE COALESCE(json_extract(payload_json, '$.has_progress'), 0) WHEN 1 THEN 1.0 ELSE 0.0 END) AS progress_rate
        FROM coordinator_event
        WHERE event_kind = 'continuation_decision' AND ts >= ?
        GROUP BY reason, has_progress
        ORDER BY total DESC
        LIMIT 50
        `,
      )
      .all(since)
      .map((item) => ({
        reason: item.reason ?? "unknown",
        has_progress: Number(item.has_progress ?? 0) === 1,
        total: Number(item.total),
        progress_rate: Number(item.progress_rate ?? 0),
      })),
    budget_efficiency: sqlite
      .query<BudgetRow, [number]>(
        `
        SELECT
          COALESCE(workflow, 'unknown') AS workflow,
          COALESCE(effort, 'unknown') AS effort,
          COUNT(*) AS samples,
          AVG(
            CAST(json_extract(payload_json, '$.quality_delta') AS REAL) /
            NULLIF(CAST(json_extract(payload_json, '$.cost_delta') AS REAL), 0)
          ) AS efficiency
        FROM coordinator_event
        WHERE event_kind = 'budget_breach' AND ts >= ?
        GROUP BY COALESCE(workflow, 'unknown'), COALESCE(effort, 'unknown')
        ORDER BY samples DESC
        LIMIT 50
        `,
      )
      .all(since)
      .map((item) => ({
        workflow: item.workflow ?? "unknown",
        effort: item.effort ?? "unknown",
        samples: Number(item.samples),
        efficiency: Number(item.efficiency ?? 0),
      })),
  }
}
