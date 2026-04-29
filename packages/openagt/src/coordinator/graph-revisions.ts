import z from "zod"
import { buildDebate, buildDegraded } from "./mpacr"
import { reviseNode } from "./plan-node-factory"
import {
  CoordinatorNode,
  RevisePoint,
  type CoordinatorNode as CoordinatorNodeType,
  type EffortLevel as EffortLevelType,
  type EffortProfile as EffortProfileType,
  type TaskType as TaskTypeType,
} from "./schema"
import type { BudgetOptions } from "./budget-governance"

// A.2 — reviseGraphFor: returns either a single revise node (legacy path) or
// the full MPACR debate graph (K+3 nodes) when EffortProfile.mpacr_enabled
// is true. The `entry` field is what downstream `replacements` maps point to:
// in legacy mode it's the lone reviser; in MPACR mode it's the synthesis node
// so dependents wait for the whole debate to settle. The whole graph is
// returned in `all` so the caller can splice every node into reviseNodes.
export function shouldUseDegradedMpacr(profile: EffortProfileType, budgetOptions?: BudgetOptions) {
  const fullNodeCount = Math.max(2, Math.min(5, Math.floor(profile.mpacr_critic_count))) + 4
  if (budgetOptions?.budget === "small") return true
  if (typeof budgetOptions?.maxSubagents === "number" && budgetOptions.maxSubagents < fullNodeCount) return true
  if (typeof budgetOptions?.maxRounds === "number" && budgetOptions.maxRounds < fullNodeCount) return true
  return false
}

export function reviseGraphFor(
  input: {
    id: string
    kind: z.infer<typeof RevisePoint>["kind"]
    target?: CoordinatorNodeType
    dependsOn: string[]
    goal: string
    workflow: TaskTypeType
    effort: EffortLevelType
    required?: boolean
  },
  profile: EffortProfileType,
  budgetOptions?: BudgetOptions,
): { entry: CoordinatorNodeType; all: CoordinatorNodeType[] } {
  // MPACR requires a concrete target artifact to debate. When the caller has
  // no target (e.g. plan_revise without a planning round, or a synthetic
  // final_revise gate), fall back to the single-node legacy reviser.
  if (!profile.mpacr_enabled || !input.target) {
    const single = reviseNode(input)
    return { entry: single, all: [single] }
  }
  const debateInput = {
    idPrefix: input.id,
    target: input.target,
    goal: input.goal,
    workflow: input.workflow,
    effort: input.effort,
    profile,
    dependsOn: input.dependsOn,
  }
  const debate = shouldUseDegradedMpacr(profile, budgetOptions) ? buildDegraded(debateInput) : buildDebate(debateInput)
  return { entry: debate.synthesis, all: [...debate.all] }
}

export function rewriteDeps(nodes: CoordinatorNodeType[], replacements: Map<string, string>) {
  return nodes.map((item) =>
    CoordinatorNode.parse({
      ...item,
      depends_on: item.depends_on.map((dependency) => replacements.get(dependency) ?? dependency),
    }),
  )
}

export function sinkIDs(nodes: CoordinatorNodeType[]) {
  const dependencies = new Set(nodes.flatMap((item) => item.depends_on))
  return nodes.map((item) => item.id).filter((id) => !dependencies.has(id))
}

export function lowEffortNodes(nodes: CoordinatorNodeType[]) {
  const seenGroups = new Set<string>()
  const kept = nodes
    .filter((item) => {
      if (!item.parallel_group) return true
      if (seenGroups.has(item.parallel_group)) return false
      seenGroups.add(item.parallel_group)
      return true
    })
    .filter((item) => item.role !== "reviewer" && item.role !== "reducer")
  const firstResearch = kept.find((item) => item.task_kind === "research")?.id
  const keptIDs = new Set(kept.map((item) => item.id))
  return kept.map((item) =>
    CoordinatorNode.parse({
      ...item,
      depends_on: item.depends_on.flatMap((dependency) => {
        if (keptIDs.has(dependency)) return [dependency]
        if (dependency.includes("research_synthesis") && firstResearch && firstResearch !== item.id)
          return [firstResearch]
        return []
      }),
    }),
  )
}
