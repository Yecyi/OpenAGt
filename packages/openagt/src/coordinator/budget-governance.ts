import { BudgetTuning } from "@/agent/budget-tuning"
import { isBroadAgentTask } from "@/agent/task-classifier"
import {
  BudgetProfile,
  LongTaskProfile,
  ResourceLimit,
  type AutoContinuePolicy as AutoContinuePolicyType,
  type BudgetScale as BudgetScaleType,
  type EffortLevel as EffortLevelType,
  type IntentProfile as IntentProfileType,
  type LongTaskProfile as LongTaskProfileType,
  type ResourceLimit as ResourceLimitType,
  type TaskType as TaskTypeType,
  type TodoTimeline as TodoTimelineType,
} from "./schema"
import type { WorkspaceSignals } from "./workspace-signals"

// Budget and long-task governance for coordinator plans.
// This module is pure policy math; it does not mutate runs or execute tasks.

export type BudgetOptions = {
  budget?: BudgetScaleType
  autoContinue?: AutoContinuePolicyType
  maxRounds?: number
  maxSubagents?: number
  maxWallclockMs?: number
}

export function scaleResourceLimit(limit: ResourceLimitType, multiplier: number) {
  const minimum = BudgetTuning.resourceLimitMinimum
  return ResourceLimit.parse({
    max_rounds: Math.max(minimum.max_rounds, Math.round(limit.max_rounds * multiplier)),
    max_model_calls: Math.max(minimum.max_model_calls, Math.round(limit.max_model_calls * multiplier)),
    max_tool_calls: Math.max(minimum.max_tool_calls, Math.round(limit.max_tool_calls * multiplier)),
    max_subagents: Math.max(minimum.max_subagents, Math.round(limit.max_subagents * multiplier)),
    max_wallclock_ms: Math.max(minimum.max_wallclock_ms, Math.round(limit.max_wallclock_ms * multiplier)),
    max_estimated_tokens: Math.max(minimum.max_estimated_tokens, Math.round(limit.max_estimated_tokens * multiplier)),
  })
}

function capResourceLimit(limit: ResourceLimitType, cap: ResourceLimitType) {
  return ResourceLimit.parse({
    max_rounds: Math.min(limit.max_rounds, cap.max_rounds),
    max_model_calls: Math.min(limit.max_model_calls, cap.max_model_calls),
    max_tool_calls: Math.min(limit.max_tool_calls, cap.max_tool_calls),
    max_subagents: Math.min(limit.max_subagents, cap.max_subagents),
    max_wallclock_ms: Math.min(limit.max_wallclock_ms, cap.max_wallclock_ms),
    max_estimated_tokens: Math.min(limit.max_estimated_tokens, cap.max_estimated_tokens),
  })
}

export function addResourceLimit(limit: ResourceLimitType, delta?: Partial<ResourceLimitType>) {
  return ResourceLimit.parse({
    max_rounds: Math.min(10_000, limit.max_rounds + Math.max(0, delta?.max_rounds ?? 0)),
    max_model_calls: Math.min(20_000, limit.max_model_calls + Math.max(0, delta?.max_model_calls ?? 0)),
    max_tool_calls: Math.min(100_000, limit.max_tool_calls + Math.max(0, delta?.max_tool_calls ?? 0)),
    max_subagents: Math.min(10_000, limit.max_subagents + Math.max(0, delta?.max_subagents ?? 0)),
    max_wallclock_ms: Math.min(
      14 * 24 * 60 * 60 * 1000,
      limit.max_wallclock_ms + Math.max(0, delta?.max_wallclock_ms ?? 0),
    ),
    max_estimated_tokens: Math.min(
      100_000_000,
      limit.max_estimated_tokens + Math.max(0, delta?.max_estimated_tokens ?? 0),
    ),
  })
}

function taskSizeMultiplier(size: LongTaskProfileType["task_size"]) {
  if (size === "huge") return 8
  if (size === "large") return 4
  if (size === "medium") return 2
  return 1
}

function workflowBudgetMultiplier(workflow: TaskTypeType) {
  if (workflow === "coding" || workflow === "debugging" || workflow === "research") return 1.25
  if (workflow === "data-analysis" || workflow === "environment-audit") return 1.15
  if (workflow === "personal-admin" || workflow === "file-data-organization") return 0.85
  return 1
}

function budgetScaleMultiplier(scale: BudgetScaleType) {
  if (scale === "max") return 2.5
  if (scale === "large") return 1.75
  if (scale === "small") return 0.5
  return 1
}

function absoluteBaseLimit(effort: EffortLevelType) {
  return ResourceLimit.parse(BudgetTuning.resourceLimit[effort] ?? BudgetTuning.resourceLimit.medium)
}

