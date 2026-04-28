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

export function validatePlan(plan: CoordinatorPlanType): void {
  const duplicate = plan.nodes.map((item) => item.id).find((id, index, ids) => ids.indexOf(id) !== index)
  if (duplicate) throw new Error(`Coordinator plan contains duplicate node id: ${duplicate}`)
  const nodes = new Map(plan.nodes.map((item) => [item.id, item]))
  for (const node of plan.nodes) {
    for (const dep of node.depends_on) {
      if (!nodes.has(dep)) throw new Error(`Coordinator dependency missing: ${node.id} depends on unknown node ${dep}`)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const walk = (id: string) => {
    if (visited.has(id)) return
    if (visiting.has(id)) {
      const start = stack.indexOf(id)
      const cycle = [...(start >= 0 ? stack.slice(start) : stack), id].join(" -> ")
      throw new Error(`Coordinator plan contains cycle: ${cycle}`)
    }
    visiting.add(id)
    stack.push(id)
    for (const dep of nodes.get(id)?.depends_on ?? []) walk(dep)
    stack.pop()
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of nodes.keys()) walk(id)
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
