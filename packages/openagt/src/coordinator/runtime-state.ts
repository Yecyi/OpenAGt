import { TaskRuntime } from "@/session/task-runtime"
import { scaleResourceLimit } from "./budget-governance"
import { reviewFailureMessage, reviewVerdictForTask } from "./review-verdict"
import {
  BudgetState,
  CheckpointMemorySummary,
  ContinuationRequest,
  CoordinatorPlan,
  ProgressSnapshot,
  ResourceLimit,
  TodoTimeline,
  type CoordinatorPlan as CoordinatorPlanType,
  type CoordinatorRun as CoordinatorRunType,
  type ProgressSnapshot as ProgressSnapshotType,
  type ResourceLimit as ResourceLimitType,
  type TodoTimeline as TodoTimelineType,
} from "./schema"
import { nodeIDForTask } from "./task-record"

// Runtime overlays for coordinator plans: task-derived statuses, progress, budget, and checkpoint summaries.
// This module does not dispatch tasks, publish events, or persist coordinator runs.

function now() {
  return Date.now()
}

function todoStatusFromTasks(items: TaskRuntime.TaskRecord[]) {
  if (items.length === 0) return "pending" as const
  if (items.some((item) => item.status === "failed")) return "blocked" as const
  if (items.some((item) => item.status === "cancelled")) return "skipped" as const
  if (items.some((item) => item.status === "partial")) return "partial" as const
  if (items.every((item) => item.status === "completed")) return "done" as const
  if (items.some((item) => item.status === "running")) return "active" as const
  if (items.some((item) => item.status === "completed")) return "partial" as const
  return "pending" as const
}

function runtimeTodoTimeline(plan: CoordinatorPlanType, taskByNode: Map<string, TaskRuntime.TaskRecord>) {
  return TodoTimeline.parse({
    ...plan.todo_timeline,
    todos: plan.todo_timeline.todos.map((item) => ({
      ...item,
      status: todoStatusFromTasks(
        item.node_ids.flatMap((id) => {
          const task = taskByNode.get(id)
          return task ? [task] : []
        }),
      ),
    })),
  })
}

function progressSnapshotFor(input: {
  todoTimeline: TodoTimelineType
  taskList: TaskRuntime.TaskRecord[]
  qualityGates: CoordinatorPlanType["quality_gates"]
}) {
  const totalWeight = input.todoTimeline.todos.reduce((acc, item) => acc + item.budget_weight, 0)
  const doneWeight = input.todoTimeline.todos
    .filter((item) => item.status === "done")
    .reduce((acc, item) => acc + item.budget_weight, 0)
  const partialWeight = input.todoTimeline.todos
    .filter((item) => item.status === "partial" || item.status === "active")
    .reduce((acc, item) => acc + item.budget_weight * 0.5, 0)
  const failed = input.taskList.filter((item) => item.status === "failed" || item.status === "cancelled").length
  const verifierTotal = input.qualityGates.length
  const verifierPassed = input.qualityGates.filter((item) => item.status === "passed").length
  const progress_score = totalWeight > 0 ? Math.min(1, (doneWeight + partialWeight) / totalWeight) : 0
  const failure_penalty = input.taskList.length > 0 ? failed / input.taskList.length : 0
  const verifier_quality = verifierTotal > 0 ? verifierPassed / verifierTotal : progress_score
  return ProgressSnapshot.parse({
    done: input.todoTimeline.todos.filter((item) => item.status === "done").length,
    partial: input.todoTimeline.todos.filter((item) => item.status === "partial" || item.status === "active").length,
    blocked: input.todoTimeline.todos.filter((item) => item.status === "blocked").length,
    pending: input.todoTimeline.todos.filter((item) => item.status === "pending").length,
    progress_score,
    evidence_coverage: Math.min(1, progress_score + verifier_quality * 0.2),
    verifier_quality,
    tool_success_rate: Math.max(0, 1 - failure_penalty),
    remaining_work_score: Math.max(0, 1 - progress_score),
    failure_penalty,
    confidence: progress_score >= 0.8 && verifier_quality >= 0.6 ? "high" : progress_score >= 0.4 ? "medium" : "low",
  })
}

export function resourceUsageFor(run: CoordinatorRunType, taskList: TaskRuntime.TaskRecord[], extraStarts = 0) {
  const started = taskList.filter((item) => item.status !== "pending")
  return ResourceLimit.parse({
    max_rounds: started.length + extraStarts,
    max_model_calls: started.length + extraStarts,
    max_tool_calls:
      taskList.reduce((acc, item) => acc + (item.usage?.toolUses ?? (item.status === "completed" ? 1 : 0)), 0) +
      extraStarts,
    max_subagents: started.length + extraStarts,
    max_wallclock_ms: Math.max(0, now() - run.time.created),
    max_estimated_tokens: taskList.reduce((acc, item) => acc + (item.usage?.totalTokens ?? 0), 0),
  })
}

