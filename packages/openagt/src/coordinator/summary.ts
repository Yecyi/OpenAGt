// Computes coordinator run summary text and terminal state from task records.
// It does not read storage, update plans, publish events, or mutate runs.
import { TaskRuntime } from "@/session/task-runtime"
import type { CoordinatorRunState } from "./schema"

type SummaryCounts = {
  completed: number
  partial: number
  failed: number
  running: number
  pending: number
  cancelled: number
}

export function coordinatorSummaryCounts(tasks: TaskRuntime.TaskRecord[]): SummaryCounts {
  return {
    completed: tasks.filter((item) => item.status === "completed").length,
    partial: tasks.filter((item) => item.status === "partial").length,
    failed: tasks.filter((item) => item.status === "failed").length,
    running: tasks.filter((item) => item.status === "running").length,
    pending: tasks.filter((item) => item.status === "pending").length,
    cancelled: tasks.filter((item) => item.status === "cancelled").length,
  }
}

export function coordinatorSummaryText(input: { total: number; counts: SummaryCounts }): string {
  return `${input.counts.completed}/${input.total} completed, ${input.counts.partial} partial, ${input.counts.running} running, ${input.counts.pending} pending, ${input.counts.failed} failed, ${input.counts.cancelled} cancelled`
}

export function coordinatorStateFromSummary(input: { total: number; counts: SummaryCounts }): CoordinatorRunState {
  if (input.counts.failed > 0) return "failed"
  if (input.counts.cancelled > 0 && input.counts.completed + input.counts.cancelled === input.total) return "cancelled"
  if (input.counts.completed === input.total && input.total > 0) return "completed"
  if (input.counts.running === 0 && (input.counts.pending > 0 || input.counts.partial > 0)) return "blocked"
  return "active"
}

export function buildCoordinatorSummary(tasks: TaskRuntime.TaskRecord[]): {
  counts: SummaryCounts
  summary: string
  state: CoordinatorRunState
} {
  const counts = coordinatorSummaryCounts(tasks)
  return {
    counts,
    summary: coordinatorSummaryText({ total: tasks.length, counts }),
    state: coordinatorStateFromSummary({ total: tasks.length, counts }),
  }
}
