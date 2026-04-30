import { BudgetTuning } from "@/agent/budget-tuning"
import {
  BudgetProfile,
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
import { longTaskProfileForDecision } from "./long-task-decision"
import {
  absoluteBaseLimit,
  autoContinueForEffort,
  budgetScaleMultiplier,
  capResourceLimit,
  taskSizeMultiplier,
  workflowBudgetMultiplier,
} from "./budget-policy"

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

export function longTaskProfileFor(input: {
  goal: string
  intent: IntentProfileType
  effort: EffortLevelType
  nodeCount: number
  workspaceSignals?: WorkspaceSignals
}) {
  return longTaskProfileForDecision(input)
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
    auto_continue: autoContinueForEffort(input.effort, input.autoContinue),
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
