import type { EffortLevelValue } from "./task-classifier"

export const BudgetTuning = {
  concurrency: {
    storageRead: 8,
  },
  step: {
    low: 16,
    medium: 36,
    high: 64,
    deep: 96,
    broadExploreFloor: 48,
    broadResearchFloor: 36,
    absoluteCap: 240,
  },
  timeoutMs: {
    low: 120_000,
    medium: 300_000,
    high: 600_000,
    deep: 900_000,
    exploreBase: 180_000,
    defaultBase: 300_000,
    broadExploreFloor: 360_000,
    broadResearchFloor: 480_000,
    perStepFloor: 12_000,
    absoluteCap: 1_800_000,
  },
  resourceLimit: {
    low: {
      max_rounds: 8,
      max_model_calls: 16,
      max_tool_calls: 80,
      max_subagents: 4,
      max_wallclock_ms: 20 * 60 * 1000,
      max_estimated_tokens: 200_000,
    },
    medium: {
      max_rounds: 12,
      max_model_calls: 32,
      max_tool_calls: 160,
      max_subagents: 8,
      max_wallclock_ms: 45 * 60 * 1000,
      max_estimated_tokens: 500_000,
    },
    high: {
      max_rounds: 20,
      max_model_calls: 48,
      max_tool_calls: 240,
      max_subagents: 12,
      max_wallclock_ms: 60 * 60 * 1000,
      max_estimated_tokens: 1_000_000,
    },
    // Why: deep/huge tasks need enough ceiling for multi-expert research while checkpoint limits prevent silent runaway.
    deep: {
      max_rounds: 30,
      max_model_calls: 60,
      max_tool_calls: 300,
      max_subagents: 12,
      max_wallclock_ms: 60 * 60 * 1000,
      max_estimated_tokens: 1_250_000,
    },
  },
  resourceLimitMinimum: {
    max_rounds: 4,
    max_model_calls: 4,
    max_tool_calls: 12,
    max_subagents: 1,
    max_wallclock_ms: 5 * 60 * 1000,
    max_estimated_tokens: 25_000,
  },
  continuation: {
    minConsumedBeforeContinue: {
      max_rounds: 1,
      max_model_calls: 1,
      max_tool_calls: 1,
      max_subagents: 1,
      max_wallclock_ms: 30_000,
      max_estimated_tokens: 1_000,
    },
  },
} as const

export function effortStepBudget(effort: EffortLevelValue | undefined) {
  return effort ? BudgetTuning.step[effort] : undefined
}

export function effortTimeoutFloor(effort: EffortLevelValue | undefined) {
  return effort ? BudgetTuning.timeoutMs[effort] : undefined
}
