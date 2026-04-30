import z from "zod"
import { budgetProfileFor, longTaskProfileFor, type BudgetOptions } from "./budget-governance"
import { effortProfileFor } from "./effort-profile"
import { basePlanForIntent } from "./base-plan"
import { lowEffortNodes, reviseGraphFor, rewriteDeps, sinkIDs } from "./graph-revisions"
import { todoTimelineFor } from "./todo-timeline"
import { checkpointNode, plannerNode, withExpertHarness } from "./plan-node-factory"
import {
  BudgetState,
  CheckpointMemorySummary,
  CoordinatorNode,
  CoordinatorPlan,
  EffortProfile,
  ExpertLane,
  IntentProfile,
  ProgressSnapshot,
  QualityGate,
  RevisePoint,
  type CoordinatorNode as CoordinatorNodeType,
  type CoordinatorPlan as CoordinatorPlanType,
  type EffortLevel as EffortLevelType,
  type EffortProfile as EffortProfileType,
  type IntentProfile as IntentProfileType,
  type TaskType as TaskTypeType,
} from "./schema"
import { workspaceSignalsForGoal, type WorkspaceSignals } from "./workspace-signals"

function effortPlanMetadata(input: {
  nodes: CoordinatorNodeType[]
  intent: IntentProfileType
  workflow: TaskTypeType
  effort: EffortLevelType
  profile: EffortProfileType
  reviseNodes: CoordinatorNodeType[]
  budgetLimited: boolean
  budgetOptions?: BudgetOptions
  workspaceSignals?: WorkspaceSignals
}) {
  const expert_lanes = ExpertLane.array().parse(
    Object.values(
      input.nodes.reduce<
        Record<
          string,
          {
            id: string
            workflow: TaskTypeType
            role: CoordinatorNodeType["role"]
            expert_id: string
            node_ids: string[]
            memory_namespace: string
          }
        >
      >((acc, item) => {
        if (!item.expert_id || !item.expert_role) return acc
        const id = `${item.workflow ?? input.workflow}:${item.expert_id}`
        return {
          ...acc,
          [id]: {
            id,
            workflow: item.workflow ?? input.workflow,
            role: item.role,
            expert_id: item.expert_id,
            node_ids: [...(acc[id]?.node_ids ?? []), item.id],
            memory_namespace: item.memory_namespace ?? `${input.workflow}:${item.expert_role}`,
          },
        }
      }, {}),
    ),
  )
  const long_task = longTaskProfileFor({
    goal: input.intent.goal,
    intent: input.intent,
    effort: input.effort,
    nodeCount: input.nodes.length,
    workspaceSignals: input.workspaceSignals,
  })
  const todo_timeline = todoTimelineFor({
    required: long_task.timeline_required,
    nodes: input.nodes,
    expertLanes: expert_lanes,
    workflow: input.workflow,
    activeMilestoneLimit: long_task.active_milestone_limit,
  })
  const budget_profile = budgetProfileFor({
    effort: input.effort,
    workflow: input.workflow,
    longTask: long_task,
    todoTimeline: todo_timeline,
    ...input.budgetOptions,
  })
  // A.2: filter revise nodes down to logical "gates". A legacy reviseNode is
  // already 1 node = 1 gate. An MPACR debate expands to K+3 process nodes
  // plus 1 synthesis node — only the synthesis carries `quality_gate_id`, so
  // filtering by that field collapses each debate back to a single gate.
  // Process nodes (steel_man / critics / defender / calibrator) keep their
  // node_id but do NOT spawn RevisePoints.
  const revise_points = RevisePoint.array().parse(
    input.reviseNodes
      .filter((item) => Boolean(item.quality_gate_id))
      .map((item) => {
        // For MPACR synthesis nodes the id looks like `<parent_revise_id>:synthesis`.
        // Strip the suffix so the kind classifier sees the parent prefix.
        const idForKind = item.id.endsWith(":synthesis") ? item.id.slice(0, -":synthesis".length) : item.id
        return {
          id: item.quality_gate_id ?? item.id,
          kind: idForKind.includes("input_revise")
            ? "input_revise"
            : idForKind.includes("output_revise")
              ? "output_revise"
              : idForKind.includes("handoff_revise")
                ? "handoff_revise"
                : idForKind.includes("verifier_revise")
                  ? "verifier_revise"
                  : idForKind.includes("reducer_revise")
                    ? "reducer_revise"
                    : idForKind.includes("final_revise")
                      ? "final_revise"
                      : "plan_revise",
          target_node_id: typeof item.revision_of === "string" ? item.revision_of.split(":")[0] : undefined,
          artifact_id: item.revision_of,
          required: item.priority !== "low",
          node_id: item.id,
          status: "pending",
        }
      }),
  )
  return {
    expert_lanes,
    revise_points,
    quality_gates: QualityGate.array().parse(
      revise_points.map((item) => ({
        id: item.id,
        kind: item.kind,
        node_id: item.node_id,
        artifact_id: item.artifact_id,
        status: item.status,
        required: item.required,
        issues: [],
      })),
    ),
    memory_context: {
      scopes: ["profile", "workspace"],
      workflow_tags: [`workflow:${input.workflow}`],
      expert_tags: expert_lanes.map((item) => `expert:${item.expert_id}`),
      note_ids: [],
    },
    long_task,
    todo_timeline,
    budget_profile,
    budget_state: BudgetState.parse({ budget_limited: input.budgetLimited }),
    progress_snapshot: ProgressSnapshot.parse({
      pending: todo_timeline.todos.length,
      remaining_work_score: todo_timeline.todos.length > 0 ? 1 : 0,
      evidence_coverage: 0,
      progress_score: 0,
    }),
    checkpoint_memory: CheckpointMemorySummary.parse({
      checkpoint_type: long_task.timeline_required ? "milestone_checkpoint" : undefined,
      current_milestone_id: todo_timeline.current_milestone_id,
      todo_state: todo_timeline.todos,
      next_recommended_todos: todo_timeline.todos.filter((item) => item.priority === "high").map((item) => item.id),
      milestone_summaries: todo_timeline.milestones.map((item) => `${item.id}: ${item.title}`),
      compressed_context: long_task.timeline_required
        ? `Long task checkpoint memory initialized for ${input.workflow}/${input.effort}.`
        : "",
    }),
    budget_limited: input.budgetLimited,
  }
}

