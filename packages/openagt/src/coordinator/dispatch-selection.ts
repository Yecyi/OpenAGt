import { TaskRuntime } from "@/session/task-runtime"
import { resourceLimitSlots, todoForNode, todoUsageFor } from "./runtime-state"
import type {
  CoordinatorRun as CoordinatorRunType,
  ResourceLimit as ResourceLimitType,
} from "./schema"
import { nodeIDForTask } from "./task-record"

// Pure dispatch selection for ready coordinator tasks.
// This module chooses candidate tasks only; it does not fork, execute, block, or persist runs.

function groupFor(item: TaskRuntime.TaskRecord) {
  return typeof item.metadata?.parallel_group === "string" ? item.metadata.parallel_group : undefined
}

function nodeFor(item: TaskRuntime.TaskRecord) {
  return nodeIDForTask(item) ?? ""
}

export function dispatchSelectionFor(input: {
  run: CoordinatorRunType
  allTasks: TaskRuntime.TaskRecord[]
  ready: TaskRuntime.TaskRecord[]
  checkpointReady?: TaskRuntime.TaskRecord
  usage: ResourceLimitType
  normalAbsoluteLimit: ResourceLimitType
  checkpointSlots: number
  ceilingHit: boolean
  softBudgetHit: boolean
}) {
  const readyCandidates =
    input.ceilingHit || input.softBudgetHit ? (input.checkpointReady ? [input.checkpointReady] : []) : input.ready
  const planOrder = new Map(input.run.plan.nodes.map((item, index) => [item.id, index]))
  const orderedReady = readyCandidates.toSorted(
    (a, b) => (planOrder.get(nodeFor(a)) ?? 0) - (planOrder.get(nodeFor(b)) ?? 0),
  )
  const running = input.allTasks.filter((item) => item.status === "running")
  const runningGroups = new Set(
    running.flatMap((item) => {
      const group = groupFor(item)
      return group ? [group] : []
    }),
  )
  const activeGroup = input.run.plan.nodes
    .map((item) => item.parallel_group)
    .find((item) => item && runningGroups.has(item))
  const firstReady = orderedReady[0]
  const targetGroup = activeGroup ?? (firstReady ? groupFor(firstReady) : undefined)
  const slots = Math.max(0, input.run.plan.parallel_policy.max_parallel_agents - running.length)
  const budgetSlots =
    input.softBudgetHit && input.checkpointReady
      ? Math.min(1, input.checkpointSlots)
      : Math.min(
          resourceLimitSlots(input.usage, input.normalAbsoluteLimit),
          resourceLimitSlots(input.usage, input.run.plan.budget_profile.mission_ceiling),
          resourceLimitSlots(input.usage, input.run.plan.budget_profile.phase_ceiling),
        )
  const withinTodoBudget = (item: TaskRuntime.TaskRecord) => {
    if (item.metadata?.coordinator_node_id === "budget_checkpoint_synthesis") return true
    const todo = todoForNode(input.run.plan, nodeFor(item))
    const budget = todo ? input.run.plan.budget_profile.todo_budget[todo.id] : undefined
    if (!todo || !budget) return true
    return resourceLimitSlots(todoUsageFor(input.run, input.allTasks, todo.id), budget) > 0
  }
  const selected = (
    input.run.plan.parallel_policy.mode === "off"
      ? orderedReady.slice(0, Math.min(slots, 1))
      : targetGroup
        ? orderedReady.filter((item) => groupFor(item) === targetGroup).slice(0, slots)
        : orderedReady.slice(0, Math.min(slots, 1))
  )
    .filter(withinTodoBudget)
    .slice(0, budgetSlots)
  return { orderedReady, budgetSlots, selected }
}
