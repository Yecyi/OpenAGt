import { BudgetTuning } from "@/agent/budget-tuning"
import {
  ResourceLimit,
  type AutoContinuePolicy as AutoContinuePolicyType,
  type BudgetScale as BudgetScaleType,
  type EffortLevel as EffortLevelType,
  type LongTaskProfile as LongTaskProfileType,
  type ResourceLimit as ResourceLimitType,
  type TaskType as TaskTypeType,
} from "./schema"

export function capResourceLimit(limit: ResourceLimitType, cap: ResourceLimitType) {
  return ResourceLimit.parse({
    max_rounds: Math.min(limit.max_rounds, cap.max_rounds),
    max_model_calls: Math.min(limit.max_model_calls, cap.max_model_calls),
    max_tool_calls: Math.min(limit.max_tool_calls, cap.max_tool_calls),
    max_subagents: Math.min(limit.max_subagents, cap.max_subagents),
    max_wallclock_ms: Math.min(limit.max_wallclock_ms, cap.max_wallclock_ms),
    max_estimated_tokens: Math.min(limit.max_estimated_tokens, cap.max_estimated_tokens),
  })
}

export function taskSizeMultiplier(size: LongTaskProfileType["task_size"]) {
  if (size === "huge") return 8
  if (size === "large") return 4
  if (size === "medium") return 2
  return 1
}

export function workflowBudgetMultiplier(workflow: TaskTypeType) {
  if (workflow === "coding" || workflow === "debugging" || workflow === "research") return 1.25
  if (workflow === "data-analysis" || workflow === "environment-audit") return 1.15
  if (workflow === "personal-admin" || workflow === "file-data-organization") return 0.85
  return 1
}

export function budgetScaleMultiplier(scale: BudgetScaleType) {
  if (scale === "max") return 2.5
  if (scale === "large") return 1.75
  if (scale === "small") return 0.5
  return 1
}

export function absoluteBaseLimit(effort: EffortLevelType) {
  return ResourceLimit.parse(BudgetTuning.resourceLimit[effort] ?? BudgetTuning.resourceLimit.medium)
}

export function autoContinueForEffort(
  effort: EffortLevelType,
  override?: AutoContinuePolicyType,
): AutoContinuePolicyType {
  return override ?? (effort === "low" ? "never" : effort === "medium" ? "checkpoint" : "safe")
}