function finalizeEffortPlan(input: {
  plan: CoordinatorPlanType
  intent: IntentProfileType
  nodes: CoordinatorNodeType[]
  workflow: TaskTypeType
  effort: EffortLevelType
  profile: EffortProfileType
  reviseNodes: CoordinatorNodeType[]
  budgetLimited: boolean
  budgetOptions?: BudgetOptions
  workspaceSignals?: WorkspaceSignals
}) {
  const longTask = longTaskProfileFor({
    goal: input.plan.goal,
    intent: input.intent,
    effort: input.effort,
    nodeCount: input.nodes.length,
    workspaceSignals: input.workspaceSignals,
  })
  const nodes = longTask.timeline_required
    ? [
        ...input.nodes,
        withExpertHarness(
          checkpointNode({
            id: "budget_checkpoint_synthesis",
            goal: input.plan.goal,
            workflow: input.workflow,
            effort: input.effort,
            dependsOn: sinkIDs(input.nodes),
          }),
          { workflow: input.workflow, effort: input.effort, profile: input.profile },
        ),
      ]
    : input.nodes
  return CoordinatorPlan.parse({
    ...input.plan,
    effort: input.effort,
    workflow: input.workflow,
    effort_profile: input.profile,
    nodes,
    specialization_fallback: input.workflow === "general-operations" || input.intent.workflow_confidence === "low",
    ...effortPlanMetadata({
      nodes,
      intent: input.intent,
      workflow: input.workflow,
      effort: input.effort,
      profile: input.profile,
      reviseNodes: input.reviseNodes,
      budgetLimited: input.budgetLimited,
      budgetOptions: input.budgetOptions,
      workspaceSignals: input.workspaceSignals,
    }),
  })
}

