import { TodoTimeline, type CoordinatorNode as CoordinatorNodeType, type TaskType as TaskTypeType } from "./schema"

export function todoStage(node: CoordinatorNodeType): "plan" | "research" | "expert" | "reduce" | "verify" | "final" {
  if (node.role === "planner") return "plan"
  if (node.role === "reducer") return "reduce"
  if (node.id.includes("checkpoint") || node.output_schema === "summary") return "final"
  if (node.role === "reviewer" || node.role === "reviser" || node.task_kind === "verify") return "verify"
  if (node.task_kind === "research") return "research"
  return "expert"
}

export function stageTitle(stage: ReturnType<typeof todoStage>, workflow: TaskTypeType) {
  if (stage === "plan") return `Plan ${workflow} mission`
  if (stage === "research") return `Gather ${workflow} evidence`
  if (stage === "reduce") return `Synthesize expert findings`
  if (stage === "verify") return `Critically verify outputs`
  if (stage === "final") return `Summarize progress and next steps`
  return `Execute ${workflow} expert work`
}

export function todoTimelineFor(input: {
  required: boolean
  nodes: CoordinatorNodeType[]
  expertLanes: Array<{ id: string; node_ids: string[] }>
  workflow: TaskTypeType
  activeMilestoneLimit?: number
}) {
  if (!input.required) return TodoTimeline.parse({ required: false, todos: [], phases: [] })
  const stages = ["plan", "research", "expert", "reduce", "verify", "final"] as const
  const todos = stages.flatMap((stage) => {
    const stageNodes = input.nodes.filter((item) => todoStage(item) === stage)
    if (stageNodes.length === 0) return []
    const nodeIDs = stageNodes.map((item) => item.id)
    return [
      {
        id: `todo_${stage}`,
        title: stageTitle(stage, input.workflow),
        status: "pending" as const,
        priority: stage === "plan" || stage === "verify" ? ("high" as const) : ("normal" as const),
        budget_weight:
          stage === "expert" || stage === "research" ? stageNodes.length * 1.5 : Math.max(1, stageNodes.length),
        acceptance_hint: stageNodes
          .flatMap((item) => item.acceptance_checks)
          .slice(0, 3)
          .join("; "),
        depends_on: stages
          .slice(0, stages.indexOf(stage))
          .filter((candidate) => input.nodes.some((item) => todoStage(item) === candidate))
          .slice(-1)
          .map((candidate) => `todo_${candidate}`),
        assigned_stage: stage,
        node_ids: nodeIDs,
        expert_lane_ids: input.expertLanes
          .filter((lane) => lane.node_ids.some((id) => nodeIDs.includes(id)))
          .map((lane) => lane.id),
      },
    ]
  })
  const phases = todos.map((item, index) => ({
    id: `phase_${index + 1}_${item.assigned_stage}`,
    title: item.title,
    todo_ids: [item.id],
    expected_outputs: [item.acceptance_hint || item.title],
    checkpoint_after:
      item.assigned_stage === "reduce" || item.assigned_stage === "verify" || item.assigned_stage === "final",
    milestone_id: `milestone_${index + 1}_${item.assigned_stage}`,
  }))
  const totalWeight = todos.reduce((acc, item) => acc + item.budget_weight, 0)
  return TodoTimeline.parse({
    required: true,
    todos,
    phases,
    milestones: phases.map((item) => {
      const todo = todos.find((candidate) => item.todo_ids.includes(candidate.id))
      return {
        id: item.milestone_id,
        title: item.title,
        status: "pending" as const,
        risk: todo?.priority === "high" ? ("medium" as const) : ("low" as const),
        todo_ids: item.todo_ids,
        acceptance_checks: todo?.acceptance_hint ? [todo.acceptance_hint] : item.expected_outputs,
        expected_artifact: item.expected_outputs[0] ?? item.title,
        budget_slice: totalWeight > 0 ? (todo?.budget_weight ?? 1) / totalWeight : 1 / Math.max(1, phases.length),
        checkpoint_after: item.checkpoint_after,
      }
    }),
    current_milestone_id: phases[0]?.milestone_id,
    active_milestone_limit: input.activeMilestoneLimit ?? 2,
  })
}
