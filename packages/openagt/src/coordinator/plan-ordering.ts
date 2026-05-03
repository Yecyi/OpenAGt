// Plan validation, verify-node expansion, and dependency ordering helpers.
// This file does not build workflow-specific plans or run coordinator tasks.

import { CoordinatorNode, CoordinatorPlan, type CoordinatorNode as CoordinatorNodeType } from "./schema"
import type { CoordinatorPlan as CoordinatorPlanType } from "./schema"

export function expandVerifyNodes(plan: CoordinatorPlanType): CoordinatorPlanType {
  const seen = new Set(plan.nodes.map((item) => item.id))
  const generated = plan.nodes.flatMap((item) => {
    if (item.task_kind !== "implement") return []
    if (plan.nodes.some((node) => node.task_kind === "verify" && node.depends_on.includes(item.id))) return []
    const id = `${item.id}_verify`
    if (seen.has(id)) return []
    seen.add(id)
    return [
      CoordinatorNode.parse({
        id,
        description: `Verify ${item.description}`,
        prompt: `Verify the implementation and report remaining issues.\n\nAcceptance checks:\n${item.acceptance_checks.join("\n")}`,
        task_kind: "verify",
        subagent_type: "general",
        role: "verifier",
        risk: "low",
        depends_on: [item.id],
        write_scope: [],
        read_scope: [...item.write_scope],
        acceptance_checks: item.acceptance_checks.length > 0 ? item.acceptance_checks : ["Verification completed"],
        output_schema: "verification",
        requires_user_input: false,
        priority: item.priority,
        origin: "coordinator",
      }),
    ]
  })
  return CoordinatorPlan.parse({
    ...plan,
    nodes: [...plan.nodes, ...generated],
  })
}

// Structured validation result. Returned by validatePlanResult so callers can
// distinguish failure modes programmatically without parsing thrown messages.
export type PlanValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: "duplicate"; readonly node_id: string }
  | { readonly ok: false; readonly kind: "missing_dep"; readonly node_id: string; readonly missing: string }
  | { readonly ok: false; readonly kind: "cycle"; readonly cycle_path: readonly string[] }

export function validatePlanResult(plan: CoordinatorPlanType): PlanValidationResult {
  const ids = plan.nodes.map((item) => item.id)
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index)
  if (duplicate) return { ok: false, kind: "duplicate", node_id: duplicate }
  const nodes = new Map(plan.nodes.map((item) => [item.id, item]))
  for (const node of plan.nodes) {
    for (const dep of node.depends_on) {
      if (!nodes.has(dep)) return { ok: false, kind: "missing_dep", node_id: node.id, missing: dep }
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  let cyclePath: readonly string[] | undefined
  const walk = (id: string) => {
    if (cyclePath) return
    if (visited.has(id)) return
    if (visiting.has(id)) {
      const start = stack.indexOf(id)
      cyclePath = [...(start >= 0 ? stack.slice(start) : stack), id]
      return
    }
    visiting.add(id)
    stack.push(id)
    for (const dep of nodes.get(id)?.depends_on ?? []) walk(dep)
    stack.pop()
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of nodes.keys()) {
    if (cyclePath) break
    walk(id)
  }
  if (cyclePath) return { ok: false, kind: "cycle", cycle_path: cyclePath }
  return { ok: true }
}

export function planValidationErrorMessage(result: Exclude<PlanValidationResult, { ok: true }>): string {
  if (result.kind === "duplicate") return `Coordinator plan contains duplicate node id: ${result.node_id}`
  if (result.kind === "missing_dep") {
    return `Coordinator dependency missing: ${result.node_id} depends on unknown node ${result.missing}`
  }
  return `Coordinator plan contains cycle: ${result.cycle_path.join(" -> ")}`
}

// Auto-repair the safely-correctable LLM failure mode: a node depending on
// an id that doesn't exist anywhere in the plan. The planner clearly didn't
// intend the dep — keeping it would block execution forever. Drops missing
// references and returns the list of (node_id, missing_dep) pairs so the
// caller can log/telemeter. Cycles and duplicate ids are NOT auto-repaired
// because either fix would silently change execution semantics.
export function repairMissingDeps(plan: CoordinatorPlanType): {
  readonly plan: CoordinatorPlanType
  readonly dropped: ReadonlyArray<{ readonly node_id: string; readonly missing: string }>
} {
  const known = new Set(plan.nodes.map((item) => item.id))
  const dropped: { node_id: string; missing: string }[] = []
  const repaired = plan.nodes.map((node) => {
    const filtered = node.depends_on.filter((dep) => {
      if (known.has(dep)) return true
      dropped.push({ node_id: node.id, missing: dep })
      return false
    })
    if (filtered.length === node.depends_on.length) return node
    return { ...node, depends_on: filtered }
  })
  if (dropped.length === 0) return { plan, dropped: [] }
  return {
    plan: CoordinatorPlan.parse({ ...plan, nodes: repaired }),
    dropped,
  }
}

export function validatePlan(plan: CoordinatorPlanType): void {
  const result = validatePlanResult(plan)
  if (!result.ok) throw new Error(planValidationErrorMessage(result))
}

export function orderPlan(plan: CoordinatorPlanType): CoordinatorPlanType {
  validatePlan(plan)
  const nodes = new Map(plan.nodes.map((item) => [item.id, item]))
  const ordered: CoordinatorNodeType[] = []
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    for (const dependency of nodes.get(id)?.depends_on ?? []) visit(dependency)
    const node = nodes.get(id)
    if (node) ordered.push(node)
  }
  for (const node of plan.nodes) visit(node.id)
  return CoordinatorPlan.parse({
    ...plan,
    nodes: ordered,
  })
}
