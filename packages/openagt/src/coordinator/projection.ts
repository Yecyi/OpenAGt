// Builds coordinator projection DTOs from an already-loaded run, task list, and runtime overlay.
// It does not read storage, dispatch tasks, publish events, or mutate coordinator state.
import { TaskRuntime } from "@/session/task-runtime"
import type {
  BudgetProfile as BudgetProfileType,
  CheckpointMemorySummary as CheckpointMemorySummaryType,
  CoordinatorPlan as CoordinatorPlanType,
  CoordinatorRun as CoordinatorRunType,
  EffortProfile as EffortProfileType,
  LongTaskProfile as LongTaskProfileType,
  ProgressSnapshot as ProgressSnapshotType,
  TodoTimeline as TodoTimelineType,
} from "./schema"
import type { runtimeStateFor } from "./runtime-state"

type TaskStatus = "pending" | "running" | "completed" | "partial" | "failed" | "cancelled"
type MergeStatus = "none" | "waiting" | "merged" | "conflict"

export type CoordinatorProjection = {
  run: CoordinatorRunType
  tasks: TaskRuntime.TaskRecord[]
  counts: Record<TaskStatus, number>
  groups: Array<{
    id: string
    node_ids: string[]
    task_ids: string[]
    status: TaskStatus
    merge_status: MergeStatus
    blocked_by: string[]
    conflicts: string[]
    started_at?: number
    completed_at?: number
  }>
  expert_lanes: CoordinatorPlanType["expert_lanes"]
  quality_gates: CoordinatorPlanType["quality_gates"]
  revise_points: CoordinatorPlanType["revise_points"]
  memory_context: CoordinatorPlanType["memory_context"]
  effort_profile: EffortProfileType
  long_task: LongTaskProfileType
  todo_timeline: TodoTimelineType
  budget_profile: BudgetProfileType
  budget_state: CoordinatorPlanType["budget_state"]
  progress_snapshot: ProgressSnapshotType
  checkpoint_memory: CheckpointMemorySummaryType
  continuation_request?: CoordinatorPlanType["continuation_request"]
  budget_limited: boolean
  specialization_fallback: boolean
}

function statusFor(items: TaskRuntime.TaskRecord[]): TaskStatus {
  if (items.some((item) => item.status === "failed")) return "failed"
  if (items.some((item) => item.status === "cancelled")) return "cancelled"
  if (items.some((item) => item.status === "partial")) return "partial"
  if (items.every((item) => item.status === "completed")) return "completed"
  if (items.some((item) => item.status === "running")) return "running"
  return "pending"
}

export function buildCoordinatorProjection(input: {
  run: CoordinatorRunType
  taskList: TaskRuntime.TaskRecord[]
  runtime: ReturnType<typeof runtimeStateFor>
}): CoordinatorProjection {
  const taskByNode = input.runtime.taskByNode
  const groupIDs = [
    ...new Set(input.run.plan.nodes.flatMap((item) => (item.parallel_group ? [item.parallel_group] : []))),
  ]
  const groups = groupIDs.map((groupID) => {
    const nodes = input.run.plan.nodes.filter((item) => item.parallel_group === groupID)
    const groupTasks = nodes.flatMap((item) => {
      const task = taskByNode.get(item.id)
      return task ? [task] : []
    })
    const blocked_by = nodes.flatMap((item) =>
      item.depends_on.filter((dependency) => taskByNode.get(dependency)?.status !== "completed"),
    )
    const started = groupTasks.flatMap((item) => (item.started_at ? [item.started_at] : []))
    const finished = groupTasks.flatMap((item) => (item.finished_at ? [item.finished_at] : []))
    const reducer = input.run.plan.nodes.find(
      (item) =>
        item.depends_on.some((dependency) => nodes.some((node) => node.id === dependency)) && item.role === "reducer",
    )
    const reducerTask = reducer ? taskByNode.get(reducer.id) : undefined
    const conflicts = nodes.flatMap((item) => item.conflicts)
    const merge_status: MergeStatus =
      conflicts.length > 0
        ? "conflict"
        : reducerTask?.status === "completed"
          ? "merged"
          : reducer
            ? "waiting"
            : "none"
    return {
      id: groupID,
      node_ids: nodes.map((item) => item.id),
      task_ids: groupTasks.map((item) => item.task_id),
      status: groupTasks.length > 0 ? statusFor(groupTasks) : "pending",
      merge_status,
      blocked_by: [...new Set(blocked_by)],
      conflicts,
      started_at: started.length ? Math.min(...started) : undefined,
      completed_at:
        groupTasks.length > 0 && groupTasks.every((item) => item.finished_at) ? Math.max(...finished) : undefined,
    }
  })
  return {
    run: input.run,
    tasks: input.taskList,
    counts: {
      pending: input.taskList.filter((item) => item.status === "pending").length,
      running: input.taskList.filter((item) => item.status === "running").length,
      completed: input.taskList.filter((item) => item.status === "completed").length,
      partial: input.taskList.filter((item) => item.status === "partial").length,
      failed: input.taskList.filter((item) => item.status === "failed").length,
      cancelled: input.taskList.filter((item) => item.status === "cancelled").length,
    },
    groups,
    expert_lanes: input.run.plan.expert_lanes,
    quality_gates: input.runtime.quality_gates,
    revise_points: input.runtime.revise_points,
    memory_context: input.run.plan.memory_context,
    effort_profile: input.run.plan.effort_profile,
    long_task: input.run.plan.long_task,
    todo_timeline: input.runtime.todo_timeline,
    budget_profile: input.run.plan.budget_profile,
    budget_state: input.runtime.budget_state,
    progress_snapshot: input.runtime.progress_snapshot,
    checkpoint_memory: input.runtime.checkpoint_memory,
    continuation_request: input.runtime.continuation_request,
    budget_limited: input.runtime.budget_state.budget_limited,
    specialization_fallback: input.run.plan.specialization_fallback,
  }
}