function limitUsed(usage: ResourceLimitType, limit: ResourceLimitType) {
  return Math.min(
    1,
    Math.max(
      limit.max_rounds <= 0 ? (usage.max_rounds > 0 ? 1 : 0) : usage.max_rounds / limit.max_rounds,
      limit.max_model_calls <= 0 ? (usage.max_model_calls > 0 ? 1 : 0) : usage.max_model_calls / limit.max_model_calls,
      limit.max_tool_calls <= 0 ? (usage.max_tool_calls > 0 ? 1 : 0) : usage.max_tool_calls / limit.max_tool_calls,
      limit.max_subagents <= 0 ? (usage.max_subagents > 0 ? 1 : 0) : usage.max_subagents / limit.max_subagents,
      limit.max_wallclock_ms <= 0
        ? usage.max_wallclock_ms > 0
          ? 1
          : 0
        : usage.max_wallclock_ms / limit.max_wallclock_ms,
      limit.max_estimated_tokens <= 0
        ? usage.max_estimated_tokens > 0
          ? 1
          : 0
        : usage.max_estimated_tokens / limit.max_estimated_tokens,
    ),
  )
}

export function subtractResourceLimit(left: ResourceLimitType, right: ResourceLimitType) {
  return ResourceLimit.parse({
    max_rounds: left.max_rounds > right.max_rounds ? left.max_rounds - right.max_rounds : left.max_rounds,
    max_model_calls:
      left.max_model_calls > right.max_model_calls ? left.max_model_calls - right.max_model_calls : left.max_model_calls,
    max_tool_calls:
      left.max_tool_calls > right.max_tool_calls ? left.max_tool_calls - right.max_tool_calls : left.max_tool_calls,
    max_subagents: left.max_subagents > right.max_subagents ? left.max_subagents - right.max_subagents : left.max_subagents,
    max_wallclock_ms:
      left.max_wallclock_ms > right.max_wallclock_ms
        ? left.max_wallclock_ms - right.max_wallclock_ms
        : left.max_wallclock_ms,
    max_estimated_tokens:
      left.max_estimated_tokens > right.max_estimated_tokens
        ? left.max_estimated_tokens - right.max_estimated_tokens
        : left.max_estimated_tokens,
  })
}

export function resourceLimitSlots(usage: ResourceLimitType, limit: ResourceLimitType) {
  if (usage.max_wallclock_ms >= limit.max_wallclock_ms) return 0
  if (usage.max_estimated_tokens >= limit.max_estimated_tokens) return 0
  return Math.max(
    0,
    Math.min(
      limit.max_rounds - usage.max_rounds,
      limit.max_model_calls - usage.max_model_calls,
      limit.max_tool_calls - usage.max_tool_calls,
      limit.max_subagents - usage.max_subagents,
    ),
  )
}

export function todoForNode(plan: CoordinatorPlanType, nodeID: string | undefined) {
  if (!nodeID) return
  return plan.todo_timeline.todos.find((item) => item.node_ids.includes(nodeID))
}

export function todoUsageFor(run: CoordinatorRunType, taskList: TaskRuntime.TaskRecord[], todoID: string | undefined) {
  if (!todoID) return resourceUsageFor(run, taskList)
  const nodeIDs = run.plan.todo_timeline.todos.find((item) => item.id === todoID)?.node_ids ?? []
  return resourceUsageFor(
    run,
    taskList.filter((item) => {
      const nodeID = nodeIDForTask(item)
      return nodeID ? nodeIDs.includes(nodeID) : false
    }),
  )
}

function budgetStateFor(input: {
  run: CoordinatorRunType
  plan: CoordinatorPlanType
  taskList: TaskRuntime.TaskRecord[]
  progressSnapshot: ProgressSnapshotType
}) {
  const usage = resourceUsageFor(input.run, input.taskList)
  const softBudgetUsed = limitUsed(usage, input.plan.budget_profile.mission_ceiling)
  const absoluteUsed = limitUsed(usage, input.plan.budget_profile.absolute_ceiling)
  return BudgetState.parse({
    soft_budget_used: softBudgetUsed,
    absolute_ceiling_used: absoluteUsed,
    checkpoint_count: input.taskList.filter(
      (item) => item.metadata?.coordinator_node_id === "budget_checkpoint_synthesis" && item.status === "completed",
    ).length,
    budget_limited: input.plan.budget_limited || softBudgetUsed >= 1,
    ceiling_hit: absoluteUsed >= 1,
  })
}

