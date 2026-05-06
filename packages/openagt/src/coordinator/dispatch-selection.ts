import { TaskRuntime } from "@/session/task-runtime"
import { scopeOverlap } from "@/session/task-runtime-helpers"
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

// Defense-in-depth check for ParallelExecutionPolicy.write_parallel_requires_disjoint_scope.
// The planner usually structures the DAG so write-conflicting nodes have explicit
// dependency edges, but a hallucinated parallel_group on overlapping write_scopes would
// otherwise slip through. We only block when *both* sides have non-empty write_scope —
// read-only tasks (empty write_scope) are never blocked here.
function hasWriteScopeConflict(
  candidate: TaskRuntime.TaskRecord,
  others: readonly TaskRuntime.TaskRecord[],
): boolean {
  if (candidate.write_scope.length === 0) return false
  return others.some((other) => other.write_scope.length > 0 && scopeOverlap(candidate.write_scope, other.write_scope))
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
  const todoBudgetFor = (item: TaskRuntime.TaskRecord) => {
    if (item.metadata?.coordinator_node_id === "budget_checkpoint_synthesis") return true
    const todo = todoForNode(input.run.plan, nodeFor(item))
    const budget = todo ? input.run.plan.budget_profile.todo_budget[todo.id] : undefined
    if (!todo || !budget) return true
    return resourceLimitSlots(todoUsageFor(input.run, input.allTasks, todo.id), budget) > 0
  }
  const candidates = (
    input.run.plan.parallel_policy.mode === "off"
      ? orderedReady.slice(0, Math.min(slots, 1))
      : targetGroup
        ? orderedReady.filter((item) => groupFor(item) === targetGroup).slice(0, slots)
        : orderedReady.slice(0, Math.min(slots, 1))
  )
    .slice(0, budgetSlots)
  const todoBudgetBlocked = candidates.some((item) => !todoBudgetFor(item))
  const preselected = candidates.filter(todoBudgetFor)

  // Apply write-scope disjointness if the policy requires it. We must consider both
  // already-running tasks and tasks accepted earlier in this same dispatch round, so
  // walk the preselected list one at a time and skip overlapping candidates.
  const enforceDisjoint = input.run.plan.parallel_policy.write_parallel_requires_disjoint_scope
  const selected: TaskRuntime.TaskRecord[] = []
  for (const candidate of preselected) {
    if (enforceDisjoint && hasWriteScopeConflict(candidate, [...running, ...selected])) continue
    selected.push(candidate)
  }
  return { orderedReady, budgetSlots, selected, todoBudgetBlocked }
}