export function longTaskProfileFor(input: {
  goal: string
  intent: IntentProfileType
  effort: EffortLevelType
  nodeCount: number
  workspaceSignals?: WorkspaceSignals
}) {
  const tokenEstimate = Math.ceil(input.goal.length / 4)
  const outputDimensions = input.intent.success_criteria.length + (input.goal.match(/\n|\d\.|;|,/g)?.length ?? 0)
  const workspaceScore =
    (input.workspaceSignals?.file_count ?? 0) >= 1_000
      ? 3
      : (input.workspaceSignals?.file_count ?? 0) >= 300
        ? 2
        : (input.workspaceSignals?.file_count ?? 0) >= 100
          ? 1
          : 0
  const explicitLong = isBroadAgentTask(input.goal)
  const score =
    (explicitLong ? 3 : 0) +
    (input.effort === "deep" ? 3 : input.effort === "high" ? 2 : 0) +
    (input.nodeCount >= 12 ? 3 : input.nodeCount >= 8 ? 2 : input.nodeCount >= 5 ? 1 : 0) +
    (tokenEstimate >= 300 ? 2 : tokenEstimate >= 120 ? 1 : 0) +
    (outputDimensions >= 8 ? 2 : outputDimensions >= 5 ? 1 : 0) +
    workspaceScore +
    ((input.workspaceSignals?.package_count ?? 0) >= 6
      ? 2
      : (input.workspaceSignals?.package_count ?? 0) >= 2
        ? 1
        : 0) +
    ((input.workspaceSignals?.language_count ?? 0) >= 4 ? 1 : 0)
  const task_size = score >= 10 ? "huge" : score >= 7 ? "large" : score >= 4 ? "medium" : "small"
  const is_long_task = score >= 4 || ((input.effort === "high" || input.effort === "deep") && explicitLong)
  return LongTaskProfile.parse({
    is_long_task,
    task_size,
    timeline_required: is_long_task,
    reasons: [
      explicitLong ? "broad or deep-dive goal" : undefined,
      input.effort === "high" || input.effort === "deep" ? `${input.effort} effort selected` : undefined,
      input.nodeCount >= 5 ? `coordinator plan has ${input.nodeCount} nodes` : undefined,
      tokenEstimate >= 120 ? `prompt estimate is ${tokenEstimate} tokens` : undefined,
      outputDimensions >= 5 ? `goal has ${outputDimensions} output dimensions` : undefined,
      ...(input.workspaceSignals?.reasons ?? []),
    ].filter((item): item is string => Boolean(item)),
  })
}

export function budgetProfileFor(input: {
  effort: EffortLevelType
  workflow: TaskTypeType
  longTask: LongTaskProfileType
  todoTimeline: TodoTimelineType
  budget?: BudgetScaleType
  autoContinue?: AutoContinuePolicyType
  maxRounds?: number
  maxSubagents?: number
  maxWallclockMs?: number
}) {
  const scale = input.budget ?? "normal"
  const absolute = scaleResourceLimit(
    absoluteBaseLimit(input.effort),
    taskSizeMultiplier(input.longTask.task_size) *
      workflowBudgetMultiplier(input.workflow) *
      budgetScaleMultiplier(scale),
  )
  const absolute_ceiling = ResourceLimit.parse({
    ...absolute,
    max_rounds: input.maxRounds ?? absolute.max_rounds,
    max_subagents: input.maxSubagents ?? absolute.max_subagents,
    max_wallclock_ms: input.maxWallclockMs ?? absolute.max_wallclock_ms,
  })
  const mission_ceiling = scaleResourceLimit(absolute_ceiling, 0.65)
  const phase_ceiling = scaleResourceLimit(absolute_ceiling, input.longTask.is_long_task ? 0.25 : 0.5)
  const totalWeight = input.todoTimeline.todos.reduce((acc, item) => acc + item.budget_weight, 0)
  return BudgetProfile.parse({
    scale,
    auto_continue:
      input.autoContinue ?? (input.effort === "low" ? "never" : input.effort === "medium" ? "checkpoint" : "safe"),
    mission_ceiling,
    phase_ceiling,
    todo_budget: Object.fromEntries(
      input.todoTimeline.todos.map((item) => [
        item.id,
        scaleResourceLimit(mission_ceiling, totalWeight > 0 ? item.budget_weight / totalWeight : 1),
      ]),
    ),
    checkpoint_reserve: scaleResourceLimit(absolute_ceiling, input.longTask.is_long_task ? 0.08 : 0.05),
    absolute_ceiling,
    single_checkpoint_ceiling: capResourceLimit(
      absolute_ceiling,
      ResourceLimit.parse({
        max_rounds: 24,
        max_model_calls: 40,
        max_tool_calls: 240,
        max_subagents: 16,
        max_wallclock_ms: 45 * 60 * 1000,
        max_estimated_tokens: 1_000_000,
      }),
    ),
    no_progress_stop: {
      checkpoint_window: 5,
      min_new_completed_todo_weight: 0.05,
      min_new_evidence_items: 3,
      min_quality_delta: 0.03,
    },
  })
}