// A.2: profileOverride lets callers (tests + future config) opt MPACR on
// without rewiring the effort enum. Production code keeps passing only
// (plan, intent, effort, budgetOptions) and gets the default EffortProfile
// for that effort level — behavior unchanged.
export function applyEffortGovernance(
  plan: CoordinatorPlanType,
  intent: IntentProfileType,
  effort: EffortLevelType,
  budgetOptions?: BudgetOptions,
  profileOverride?: Partial<EffortProfileType>,
) {
  const profile = profileOverride
    ? EffortProfile.parse({ ...effortProfileFor(effort), ...profileOverride })
    : effortProfileFor(effort)
  const workflow = intent.workflow
  const workspaceSignals = workspaceSignalsForGoal(plan.goal)
  const baseNodes = (effort === "low" ? lowEffortNodes(plan.nodes) : plan.nodes).map((item) =>
    withExpertHarness(item, { workflow, effort, profile }),
  )
  const planning =
    effort === "high" || effort === "deep"
      ? Array.from({ length: profile.planning_rounds }, (_, index) =>
          withExpertHarness(
            plannerNode({
              id: `planning_round_${index + 1}`,
              round: index + 1,
              goal: plan.goal,
              workflow,
              effort,
            }),
            { workflow, effort, profile },
          ),
        )
      : []
  const planReviseGraph = planning.length
    ? reviseGraphFor(
        {
          id: "plan_revise_final",
          kind: "plan_revise",
          target: planning.at(-1),
          dependsOn: [planning.at(-1)!.id],
          goal: plan.goal,
          workflow,
          effort,
        },
        profile,
        budgetOptions,
      )
    : undefined
  const planRevise = planReviseGraph ? planReviseGraph.all : []
  // entry == synthesis (MPACR) or single reviser (legacy). Downstream nodes
  // depend on this id so the entire debate must settle before they run.
  const rootGate = planReviseGraph?.entry.id
  const gatedBase = rootGate
    ? baseNodes.map((item) =>
        item.depends_on.length === 0 ? CoordinatorNode.parse({ ...item, depends_on: [rootGate] }) : item,
      )
    : baseNodes
  const reviseNodes: CoordinatorNodeType[] = [...planRevise]
  // A.2: track logical revise units separately from physical node count.
  // MPACR debates expand 1 logical revise into K+3 nodes; only the unit count
  // gates against profile.max_revise_nodes. planRevise consumed one unit if
  // present.
  const reviseUnits = { value: planReviseGraph ? 1 : 0 }
  const budgetLimited = { value: false }
  const addReviseGraph = (graph: { entry: CoordinatorNodeType; all: CoordinatorNodeType[] }) => {
    if (reviseUnits.value >= profile.max_revise_nodes) {
      budgetLimited.value = true
      return undefined
    }
    reviseNodes.push(...graph.all)
    reviseUnits.value++
    return graph.entry.id
  }
  const addRevise = (item: CoordinatorNodeType) => addReviseGraph({ entry: item, all: [item] })

  if (effort === "high") {
    const critical = gatedBase.filter((item) => item.role === "reducer" || item.role === "verifier")
    const replacements = new Map<string, string>()
    for (const item of critical) {
      const kind = item.role === "reducer" ? "reducer_revise" : "verifier_revise"
      const id = `${item.id}_${kind}`
      const entryId = addReviseGraph(
        reviseGraphFor(
          { id, kind, target: item, dependsOn: [item.id], goal: plan.goal, workflow, effort },
          profile,
          budgetOptions,
        ),
      )
      if (entryId) replacements.set(item.id, entryId)
    }
    const rewritten = rewriteDeps(gatedBase, replacements)
    const finalDependsOn = sinkIDs(rewritten).map((item) => replacements.get(item) ?? item)
    addReviseGraph(
      reviseGraphFor(
        {
          id: "final_revise",
          kind: "final_revise",
          dependsOn: finalDependsOn,
          goal: plan.goal,
          workflow,
          effort,
        },
        profile,
        budgetOptions,
      ),
    )
    const allNodes = [...planning, ...rewriteDeps(rewritten, replacements), ...reviseNodes].map((item) =>
      withExpertHarness(item, { workflow, effort, profile }),
    )
    return finalizeEffortPlan({
      plan,
      intent,
      nodes: allNodes,
      workflow,
      effort,
      profile,
      reviseNodes,
      budgetLimited: budgetLimited.value,
      budgetOptions,
      workspaceSignals,
    })
  }

  if (effort === "deep") {
    const dependents = new Set(gatedBase.flatMap((item) => item.depends_on))
    const replacements = new Map<string, string>()
    const inputReviseByNode = new Map<string, string>()
    for (const item of gatedBase) {
      if (reviseUnits.value >= profile.max_revise_nodes) {
        budgetLimited.value = true
        continue
      }
      const inputID = `${item.id}_input_revise`
      const inputEntry = addReviseGraph(
        reviseGraphFor(
          {
            id: inputID,
            kind: "input_revise",
            target: item,
            dependsOn: item.depends_on,
            goal: plan.goal,
            workflow,
            effort,
          },
          profile,
          budgetOptions,
        ),
      )
      if (inputEntry) inputReviseByNode.set(item.id, inputEntry)
      if (reviseUnits.value >= profile.max_revise_nodes) {
        budgetLimited.value = true
        continue
      }
      const outputID = `${item.id}_output_revise`
      const outputEntry = addReviseGraph(
        reviseGraphFor(
          {
            id: outputID,
            kind: "output_revise",
            target: item,
            dependsOn: [item.id],
            goal: plan.goal,
            workflow,
            effort,
          },
          profile,
          budgetOptions,
        ),
      )
      const handoffID = `${item.id}_handoff_revise`
      if (dependents.has(item.id) && reviseUnits.value < profile.max_revise_nodes) {
        const handoffEntry = addReviseGraph(
          reviseGraphFor(
            {
              id: handoffID,
              kind: "handoff_revise",
              target: item,
              dependsOn: outputEntry ? [outputEntry] : [outputID],
              goal: plan.goal,
              workflow,
              effort,
              required: false,
            },
            profile,
            budgetOptions,
          ),
        )
        if (handoffEntry) {
          replacements.set(item.id, handoffEntry)
        } else if (outputEntry) {
          replacements.set(item.id, outputEntry)
        }
      } else if (outputEntry) {
        replacements.set(item.id, outputEntry)
      }
    }
    const rewritten = gatedBase.map((item) =>
      CoordinatorNode.parse({
        ...item,
        depends_on: inputReviseByNode.has(item.id)
          ? [inputReviseByNode.get(item.id)!]
          : item.depends_on.map((dependency) => replacements.get(dependency) ?? dependency),
      }),
    )
    addReviseGraph(
      reviseGraphFor(
        {
          id: "final_revise",
          kind: "final_revise",
          dependsOn: sinkIDs(rewritten).map((item) => replacements.get(item) ?? item),
          goal: plan.goal,
          workflow,
          effort,
        },
        profile,
        budgetOptions,
      ),
    )
    const rewrittenRevise = reviseNodes.map((item) => {
      const targetID = typeof item.revision_of === "string" ? item.revision_of.split(":")[0] : undefined
      return CoordinatorNode.parse({
        ...item,
        depends_on:
          item.id.endsWith("_output_revise") && targetID
            ? [targetID]
            : item.id.endsWith("_handoff_revise")
              ? item.depends_on
              : item.depends_on.map((dependency) => replacements.get(dependency) ?? dependency),
      })
    })
    const allNodes = [...planning, ...rewritten, ...rewrittenRevise].map((item) =>
      withExpertHarness(item, { workflow, effort, profile }),
    )
    return finalizeEffortPlan({
      plan,
      intent,
      nodes: allNodes,
      workflow,
      effort,
      profile,
      reviseNodes: rewrittenRevise,
      budgetLimited: budgetLimited.value,
      budgetOptions,
      workspaceSignals,
    })
  }

  if (effort === "medium") {
    addReviseGraph(
      reviseGraphFor(
        {
          id: "final_revise",
          kind: "final_revise",
          dependsOn: sinkIDs(gatedBase),
          goal: plan.goal,
          workflow,
          effort,
        },
        profile,
        budgetOptions,
      ),
    )
  }

  const allNodes = [...planning, ...gatedBase, ...reviseNodes].map((item) =>
    withExpertHarness(item, { workflow, effort, profile }),
  )
  return finalizeEffortPlan({
    plan,
    intent,
    nodes: allNodes,
    workflow,
    effort,
    profile,
    reviseNodes,
    budgetLimited: budgetLimited.value,
    budgetOptions,
    workspaceSignals,
  })
}

export function defaultPlanForIntent(
  intent: IntentProfileType,
  input?: { effort?: EffortLevelType; workflow?: TaskTypeType } & BudgetOptions,
): CoordinatorPlanType {
  const workflow = input?.workflow ?? intent.workflow
  const effort = input?.effort ?? "medium"
  const effectiveIntent = IntentProfile.parse({
    ...intent,
    workflow,
    task_type: workflow,
  })
  return applyEffortGovernance(basePlanForIntent(effectiveIntent), effectiveIntent, effort, input)
}
