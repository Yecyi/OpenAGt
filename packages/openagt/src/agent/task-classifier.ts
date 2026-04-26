import { classifyGoal, isProjectDeepDiveGoal } from "./goal-classifier"

export const EffortLevelValue = ["low", "medium", "high", "deep"] as const
export type EffortLevelValue = (typeof EffortLevelValue)[number]

export function effortFromMetadata(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.effort
  return EffortLevelValue.includes(value as EffortLevelValue) ? (value as EffortLevelValue) : undefined
}

export function numericMetadata(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

export function isBroadAgentTask(goal: string) {
  return classifyGoal(goal).broad_task
}

export { classifyGoal, isProjectDeepDiveGoal }