function checkpointMemoryFor(input: {
  run: CoordinatorRunType
  todoTimeline: TodoTimelineType
  progressSnapshot: ProgressSnapshotType
}) {
  return CheckpointMemorySummary.parse({
    run_id: input.run.id,
    checkpoint_id: `checkpoint_${input.run.time.updated}`,
    todo_state: input.todoTimeline.todos,
    completed_artifacts: input.todoTimeline.todos.filter((item) => item.status === "done").map((item) => item.title),
    evidence_index: input.todoTimeline.todos
      .filter((item) => item.status === "done" || item.status === "partial" || item.status === "active")
      .map((item) => `${item.id}:${item.node_ids.join(",")}`),
    unresolved_claims: input.todoTimeline.todos
      .filter((item) => item.status === "partial" || item.status === "pending")
      .map((item) => item.title),
    blocked_reasons: input.todoTimeline.todos.filter((item) => item.status === "blocked").map((item) => item.title),
    quality_scores: {
      progress_score: input.progressSnapshot.progress_score,
      evidence_coverage: input.progressSnapshot.evidence_coverage,
      verifier_quality: input.progressSnapshot.verifier_quality,
      tool_success_rate: input.progressSnapshot.tool_success_rate,
    },
    next_recommended_todos: input.todoTimeline.todos
      .filter((item) => item.status === "pending" || item.status === "partial" || item.status === "blocked")
      .slice(0, 5)
      .map((item) => item.id),
    compressed_context: `Progress ${Math.round(input.progressSnapshot.progress_score * 100)}%, evidence ${Math.round(input.progressSnapshot.evidence_coverage * 100)}%, confidence ${input.progressSnapshot.confidence}.`,
  })
}

function continuationRequestFor(input: {
  plan: CoordinatorPlanType
  todoTimeline: TodoTimelineType
  budgetState: CoordinatorPlanType["budget_state"]
  progressSnapshot: ProgressSnapshotType
}) {
  const next = input.todoTimeline.todos
    .filter((item) => item.status === "pending" || item.status === "partial" || item.status === "blocked")
    .slice(0, 5)
  if (!input.budgetState.ceiling_hit && (!input.budgetState.budget_limited || next.length === 0)) return undefined
  return ContinuationRequest.parse({
    reason: input.budgetState.ceiling_hit
      ? "Absolute ceiling reached before all todo timeline items finished."
      : "Mission budget checkpoint reached with unfinished timeline items.",
    requested_budget_delta: scaleResourceLimit(input.plan.budget_profile.single_checkpoint_ceiling, 0.5),
    next_todos: next.map((item) => item.id),
    expected_value:
      input.progressSnapshot.progress_score >= 0.5
        ? "Continue targeted work on remaining high-value todo items using existing checkpoint memory."
        : "Continue only if the unfinished todo items are still valuable to the user.",
    requires_user_approval: input.budgetState.ceiling_hit || input.plan.budget_profile.auto_continue !== "safe",
  })
}

function taskByNodeFor(taskList: TaskRuntime.TaskRecord[]) {
  return new Map(
    taskList.flatMap((item) => {
      const nodeID =
        typeof item.metadata?.coordinator_node_id === "string" ? item.metadata.coordinator_node_id : undefined
      return nodeID ? [[nodeID, item] as const] : []
    }),
  )
}

function gateStatusFor(taskByNode: Map<string, TaskRuntime.TaskRecord>, nodeID?: string) {
  const task = nodeID ? taskByNode.get(nodeID) : undefined
  if (!task) return "pending" as const
  if (task.status === "completed")
    return reviewFailureMessage(reviewVerdictForTask(task)) ? ("failed" as const) : ("passed" as const)
  if (task.status === "partial") return task.metadata?.retryable === true ? ("pending" as const) : ("failed" as const)
  if (task.status === "failed") return "failed" as const
  if (task.status === "cancelled") return "skipped" as const
  return task.status
}

export function runtimeStateFor(run: CoordinatorRunType, taskList: TaskRuntime.TaskRecord[]) {
  const taskByNode = taskByNodeFor(taskList)
  const revise_points = run.plan.revise_points.map((item) => ({
    ...item,
    status: gateStatusFor(taskByNode, item.node_id),
  }))
  const quality_gates = run.plan.quality_gates.map((item) => ({
    ...item,
    status: gateStatusFor(taskByNode, item.node_id),
  }))
  const todo_timeline = runtimeTodoTimeline(run.plan, taskByNode)
  const progress_snapshot = progressSnapshotFor({
    todoTimeline: todo_timeline,
    taskList,
    qualityGates: quality_gates,
  })
  const budget_state = budgetStateFor({ run, plan: run.plan, taskList, progressSnapshot: progress_snapshot })
  const checkpoint_memory = checkpointMemoryFor({
    run,
    todoTimeline: todo_timeline,
    progressSnapshot: progress_snapshot,
  })
  const continuation_request = continuationRequestFor({
    plan: run.plan,
    todoTimeline: todo_timeline,
    budgetState: budget_state,
    progressSnapshot: progress_snapshot,
  })
  return {
    taskByNode,
    revise_points,
    quality_gates,
    todo_timeline,
    progress_snapshot,
    budget_state,
    checkpoint_memory,
    continuation_request,
  }
}

export function planWithRuntimeState(
  plan: CoordinatorPlanType,
  runtime: Omit<ReturnType<typeof runtimeStateFor>, "taskByNode">,
) {
  return CoordinatorPlan.parse({
    ...plan,
    revise_points: runtime.revise_points,
    quality_gates: runtime.quality_gates,
    todo_timeline: runtime.todo_timeline,
    budget_state: runtime.budget_state,
    progress_snapshot: runtime.progress_snapshot,
    checkpoint_memory: runtime.checkpoint_memory,
    continuation_request: runtime.continuation_request,
    budget_limited: plan.budget_limited,
  })
}
