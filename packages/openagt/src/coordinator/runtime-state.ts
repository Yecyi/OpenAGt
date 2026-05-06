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
  type BudgetLimitReason as BudgetLimitReasonType,
  type CoordinatorPlan as CoordinatorPlanType,
  type CoordinatorRun as CoordinatorRunType,
  type ProgressSnapshot as ProgressSnapshotType,
  type ResourceLimit as ResourceLimitType,
  type ResourceLimitKey as ResourceLimitKeyType,
  type TodoTimeline as TodoTimelineType,
} from "./schema"
import { nodeIDForTask } from "./task-record"

// Runtime overlays for coordinator plans: task-derived statuses, progress, budget, and checkpoint summaries.
// This module does not dispatch tasks, publish events, or persist coordinator runs.

function now() {
  return Date.now()
}

const checkpointLimit = 100
const evidenceLimit = 50
const memorySliceLimit = 50
const resourceLimitKeys = [
  "max_rounds",
  "max_model_calls",
  "max_tool_calls",
  "max_subagents",
  "max_wallclock_ms",
  "max_estimated_tokens",
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function latestByCreated<T extends { created_at: number }>(items: T[], limit: number) {
  return items.toSorted((a, b) => a.created_at - b.created_at).slice(-limit)
}

export function taskLeaseFor(task: TaskRuntime.TaskRecord) {
  const profile = isRecord(task.metadata?.effort_profile) ? task.metadata.effort_profile : undefined
  const multiplier = typeof profile?.timeout_multiplier === "number" ? profile.timeout_multiplier : 1
  const threshold = Math.round(30 * 60 * 1000 * multiplier)
  const heartbeat =
    typeof task.metadata?.lease_heartbeat_at === "number"
      ? task.metadata.lease_heartbeat_at
      : typeof task.metadata?.heartbeat_at === "number"
        ? task.metadata.heartbeat_at
        : task.started_at
  const age = task.status === "running" && heartbeat ? Math.max(0, now() - heartbeat) : 0
  return {
    stale: task.status === "running" && heartbeat !== undefined && age >= threshold,
    age_ms: age,
    threshold_ms: threshold,
    heartbeat_at: heartbeat,
  }
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

function milestoneStatusFromTodos(items: Array<{ status: string }>) {
  if (items.length === 0) return "pending" as const
  if (items.some((item) => item.status === "blocked")) return "blocked" as const
  if (items.every((item) => item.status === "skipped")) return "skipped" as const
  if (items.every((item) => item.status === "done")) return "completed" as const
  if (items.some((item) => item.status === "active")) return "active" as const
  if (items.some((item) => item.status === "partial" || item.status === "done")) return "partial" as const
  return "pending" as const
}

function checkpointTypeForTask(task: TaskRuntime.TaskRecord) {
  if (task.status === "completed") return "node_checkpoint" as const
  if (task.status === "cancelled") return "cancellation_checkpoint" as const
  if (task.status === "failed" || task.status === "partial") return "recovery_checkpoint" as const
  return undefined
}

function taskSummary(task: TaskRuntime.TaskRecord) {
  return task.result_summary ?? task.error_summary ?? task.description
}

function runtimeTodoTimeline(
  plan: CoordinatorPlanType,
  taskList: TaskRuntime.TaskRecord[],
  taskByNode: Map<string, TaskRuntime.TaskRecord>,
) {
  const todos = plan.todo_timeline.todos.map((item) => ({
    ...item,
    status: todoStatusFromTasks(
      item.node_ids.flatMap((id) => {
        const task = taskByNode.get(id)
        return task ? [task] : []
      }),
    ),
  }))
  const milestones = plan.todo_timeline.milestones.map((item) => {
    const milestoneTodos = todos.filter((todo) => item.todo_ids.includes(todo.id))
    return {
      ...item,
      status: milestoneStatusFromTodos(milestoneTodos),
    }
  })
  const current = milestones.find((item) => item.status !== "completed" && item.status !== "skipped")
  const milestoneByNode = new Map(
    milestones.flatMap((milestone) =>
      milestone.todo_ids.flatMap((todoID) => {
        const todo = todos.find((item) => item.id === todoID)
        return (todo?.node_ids ?? []).map((nodeID) => [nodeID, milestone.id] as const)
      }),
    ),
  )
  const taskCheckpoints = taskList.flatMap((task) => {
    const nodeID = nodeIDForTask(task)
    const type = checkpointTypeForTask(task)
    const retryCheckpoints = Array.isArray(task.metadata?.recovery_checkpoints)
      ? task.metadata.recovery_checkpoints.filter(isRecord).map((item, index) => ({
          id: `recovery_checkpoint_${task.task_id}_${index + 1}`,
          type: "recovery_checkpoint" as const,
          milestone_id: nodeID ? milestoneByNode.get(nodeID) : undefined,
          node_id: nodeID,
          task_id: task.task_id,
          status: String(item.status ?? "recorded"),
          summary: String(item.error_summary ?? item.result_summary ?? item.stop_reason ?? "Retry recovery checkpoint"),
          next_recommended_action: "Use this checkpoint to avoid repeating the previous failed attempt.",
          created_at: typeof item.created_at === "number" ? item.created_at : task.created_at,
        }))
      : []
    if (!nodeID || !type) return retryCheckpoints
    return [
      ...retryCheckpoints,
      {
        id: `${type}_${task.task_id}`,
        type,
        milestone_id: milestoneByNode.get(nodeID),
        node_id: nodeID,
        task_id: task.task_id,
        status: task.status,
        summary: taskSummary(task),
        next_recommended_action:
          task.status === "failed" || task.status === "partial"
            ? "Review recovery checkpoint before retrying this node."
            : "Use this checkpoint as compact evidence for downstream nodes.",
        created_at: task.finished_at ?? task.started_at ?? task.created_at,
      },
    ]
  })
  const milestoneCheckpoints = milestones.flatMap((milestone) => {
    if (milestone.status !== "completed" || !milestone.checkpoint_after) return []
    return [
      {
        id: `milestone_checkpoint_${milestone.id}`,
        type: "milestone_checkpoint" as const,
        milestone_id: milestone.id,
        status: milestone.status,
        summary: `${milestone.title} completed with expected artifact: ${milestone.expected_artifact}`,
        next_recommended_action: "Proceed to the next milestone using this milestone memory slice.",
        created_at: now(),
      },
    ]
  })
  return TodoTimeline.parse({
    ...plan.todo_timeline,
    todos,
    milestones,
    current_milestone_id: current?.id,
    checkpoints: latestByCreated([...taskCheckpoints, ...milestoneCheckpoints], checkpointLimit),
    evidence_ledger: latestByCreated(
      taskList
        .filter((item) => item.status === "completed" || item.status === "partial")
        .map((item) => {
          const nodeID = nodeIDForTask(item)
          return {
            id: `evidence_${item.task_id}`,
            source_type: "task" as const,
            source_id: item.task_id,
            milestone_id: nodeID ? milestoneByNode.get(nodeID) : undefined,
            node_id: nodeID,
            summary: taskSummary(item),
            confidence: item.status === "completed" ? ("high" as const) : ("medium" as const),
            scope: [...new Set([...item.read_scope, ...item.write_scope])],
            created_at: item.finished_at ?? item.started_at ?? item.created_at,
          }
        }),
      evidenceLimit,
    ),
    memory_slices: latestByCreated(
      milestones
        .filter((item) => item.status === "completed" || item.status === "partial" || item.status === "blocked")
        .map((item) => ({
          id: `memory_slice_${item.id}`,
          milestone_id: item.id,
          completed: todos
            .filter((todo) => item.todo_ids.includes(todo.id) && todo.status === "done")
            .map((todo) => todo.title),
          important_context: item.acceptance_checks,
          unresolved_risks: todos
            .filter(
              (todo) => item.todo_ids.includes(todo.id) && (todo.status === "blocked" || todo.status === "partial"),
            )
            .map((todo) => todo.title),
          next_context: `${item.title}: ${item.status}. Carry forward expected artifact "${item.expected_artifact}".`,
          discard_context: ["raw subagent transcript unless needed for evidence audit"],
          created_at: now(),
        })),
      memorySliceLimit,
    ),
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

function limitedResourceFor(usage: ResourceLimitType, limit: ResourceLimitType): ResourceLimitKeyType | undefined {
  return resourceLimitKeys
    .map((key) => ({
      key,
      used: limit[key] <= 0 ? (usage[key] > 0 ? 1 : 0) : usage[key] / limit[key],
    }))
    .filter((item) => item.used >= 1)
    .toSorted((a, b) => b.used - a.used)[0]?.key
}

export function subtractResourceLimit(left: ResourceLimitType, right: ResourceLimitType) {
  return ResourceLimit.parse({
    max_rounds: left.max_rounds > right.max_rounds ? left.max_rounds - right.max_rounds : left.max_rounds,
    max_model_calls:
      left.max_model_calls > right.max_model_calls
        ? left.max_model_calls - right.max_model_calls
        : left.max_model_calls,
    max_tool_calls:
      left.max_tool_calls > right.max_tool_calls ? left.max_tool_calls - right.max_tool_calls : left.max_tool_calls,
    max_subagents:
      left.max_subagents > right.max_subagents ? left.max_subagents - right.max_subagents : left.max_subagents,
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

export function resourceLimitDelta(current: ResourceLimitType, previous: ResourceLimitType) {
  return ResourceLimit.parse({
    max_rounds: Math.max(0, current.max_rounds - previous.max_rounds),
    max_model_calls: Math.max(0, current.max_model_calls - previous.max_model_calls),
    max_tool_calls: Math.max(0, current.max_tool_calls - previous.max_tool_calls),
    max_subagents: Math.max(0, current.max_subagents - previous.max_subagents),
    max_wallclock_ms: Math.max(0, current.max_wallclock_ms - previous.max_wallclock_ms),
    max_estimated_tokens: Math.max(0, current.max_estimated_tokens - previous.max_estimated_tokens),
  })
}

export function resourceLimitMeetsAnyMinimum(usage: ResourceLimitType, minimum: ResourceLimitType) {
  return (
    usage.max_rounds >= minimum.max_rounds ||
    usage.max_model_calls >= minimum.max_model_calls ||
    usage.max_tool_calls >= minimum.max_tool_calls ||
    usage.max_subagents >= minimum.max_subagents ||
    usage.max_wallclock_ms >= minimum.max_wallclock_ms ||
    usage.max_estimated_tokens >= minimum.max_estimated_tokens
  )
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
  const normalAbsoluteLimit = subtractResourceLimit(
    input.plan.budget_profile.absolute_ceiling,
    input.plan.budget_profile.checkpoint_reserve,
  )
  const absoluteResource = limitedResourceFor(usage, input.plan.budget_profile.absolute_ceiling)
  const reserveResource = limitedResourceFor(usage, normalAbsoluteLimit)
  const missionResource = limitedResourceFor(usage, input.plan.budget_profile.mission_ceiling)
  const phaseResource = limitedResourceFor(usage, input.plan.budget_profile.phase_ceiling)
  const limitedTodo = input.plan.todo_timeline.todos
    .map((todo) => {
      const todoTasks = input.taskList.filter((item) => {
        const nodeID = nodeIDForTask(item)
        return nodeID ? todo.node_ids.includes(nodeID) : false
      })
      return {
        id: todo.id,
        status: todoStatusFromTasks(todoTasks),
        resource: limitedResourceFor(
          todoUsageFor(input.run, input.taskList, todo.id),
          input.plan.budget_profile.todo_budget[todo.id] ?? input.plan.budget_profile.mission_ceiling,
        ),
      }
    })
    .filter((item) => item.status !== "done" && item.status !== "skipped")
    .find((item) => item.resource)
  const limitReason: BudgetLimitReasonType = absoluteResource
    ? "absolute"
    : reserveResource
      ? "checkpoint_reserve"
      : missionResource
        ? "mission"
        : phaseResource
          ? "phase"
          : limitedTodo
            ? "todo"
            : input.plan.budget_limited
              ? "mission"
              : "none"
  return BudgetState.parse({
    soft_budget_used: softBudgetUsed,
    absolute_ceiling_used: absoluteUsed,
    checkpoint_count: input.taskList.filter(
      (item) => item.metadata?.coordinator_node_id === "budget_checkpoint_synthesis" && item.status === "completed",
    ).length,
    budget_limited:
      input.plan.budget_limited ||
      softBudgetUsed >= 1 ||
      Boolean(reserveResource) ||
      Boolean(phaseResource) ||
      limitReason === "todo",
    ceiling_hit: absoluteUsed >= 1,
    limit_reason: limitReason,
    limited_resource: absoluteResource ?? reserveResource ?? missionResource ?? phaseResource ?? limitedTodo?.resource,
    limited_todo_id: limitedTodo?.id,
  })
}

function checkpointMemoryFor(input: {
  run: CoordinatorRunType
  todoTimeline: TodoTimelineType
  progressSnapshot: ProgressSnapshotType
}) {
  const checkpointType =
    input.todoTimeline.checkpoints.find((item) => item.type === "recovery_checkpoint")?.type ??
    input.todoTimeline.checkpoints.find((item) => item.type === "budget_checkpoint")?.type ??
    input.todoTimeline.checkpoints.find((item) => item.type === "milestone_checkpoint")?.type ??
    input.todoTimeline.checkpoints.find((item) => item.type === "node_checkpoint")?.type
  return CheckpointMemorySummary.parse({
    run_id: input.run.id,
    checkpoint_id: `checkpoint_${input.run.time.updated}`,
    checkpoint_type: checkpointType,
    current_milestone_id: input.todoTimeline.current_milestone_id,
    todo_state: input.todoTimeline.todos,
    completed_artifacts: input.todoTimeline.todos.filter((item) => item.status === "done").map((item) => item.title),
    evidence_index:
      input.todoTimeline.evidence_ledger.length > 0
        ? input.todoTimeline.evidence_ledger.map((item) => `${item.id}:${item.source_id}`)
        : input.todoTimeline.todos
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
    milestone_summaries: input.todoTimeline.memory_slices.map((item) => item.next_context),
    compressed_context: [
      `Progress ${Math.round(input.progressSnapshot.progress_score * 100)}%, evidence ${Math.round(input.progressSnapshot.evidence_coverage * 100)}%, confidence ${input.progressSnapshot.confidence}.`,
      input.todoTimeline.current_milestone_id ? `Current milestone: ${input.todoTimeline.current_milestone_id}.` : "",
    ]
      .filter((item) => item.length > 0)
      .join(" "),
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
  if (task.metadata?.mpacr_quorum_pending === true) return "pending_quorum" as const
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
  const base_todo_timeline = runtimeTodoTimeline(run.plan, taskList, taskByNode)
  const progress_snapshot = progressSnapshotFor({
    todoTimeline: base_todo_timeline,
    taskList,
    qualityGates: quality_gates,
  })
  const budget_state = budgetStateFor({ run, plan: run.plan, taskList, progressSnapshot: progress_snapshot })
  const todo_timeline = TodoTimeline.parse({
    ...base_todo_timeline,
    checkpoints:
      budget_state.budget_limited || budget_state.ceiling_hit
        ? latestByCreated(
            [
              ...base_todo_timeline.checkpoints,
              {
                id: `budget_checkpoint_${run.time.updated}`,
                type: "budget_checkpoint" as const,
                milestone_id: base_todo_timeline.current_milestone_id,
                status: budget_state.ceiling_hit ? "ceiling_hit" : "budget_limited",
                summary: budget_state.ceiling_hit
                  ? "Absolute budget ceiling reached before all milestones completed."
                  : "Mission budget checkpoint reached with unfinished milestone work.",
                next_recommended_action: "Review continuation request before adding budget or resuming.",
                created_at: now(),
              },
            ],
            checkpointLimit,
          )
        : base_todo_timeline.checkpoints,
  })
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
    budget_limited: runtime.budget_state.budget_limited,
  })
}
