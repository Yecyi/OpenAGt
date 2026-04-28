import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"
import { attachWith } from "@/effect/run-service"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { TaskRuntime } from "@/session/task-runtime"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "@/provider"
import { Database, desc, eq } from "@/storage"
import { Cause, Context, Effect, Layer, Option, Scope } from "effect"
import z from "zod"
import { CoordinatorRunTable } from "./coordinator.sql"
import { buildDebate, buildDegraded } from "./mpacr"
import { Calibration } from "./calibration"
import { PromptTemplates } from "./prompt-templates"
import { ThreeLayerMemory } from "@/personal/three-layer"
import { ExpertRegistry } from "./expert-registry"
import { BudgetTuning } from "@/agent/budget-tuning"
import {
  addResourceLimit,
  budgetProfileFor,
  longTaskProfileFor,
  scaleResourceLimit,
  type BudgetOptions,
} from "./budget-governance"
import { dispatchSelectionFor } from "./dispatch-selection"
import { effortProfileFor } from "./effort-profile"
import {
  isMpacrCriticTask,
  isMpacrReviewTask,
  mpacrQuorumEscalation,
  mpacrVerdictMetadata,
  outcomeForVerdict,
  posteriorForVerdict,
  reviewFailureMessage,
  reviewVerdictForMessage,
  reviewVerdictFromText,
  skippedReviewVerdict,
} from "./review-verdict"
import {
  planWithRuntimeState,
  resourceLimitSlots,
  resourceUsageFor,
  runtimeStateFor,
  subtractResourceLimit,
} from "./runtime-state"
import { settleIntentProfile } from "./intent-profile"
import { mpacrCriticTimeoutMs, nodeIDForTask, taskModel, taskVariant } from "./task-record"
import { messageText, promptTemplateRoleAndVariant, promptTemplateVars } from "./task-prompt"
import { checkpointNode, node, plannerNode, reviseNode, withExpertHarness } from "./plan-node-factory"
import { parallelResearchStage, parallelVerificationStage, researcher } from "./plan-stages"
import { workspaceSignalsForGoal, type WorkspaceSignals } from "./workspace-signals"
import { buildCoordinatorProjection, type CoordinatorProjection } from "./projection"
import { buildCoordinatorSummary } from "./summary"
import {
  CoordinatorNode,
  CoordinatorPlan,
  CoordinatorRun,
  CoordinatorRunID,
  CoordinatorMode,
  EffortLevel,
  EffortProfile,
  ExpertLane,
  QualityGate,
  ParallelExecutionPolicy,
  RevisePoint,
  IntentProfile,
  TaskType,
  TodoTimeline,
  BudgetProfile,
  BudgetState,
  ProgressSnapshot,
  CheckpointMemorySummary,
  ContinuationRequest,
  ResourceLimit,
  type CoordinatorNode as CoordinatorNodeType,
  type CoordinatorNodeInput,
  type AutoContinuePolicy as AutoContinuePolicyType,
  type BudgetProfile as BudgetProfileType,
  type CheckpointMemorySummary as CheckpointMemorySummaryType,
  type EffortLevel as EffortLevelType,
  type EffortProfile as EffortProfileType,
  type LongTaskProfile as LongTaskProfileType,
  type ProgressSnapshot as ProgressSnapshotType,
  type CoordinatorMode as CoordinatorModeType,
  type CoordinatorPlan as CoordinatorPlanType,
  type CoordinatorRun as CoordinatorRunType,
  type CoordinatorRunID as CoordinatorRunIDType,
  type CriticalReviewVerdict as CriticalReviewVerdictType,
  type IntentProfile as IntentProfileType,
  type ParallelExecutionPolicy as ParallelExecutionPolicyType,
  type ResourceLimit as ResourceLimitType,
  type TaskType as TaskTypeType,
  type TodoTimeline as TodoTimelineType,
} from "./schema"

export { effortProfileFor } from "./effort-profile"
export { settleIntentProfile } from "./intent-profile"

function now() {
  return Date.now()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

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

function reviseGraphFor(
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

function rewriteDeps(nodes: CoordinatorNodeType[], replacements: Map<string, string>) {
  return nodes.map((item) =>
    CoordinatorNode.parse({
      ...item,
      depends_on: item.depends_on.map((dependency) => replacements.get(dependency) ?? dependency),
    }),
  )
}

function sinkIDs(nodes: CoordinatorNodeType[]) {
  const dependencies = new Set(nodes.flatMap((item) => item.depends_on))
  return nodes.map((item) => item.id).filter((id) => !dependencies.has(id))
}

function lowEffortNodes(nodes: CoordinatorNodeType[]) {
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

function todoStage(node: CoordinatorNodeType): "plan" | "research" | "expert" | "reduce" | "verify" | "final" {
  if (node.role === "planner") return "plan"
  if (node.role === "reducer") return "reduce"
  if (node.id.includes("checkpoint") || node.output_schema === "summary") return "final"
  if (node.role === "reviewer" || node.role === "reviser" || node.task_kind === "verify") return "verify"
  if (node.task_kind === "research") return "research"
  return "expert"
}

function stageTitle(stage: ReturnType<typeof todoStage>, workflow: TaskTypeType) {
  if (stage === "plan") return `Plan ${workflow} mission`
  if (stage === "research") return `Gather ${workflow} evidence`
  if (stage === "reduce") return `Synthesize expert findings`
  if (stage === "verify") return `Critically verify outputs`
  if (stage === "final") return `Summarize progress and next steps`
  return `Execute ${workflow} expert work`
}

function todoTimelineFor(input: {
  required: boolean
  nodes: CoordinatorNodeType[]
  expertLanes: Array<{ id: string; node_ids: string[] }>
  workflow: TaskTypeType
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
  return TodoTimeline.parse({
    required: true,
    todos,
    phases: todos.map((item, index) => ({
      id: `phase_${index + 1}_${item.assigned_stage}`,
      title: item.title,
      todo_ids: [item.id],
      expected_outputs: [item.acceptance_hint || item.title],
      checkpoint_after:
        item.assigned_stage === "reduce" || item.assigned_stage === "verify" || item.assigned_stage === "final",
    })),
  })
}

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
      todo_state: todo_timeline.todos,
      next_recommended_todos: todo_timeline.todos.filter((item) => item.priority === "high").map((item) => item.id),
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

export function basePlanForIntent(intent: IntentProfileType): CoordinatorPlanType {
  const goal = intent.goal
  const researchStage = parallelResearchStage(goal)
  const researchDependsOn = ["research_synthesis"]
  return CoordinatorPlan.parse({
    goal,
    nodes:
      intent.workflow === "coding"
        ? [
            ...researchStage,
            node({
              id: "implement",
              description: "Implement change",
              prompt: `Implement the requested change using the research_synthesis handoff as the primary project context.\n\nGoal: ${goal}`,
              task_kind: "implement",
              subagent_type: "general",
              role: "implementer",
              risk: intent.risk_level,
              depends_on: researchDependsOn,
              write_scope: [],
              read_scope: [],
              acceptance_checks: ["Requested change implemented"],
              output_schema: "implementation",
              requires_user_input: false,
              priority: "high",
            }),
            ...parallelVerificationStage(goal, ["implement"]),
            node({
              id: "review",
              description: "Review result",
              prompt: `Independently review the result using research_synthesis and all verifier evidence. Judge conflicts explicitly.\n\nGoal: ${goal}`,
              task_kind: "verify",
              subagent_type: "general",
              role: "reviewer",
              risk: "low",
              depends_on: ["verify_typecheck", "verify_focused_tests", "verify_acceptance"],
              write_scope: [],
              read_scope: [],
              acceptance_checks: ["Review completed"],
              output_schema: "review",
              requires_user_input: false,
            }),
          ]
        : intent.workflow === "debugging"
          ? [
              ...researchStage,
              node({
                id: "debug",
                description: "Diagnose failure",
                prompt: `Diagnose the failure and propose the smallest fix path.\n\nGoal: ${goal}`,
                task_kind: "research",
                subagent_type: "general",
                role: "debugger",
                risk: "medium",
                depends_on: researchDependsOn,
                write_scope: [],
                read_scope: [],
                acceptance_checks: ["Root cause identified"],
                output_schema: "debug",
                requires_user_input: false,
                priority: "high",
              }),
              node({
                id: "implement",
                description: "Apply minimal fix",
                prompt: `Apply the smallest safe fix for the diagnosed issue.\n\nGoal: ${goal}`,
                task_kind: "implement",
                subagent_type: "general",
                role: "implementer",
                risk: intent.risk_level,
                depends_on: ["debug"],
                write_scope: [],
                read_scope: [],
                acceptance_checks: ["Fix applied"],
                output_schema: "implementation",
                requires_user_input: false,
                priority: "high",
              }),
              ...parallelVerificationStage(goal, ["implement"]),
              node({
                id: "review",
                description: "Review fix",
                prompt: `Review the fix using debugger output, research_synthesis, and verifier evidence.\n\nGoal: ${goal}`,
                task_kind: "verify",
                subagent_type: "general",
                role: "reviewer",
                risk: "low",
                depends_on: ["verify_typecheck", "verify_focused_tests", "verify_acceptance"],
                write_scope: [],
                read_scope: [],
                acceptance_checks: ["Fix reviewed"],
                output_schema: "review",
                requires_user_input: false,
              }),
            ]
          : intent.workflow === "review"
            ? [
                researcher(goal),
                node({
                  id: "review",
                  description: "Review work",
                  prompt: `Review the requested target and return prioritized findings only when they are actionable.\n\nGoal: ${goal}`,
                  task_kind: "verify",
                  subagent_type: "general",
                  role: "reviewer",
                  risk: "low",
                  depends_on: ["research"],
                  write_scope: [],
                  read_scope: [],
                  acceptance_checks: ["Review findings are grounded in evidence"],
                  output_schema: "review",
                  requires_user_input: false,
                  priority: "high",
                }),
              ]
            : intent.workflow === "research"
              ? [
                  ...researchStage,
                  node({
                    id: "synthesize",
                    description: "Synthesize research",
                    prompt: `Synthesize research_synthesis into actionable conclusions.\n\nGoal: ${goal}`,
                    task_kind: "generic",
                    subagent_type: "general",
                    role: "writer",
                    risk: "low",
                    depends_on: researchDependsOn,
                    write_scope: [],
                    read_scope: [],
                    acceptance_checks: ["Research report produced"],
                    output_schema: "document",
                    requires_user_input: false,
                  }),
                  node({
                    id: "review",
                    description: "Review synthesis",
                    prompt: `Review the synthesis for unsupported claims and missing caveats.\n\nGoal: ${goal}`,
                    task_kind: "verify",
                    subagent_type: "general",
                    role: "reviewer",
                    risk: "low",
                    depends_on: ["synthesize"],
                    write_scope: [],
                    read_scope: [],
                    acceptance_checks: ["Synthesis reviewed"],
                    output_schema: "review",
                    requires_user_input: false,
                  }),
                ]
              : intent.workflow === "environment-audit"
                ? [
                    node({
                      id: "audit",
                      description: "Audit environment",
                      prompt: `Inspect the local environment, dependency state, and toolchain blockers.\n\nGoal: ${goal}`,
                      task_kind: "research",
                      subagent_type: "general",
                      role: "environment-auditor",
                      risk: intent.risk_level,
                      depends_on: [],
                      write_scope: [],
                      read_scope: [],
                      acceptance_checks: ["Environment blockers identified"],
                      output_schema: "environment-diagnosis",
                      requires_user_input: false,
                      priority: "high",
                    }),
                    node({
                      id: "verify",
                      description: "Verify environment findings",
                      prompt: `Verify the audit findings with concrete checks where possible.\n\nGoal: ${goal}`,
                      task_kind: "verify",
                      subagent_type: "general",
                      role: "verifier",
                      risk: "low",
                      depends_on: ["audit"],
                      write_scope: [],
                      read_scope: [],
                      acceptance_checks: ["Findings verified"],
                      output_schema: "verification",
                      requires_user_input: false,
                    }),
                    node({
                      id: "report",
                      description: "Write environment report",
                      prompt: `Write a concise environment diagnosis with blockers and next actions.\n\nGoal: ${goal}`,
                      task_kind: "generic",
                      subagent_type: "general",
                      role: "writer",
                      risk: "low",
                      depends_on: ["verify"],
                      write_scope: [],
                      read_scope: [],
                      acceptance_checks: ["Diagnosis report produced"],
                      output_schema: "document",
                      requires_user_input: false,
                    }),
                  ]
                : intent.workflow === "writing"
                  ? [
                      node({
                        id: "outline",
                        description: "Plan writing structure",
                        prompt: `Create a concise outline with audience, purpose, claims, and constraints.\n\nGoal: ${goal}`,
                        task_kind: "research",
                        subagent_type: "general",
                        role: "planner",
                        risk: "low",
                        depends_on: [],
                        write_scope: [],
                        read_scope: [],
                        acceptance_checks: ["Audience and structure identified"],
                        output_schema: "outline",
                        requires_user_input: false,
                        priority: "high",
                      }),
                      node({
                        id: "draft",
                        description: "Write draft",
                        prompt: `Write the requested artifact from the outline. Preserve caveats and user constraints.\n\nGoal: ${goal}`,
                        task_kind: "generic",
                        subagent_type: "general",
                        role: "writer",
                        risk: intent.risk_level,
                        depends_on: ["outline"],
                        write_scope: [],
                        read_scope: [],
                        acceptance_checks: ["Draft produced"],
                        output_schema: "draft",
                        requires_user_input: false,
                      }),
                      node({
                        id: "style_review",
                        description: "Review style and factuality",
                        prompt: `Review the draft for style fit, unsupported claims, and missing caveats.\n\nGoal: ${goal}`,
                        task_kind: "verify",
                        subagent_type: "general",
                        role: "style-editor",
                        risk: "low",
                        depends_on: ["draft"],
                        write_scope: [],
                        read_scope: [],
                        acceptance_checks: ["Style and factuality reviewed"],
                        output_schema: "review",
                        requires_user_input: false,
                      }),
                    ]
                  : intent.workflow === "data-analysis"
                    ? [
                        node({
                          id: "profile_data",
                          description: "Profile data shape",
                          prompt: `Inspect the available data shape, schema, quality limits, and analysis constraints.\n\nGoal: ${goal}`,
                          task_kind: "research",
                          subagent_type: "general",
                          role: "analyst",
                          risk: "low",
                          depends_on: [],
                          write_scope: [],
                          read_scope: [],
                          acceptance_checks: ["Data schema and limits profiled"],
                          output_schema: "analysis",
                          requires_user_input: false,
                          priority: "high",
                        }),
                        node({
                          id: "analyze_data",
                          description: "Analyze data",
                          prompt: `Run the requested analysis using the profiled constraints and report caveats.\n\nGoal: ${goal}`,
                          task_kind: "generic",
                          subagent_type: "general",
                          role: "analyst",
                          risk: intent.risk_level,
                          depends_on: ["profile_data"],
                          write_scope: [],
                          read_scope: [],
                          acceptance_checks: ["Analysis completed with caveats"],
                          output_schema: "analysis",
                          requires_user_input: false,
                        }),
                        node({
                          id: "verify_stats",
                          description: "Verify statistics and anomalies",
                          prompt: `Verify calculations, statistical assumptions, anomaly handling, and unsupported conclusions.\n\nGoal: ${goal}`,
                          task_kind: "verify",
                          subagent_type: "general",
                          role: "verifier",
                          risk: "low",
                          depends_on: ["analyze_data"],
                          write_scope: [],
                          read_scope: [],
                          acceptance_checks: ["Statistics and anomalies verified"],
                          output_schema: "verification",
                          requires_user_input: false,
                        }),
                      ]
                    : intent.workflow === "planning"
                      ? [
                          node({
                            id: "decompose_goal",
                            description: "Decompose goal",
                            prompt: `Break down the goal into milestones, dependencies, risks, and decision points.\n\nGoal: ${goal}`,
                            task_kind: "generic",
                            subagent_type: "general",
                            role: "planner",
                            risk: "low",
                            depends_on: [],
                            write_scope: [],
                            read_scope: [],
                            acceptance_checks: ["Goal decomposed into actionable plan"],
                            output_schema: "plan",
                            requires_user_input: false,
                            priority: "high",
                          }),
                          node({
                            id: "check_constraints",
                            description: "Check constraints and alternatives",
                            prompt: `Check constraints, assumptions, alternatives, and failure modes in the plan.\n\nGoal: ${goal}`,
                            task_kind: "verify",
                            subagent_type: "general",
                            role: "constraint-checker",
                            risk: "low",
                            depends_on: ["decompose_goal"],
                            write_scope: [],
                            read_scope: [],
                            acceptance_checks: ["Constraints and alternatives checked"],
                            output_schema: "review",
                            requires_user_input: false,
                          }),
                          node({
                            id: "risk_review",
                            description: "Review plan risks",
                            prompt: `Review the plan for risk, sequencing, missing owners, and unclear acceptance criteria.\n\nGoal: ${goal}`,
                            task_kind: "verify",
                            subagent_type: "general",
                            role: "risk-reviewer",
                            risk: "low",
                            depends_on: ["check_constraints"],
                            write_scope: [],
                            read_scope: [],
                            acceptance_checks: ["Plan risks reviewed"],
                            output_schema: "review",
                            requires_user_input: false,
                          }),
                        ]
                      : intent.workflow === "personal-admin"
                        ? [
                            node({
                              id: "classify_inbox",
                              description: "Classify personal admin work",
                              prompt: `Classify the requested personal admin work into actions, priorities, and privacy constraints.\n\nGoal: ${goal}`,
                              task_kind: "research",
                              subagent_type: "general",
                              role: "inbox-classifier",
                              risk: "low",
                              depends_on: [],
                              write_scope: [],
                              read_scope: [],
                              acceptance_checks: ["Admin work classified"],
                              output_schema: "summary",
                              requires_user_input: false,
                              priority: "high",
                            }),
                            node({
                              id: "schedule_actions",
                              description: "Prioritize and schedule actions",
                              prompt: `Prioritize the actions and propose a safe schedule with follow-up points.\n\nGoal: ${goal}`,
                              task_kind: "generic",
                              subagent_type: "general",
                              role: "scheduler",
                              risk: intent.risk_level,
                              depends_on: ["classify_inbox"],
                              write_scope: [],
                              read_scope: [],
                              acceptance_checks: ["Actions prioritized and scheduled"],
                              output_schema: "plan",
                              requires_user_input: false,
                            }),
                            node({
                              id: "privacy_review",
                              description: "Review privacy risk",
                              prompt: `Review the proposed personal admin actions for privacy, overreach, and missing user approval.\n\nGoal: ${goal}`,
                              task_kind: "verify",
                              subagent_type: "general",
                              role: "privacy-reviewer",
                              risk: "low",
                              depends_on: ["schedule_actions"],
                              write_scope: [],
                              read_scope: [],
                              acceptance_checks: ["Privacy risk reviewed"],
                              output_schema: "review",
                              requires_user_input: false,
                            }),
                          ]
                        : intent.workflow === "documentation"
                          ? [
                              researcher(goal),
                              node({
                                id: "write",
                                description: "Write documentation",
                                prompt: `Write or update the requested documentation.\n\nGoal: ${goal}`,
                                task_kind: "implement",
                                subagent_type: "general",
                                role: "writer",
                                risk: intent.risk_level,
                                depends_on: ["research"],
                                write_scope: [],
                                read_scope: [],
                                acceptance_checks: ["Documentation produced"],
                                output_schema: "document",
                                requires_user_input: false,
                              }),
                              node({
                                id: "review",
                                description: "Review documentation",
                                prompt: `Review the documentation for accuracy and missing caveats.\n\nGoal: ${goal}`,
                                task_kind: "verify",
                                subagent_type: "general",
                                role: "reviewer",
                                risk: "low",
                                depends_on: ["write"],
                                write_scope: [],
                                read_scope: [],
                                acceptance_checks: ["Documentation reviewed"],
                                output_schema: "review",
                                requires_user_input: false,
                              }),
                            ]
                          : intent.workflow === "automation"
                            ? [
                                researcher(goal),
                                node({
                                  id: "automation_plan",
                                  description: "Plan automation",
                                  prompt: `Turn the repeatable work into an automation plan with trigger, scope, and safety checks.\n\nGoal: ${goal}`,
                                  task_kind: "generic",
                                  subagent_type: "general",
                                  role: "automation-planner",
                                  risk: intent.risk_level,
                                  depends_on: ["research"],
                                  write_scope: [],
                                  read_scope: [],
                                  acceptance_checks: ["Automation plan produced"],
                                  output_schema: "automation-plan",
                                  requires_user_input: intent.risk_level === "high",
                                }),
                                node({
                                  id: "verify",
                                  description: "Verify automation plan",
                                  prompt: `Verify the automation plan for safety, permissions, and failure modes.\n\nGoal: ${goal}`,
                                  task_kind: "verify",
                                  subagent_type: "general",
                                  role: "verifier",
                                  risk: "low",
                                  depends_on: ["automation_plan"],
                                  write_scope: [],
                                  read_scope: [],
                                  acceptance_checks: ["Automation safety reviewed"],
                                  output_schema: "verification",
                                  requires_user_input: false,
                                }),
                              ]
                            : [
                                researcher(goal),
                                node({
                                  id: "execute",
                                  description: "Execute general task",
                                  prompt: `Complete the requested work and produce the expected output.\n\nGoal: ${goal}`,
                                  task_kind: "generic",
                                  subagent_type: "general",
                                  role: intent.workflow === "file-data-organization" ? "implementer" : "writer",
                                  risk: intent.risk_level,
                                  depends_on: ["research"],
                                  write_scope: [],
                                  read_scope: [],
                                  acceptance_checks: ["Requested work completed"],
                                  output_schema: "summary",
                                  requires_user_input: intent.risk_level === "high",
                                }),
                                node({
                                  id: "review",
                                  description: "Review result",
                                  prompt: `Review the result against the goal and report residual risks.\n\nGoal: ${goal}`,
                                  task_kind: "verify",
                                  subagent_type: "general",
                                  role: "reviewer",
                                  risk: "low",
                                  depends_on: ["execute"],
                                  write_scope: [],
                                  read_scope: [],
                                  acceptance_checks: ["Result reviewed"],
                                  output_schema: "review",
                                  requires_user_input: false,
                                }),
                              ],
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

function expandVerifyNodes(plan: CoordinatorPlanType) {
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

function validatePlan(plan: CoordinatorPlanType) {
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

function orderPlan(plan: CoordinatorPlanType) {
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

function runFromRow(row: typeof CoordinatorRunTable.$inferSelect) {
  const intent = IntentProfile.safeParse(row.intent)
  const mode = CoordinatorMode.safeParse(row.mode)
  const workflow = TaskType.safeParse(row.workflow)
  const plan = CoordinatorPlan.parse(row.plan)
  const fallback = settleIntentProfile({ goal: row.goal })
  return CoordinatorRun.parse({
    id: row.id,
    sessionID: row.session_id,
    goal: row.goal,
    intent: intent.success ? intent.data : fallback,
    mode: mode.success ? mode.data : "autonomous",
    workflow: workflow.success ? workflow.data : fallback.workflow,
    effort: plan.effort,
    effort_profile: plan.effort_profile,
    state: row.state,
    plan,
    task_ids: row.task_ids,
    summary: row.summary ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      finished: row.time_finished ?? undefined,
    },
  })
}

export const Event = {
  Created: BusEvent.define("coordinator.created", CoordinatorRun),
  Updated: BusEvent.define("coordinator.updated", CoordinatorRun),
  Completed: BusEvent.define("coordinator.completed", CoordinatorRun),
}

export interface Interface {
  readonly settleIntent: (input: { goal: string }) => Effect.Effect<IntentProfileType, Error>
  readonly plan: (
    input: {
      goal: string
      nodes?: CoordinatorNodeInput[]
      intent?: IntentProfileType
      effort?: EffortLevelType
      workflow?: TaskTypeType
      parallel_policy?: Partial<ParallelExecutionPolicyType>
    } & BudgetOptions,
  ) => Effect.Effect<CoordinatorPlanType, Error>
  readonly run: (
    input: {
      sessionID: SessionID
      goal: string
      nodes?: CoordinatorNodeInput[]
      intent?: IntentProfileType
      effort?: EffortLevelType
      workflow?: TaskTypeType
      mode?: CoordinatorModeType
      approved?: boolean
      parallel_policy?: Partial<ParallelExecutionPolicyType>
    } & BudgetOptions,
  ) => Effect.Effect<CoordinatorRunType, Error>
  readonly approve: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorRunType, Error>
  readonly cancel: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorRunType, Error>
  readonly retry: (input: {
    id: CoordinatorRunIDType
    taskID?: SessionID
    nodeID?: string
  }) => Effect.Effect<CoordinatorRunType, Error>
  readonly continueRun: (input: {
    id: CoordinatorRunIDType
    budgetDelta?: Partial<ResourceLimitType>
    autoContinue?: AutoContinuePolicyType
  }) => Effect.Effect<CoordinatorRunType, Error>
  readonly get: (id: CoordinatorRunIDType) => Effect.Effect<Option.Option<CoordinatorRunType>, Error>
  readonly list: (sessionID: SessionID) => Effect.Effect<CoordinatorRunType[], Error>
  readonly dispatch: (id: CoordinatorRunIDType) => Effect.Effect<{ run: CoordinatorRunType; dispatched: number }, Error>
  readonly projection: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorProjection, Error>
  readonly resume: (id: CoordinatorRunIDType) => Effect.Effect<CoordinatorRunType, Error>
  readonly summarize: (id: CoordinatorRunIDType) => Effect.Effect<string, Error>
}

export class Service extends Context.Service<Service, Interface>()("@openagt/Coordinator") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const sessions = yield* Session.Service
    const tasks = yield* TaskRuntime.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const tlm = yield* ThreeLayerMemory.Service
    const expertRegistry = yield* ExpertRegistry.Service
    const calibration = yield* Effect.serviceOption(Calibration.Service)
    const promptTemplates = yield* Effect.serviceOption(PromptTemplates.Service)
    const scope = yield* Scope.Scope

    const publish = (
      def: typeof Event.Created | typeof Event.Updated | typeof Event.Completed,
      run: CoordinatorRunType,
    ) => bus.publish(def, run)

    const settleIntent: Interface["settleIntent"] = Effect.fn("Coordinator.settleIntent")(function* (input) {
      return settleIntentProfile(input)
    })

    const plan: Interface["plan"] = Effect.fn("Coordinator.plan")(function* (input) {
      const settled = input.intent ?? settleIntentProfile({ goal: input.goal })
      const workflow = input.workflow ?? settled.workflow
      const effort = input.effort ?? "medium"
      const intent = IntentProfile.parse({
        ...settled,
        workflow,
        task_type: workflow,
      })
      const parallel_policy = ParallelExecutionPolicy.parse(input.parallel_policy ?? {})
      const base =
        input.nodes && input.nodes.length > 0
          ? CoordinatorPlan.parse({
              goal: input.goal,
              nodes: input.nodes,
              parallel_policy,
              effort,
              workflow,
              effort_profile: effortProfileFor(effort),
            })
          : CoordinatorPlan.parse({ ...basePlanForIntent(intent), parallel_policy })
      const expanded = expandVerifyNodes(base)
      const governed = applyEffortGovernance(expanded, intent, effort, input)
      yield* Effect.try({
        try: () => validatePlan(governed),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
      yield* Effect.forEach(
        governed.nodes.flatMap((item) => (item.model ? [item.model] : [])),
        (model) => provider.getModel(ProviderID.make(model.providerID), ModelID.make(model.modelID)),
        { concurrency: BudgetTuning.concurrency.storageRead, discard: true },
      )
      const ordered = orderPlan(governed)
      // B.4 — enrich memory_context with semantic facts + procedural recipes
      // from prior sessions. Best-effort: failures degrade to the bare plan
      // so a memory backend hiccup never blocks plan creation. Provide tlm
      // explicitly so this Effect's R type stays `never` (matches Interface.plan).
      const enriched = yield* ThreeLayerMemory.enrichPlanMemory(ordered).pipe(
        Effect.provideService(ThreeLayerMemory.Service, tlm),
        Effect.catch(() => Effect.succeed(ordered)),
      )
      // C.4 — apply user-defined expert overrides. Each plan node whose role
      // matches a registered user expert's `inherits` gets prompt + expert_id
      // + memory_namespace replaced. Same best-effort posture: registry hiccup
      // never blocks plan creation.
      const finalPlan = yield* ExpertRegistry.applyUserExpertsToPlan(enriched).pipe(
        Effect.provideService(ExpertRegistry.Service, expertRegistry),
        Effect.catch(() => Effect.succeed(enriched)),
      )
      return finalPlan
    })

    const createTaskSession = Effect.fn("Coordinator.createTaskSession")(function* (input: {
      sessionID: SessionID
      node: CoordinatorNodeType
    }) {
      const fallback = input.node.task_kind === "research" ? "explore" : "general"
      const agent = (yield* agents.get(input.node.subagent_type)) ?? (yield* agents.get(fallback))
      if (!agent) throw new Error(`Coordinator could not resolve subagent ${input.node.subagent_type}`)
      return yield* sessions.create({
        parentID: input.sessionID,
        title: `${input.node.description} (@${agent.name} subagent)`,
      })
    })

    const taskPrompt = (record: TaskRuntime.TaskRecord, dependencies: TaskRuntime.TaskRecord[]) => {
      const metadata = record.metadata ?? {}
      const promptText = typeof metadata.prompt === "string" ? metadata.prompt : record.description
      const role = typeof metadata.role === "string" ? `\n\nRole: ${metadata.role}` : ""
      const risk = typeof metadata.risk === "string" ? `\nRisk: ${metadata.risk}` : ""
      const output = typeof metadata.output_schema === "string" ? `\nOutput schema: ${metadata.output_schema}` : ""
      const workflow = typeof metadata.workflow === "string" ? `\nWorkflow: ${metadata.workflow}` : ""
      const effort = typeof metadata.effort === "string" ? `\nEffort: ${metadata.effort}` : ""
      const expert = typeof metadata.expert_id === "string" ? `\nExpert: ${metadata.expert_id}` : ""
      const memoryNamespace =
        typeof metadata.memory_namespace === "string" ? `\nMemory namespace: ${metadata.memory_namespace}` : ""
      const revisePolicy =
        typeof metadata.revise_policy === "string" ? `\nRevise policy: ${metadata.revise_policy}` : ""
      const longTask =
        isRecord(metadata.long_task) && metadata.long_task.is_long_task === true ? `\nLong task: true` : ""
      const todoTimeline =
        isRecord(metadata.todo_timeline) && Array.isArray(metadata.todo_timeline.todos)
          ? `\nTodo timeline:\n${metadata.todo_timeline.todos
              .map((item) =>
                isRecord(item) ? `- ${String(item.id)}: ${String(item.title)} [${String(item.status)}]` : undefined,
              )
              .filter((item): item is string => Boolean(item))
              .join("\n")}`
          : ""
      const parallelGroup =
        typeof metadata.parallel_group === "string" ? `\nParallel group: ${metadata.parallel_group}` : ""
      const assignedScope =
        Array.isArray(metadata.assigned_scope) && metadata.assigned_scope.length
          ? `\nAssigned scope:\n${metadata.assigned_scope.map((item) => `- ${String(item)}`).join("\n")}`
          : ""
      const excludedScope =
        Array.isArray(metadata.excluded_scope) && metadata.excluded_scope.length
          ? `\nExcluded scope:\n${metadata.excluded_scope.map((item) => `- ${String(item)}`).join("\n")}`
          : ""
      const dependencySummaries = dependencies.length
        ? `\n\nCompleted dependency handoff:\n${dependencies.map((item) => `- ${item.description}: ${item.result_summary ?? item.error_summary ?? item.status}`).join("\n")}`
        : ""
      const checks = record.acceptance_checks.length
        ? `\n\nAcceptance checks:\n${record.acceptance_checks.map((item: string) => `- ${item}`).join("\n")}`
        : ""
      return `${promptText}${role}${workflow}${effort}${expert}${risk}${output}${memoryNamespace}${revisePolicy}${longTask}${todoTimeline}${parallelGroup}${assignedScope}${excludedScope}${dependencySummaries}${checks}\n\nBefore finalizing, list assumptions, check evidence support, identify missing context, and choose proceed, retry, ask_user, or handoff. Return a concise structured result with summary, evidence, assumptions, missing_context, risks, confidence, and next_step.`
    }

    const promptTemplateSelection = Effect.fn("Coordinator.promptTemplateSelection")(function* (
      runID: CoordinatorRunIDType,
      node: CoordinatorNodeType,
    ) {
      if (Option.isNone(promptTemplates)) return { prompt: node.prompt }
      const roleAndVariant = promptTemplateRoleAndVariant(node)
      const picked = yield* promptTemplates.value
        .pickVariant({ ...roleAndVariant, seed: `${runID}:${node.id}` }, promptTemplateVars(node), () => node.prompt)
        .pipe(Effect.catch(() => Effect.succeed({ template: undefined, rendered: node.prompt })))
      return {
        prompt: picked.rendered || node.prompt,
        prompt_template_role: picked.template?.role,
        prompt_template_variant: picked.template?.variant,
      }
    })

    const recordPromptOutcome = (record: TaskRuntime.TaskRecord, success: boolean) => {
      if (Option.isNone(promptTemplates)) return Effect.void
      const role =
        typeof record.metadata?.prompt_template_role === "string" ? record.metadata.prompt_template_role : undefined
      const variant =
        typeof record.metadata?.prompt_template_variant === "string"
          ? record.metadata.prompt_template_variant
          : undefined
      if (!role || !variant) return Effect.void
      return promptTemplates.value.recordOutcome({
        role,
        variant,
        success,
        task_id: record.task_id,
        expert_id: typeof record.metadata?.expert_id === "string" ? record.metadata.expert_id : undefined,
        duration_ms:
          record.started_at && record.finished_at ? Math.max(0, record.finished_at - record.started_at) : undefined,
      }).pipe(Effect.ignore)
    }

    const recordCalibrationOutcome = (record: TaskRuntime.TaskRecord, verdict: CriticalReviewVerdictType | undefined) => {
      if (!verdict || Option.isNone(calibration)) return Effect.void
      const expertID = typeof record.metadata?.expert_id === "string" ? record.metadata.expert_id : record.subagent_type
      const workflow = typeof record.metadata?.workflow === "string" ? record.metadata.workflow : "general-operations"
      return calibration.value
        .record({
          expert_id: expertID,
          workflow,
          prior: 0.5,
          posterior: posteriorForVerdict(verdict),
          outcome: outcomeForVerdict(verdict),
        })
        .pipe(Effect.ignore)
    }

    const completeMpacrCriticAsSkipped = (
      record: TaskRuntime.TaskRecord,
      reason: string,
    ): Effect.Effect<void, Error> =>
      Effect.gen(function* () {
        const completed = yield* tasks.complete({
          taskID: record.task_id,
          parentSessionID: record.parent_session_id,
          output: JSON.stringify(skippedReviewVerdict(reason)),
          metadata: {
            mpacr_skipped: true,
            mpacr_skip_reason: reason,
          },
        })
        yield* recordPromptOutcome(completed, false)
      })

    const relevantTasks = Effect.fn("Coordinator.relevantTasks")(function* (run: CoordinatorRunType) {
      const all = yield* tasks.list(SessionID.make(run.sessionID))
      const taskIDs = new Set(run.task_ids.map((item) => SessionID.make(item)))
      return all.filter((item) => taskIDs.has(item.task_id))
    })

    const persistRuntimeState = Effect.fn("Coordinator.persistRuntimeState")(function* (run: CoordinatorRunType) {
      const taskList = yield* relevantTasks(run)
      const runtime = runtimeStateFor(run, taskList)
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              plan: planWithRuntimeState(run.plan, runtime),
              time_updated: now(),
            })
            .where(eq(CoordinatorRunTable.id, run.id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, run.id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      return updated
    })

    const blockRunForBudget = Effect.fn("Coordinator.blockRunForBudget")(function* (
      run: CoordinatorRunType,
      reason: "soft" | "absolute",
    ) {
      const taskList = yield* relevantTasks(run)
      const runtime = runtimeStateFor(run, taskList)
      const summary =
        reason === "absolute"
          ? "Coordinator budget absolute ceiling reached; continuation requires user approval"
          : "Coordinator mission budget reached; checkpoint or continuation is required"
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state: "blocked",
              summary,
              plan: planWithRuntimeState(run.plan, runtime),
              time_updated: now(),
              time_finished: null,
            })
            .where(eq(CoordinatorRunTable.id, run.id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, run.id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      return updated
    })

    const executeTask: (record: TaskRuntime.TaskRecord) => Effect.Effect<void, Error> = Effect.fn(
      "Coordinator.executeTask",
    )(function* (record) {
      const prompt = yield* Effect.serviceOption(SessionPrompt.Service)
      const continueGroup = () =>
        record.group_id
          ? Effect.gen(function* () {
              const runOpt = yield* get(record.group_id as CoordinatorRunIDType)
              if (Option.isSome(runOpt)) yield* persistRuntimeState(runOpt.value).pipe(Effect.ignore)
              yield* dispatchReady(record.group_id as CoordinatorRunIDType).pipe(Effect.ignore)
            })
          : Effect.void
      const started = yield* tasks.tryStartPending(record.task_id, record.parent_session_id)
      if (!started) return
      const dependencies = (yield* tasks.list(started.parent_session_id)).filter((item) =>
        started.depends_on.includes(item.task_id),
      )
      const quorumEscalation = mpacrQuorumEscalation(started, dependencies)
      if (quorumEscalation) {
        const failed = yield* tasks.fail({
          taskID: started.task_id,
          parentSessionID: started.parent_session_id,
          error: reviewFailureMessage(quorumEscalation.verdict) ?? "MPACR quorum unmet",
          metadata: mpacrVerdictMetadata(quorumEscalation.verdict, {
            mpacr_quorum_escalated: true,
            mpacr_quorum_required: quorumEscalation.quorum,
            mpacr_quorum_substantive_count: quorumEscalation.substantive,
            mpacr_missing_critic_node_ids: quorumEscalation.missing,
          }),
        })
        yield* recordCalibrationOutcome(failed, quorumEscalation.verdict)
        yield* recordPromptOutcome(failed, false)
        yield* continueGroup()
        return
      }
      if (Option.isNone(prompt)) {
        if (isMpacrCriticTask(started.metadata)) {
          yield* completeMpacrCriticAsSkipped(
            started,
            "Coordinator executor unavailable: SessionPrompt.Service is not available",
          )
          yield* continueGroup()
          return
        }
        const failed = yield* tasks.fail({
          taskID: started.task_id,
          parentSessionID: started.parent_session_id,
          error: "Coordinator executor unavailable: SessionPrompt.Service is not available",
        })
        yield* recordPromptOutcome(failed, false)
        yield* continueGroup()
        return
      }
      const basePrompt = taskPrompt(started, dependencies)
      const promptOnce = (text: string) => {
        const effect = prompt.value.prompt({
          sessionID: started.child_session_id,
          agent: started.subagent_type,
          model: taskModel(started.metadata ?? {}),
          variant: taskVariant(started.metadata ?? {}),
          parts: [
            {
              type: "text",
              text,
            },
          ],
        })
        if (!isMpacrCriticTask(started.metadata)) return effect
        const timeoutMs = mpacrCriticTimeoutMs(started.metadata)
        return effect.pipe(
          Effect.timeout(`${timeoutMs} millis`),
          Effect.catchTag("TimeoutError", () =>
            Effect.fail(new Error(`MPACR critic timed out after ${timeoutMs}ms`)),
          ),
        )
      }
      yield* promptOnce(basePrompt)
        .pipe(
          Effect.tap((message: MessageV2.WithParts) =>
            Effect.gen(function* () {
              const firstReview = reviewVerdictForMessage(started.metadata, messageText(message), basePrompt, 0)
              const final = yield* firstReview.retryPrompt
                ? promptOnce(firstReview.retryPrompt).pipe(
                    Effect.map((retryMessage) => ({
                      message: retryMessage,
                      verdict: reviewVerdictForMessage(started.metadata, messageText(retryMessage), basePrompt, 1)
                        .verdict,
                    })),
                  )
                : Effect.succeed({ message, verdict: firstReview.verdict })
              const reviewFailure = isMpacrCriticTask(started.metadata)
                ? undefined
                : reviewFailureMessage(final.verdict)
              yield* recordCalibrationOutcome(started, final.verdict)
              if (reviewFailure) {
                const failed = yield* tasks.fail({
                  taskID: started.task_id,
                  parentSessionID: started.parent_session_id,
                  error: reviewFailure,
                  metadata:
                    final.verdict && isMpacrReviewTask(started.metadata)
                      ? mpacrVerdictMetadata(final.verdict)
                      : undefined,
                })
                yield* recordPromptOutcome(failed, false)
                return
              }
              if (isMpacrCriticTask(started.metadata) && final.verdict?.verdict === "skipped") {
                const completed = yield* tasks.complete({
                  taskID: started.task_id,
                  parentSessionID: started.parent_session_id,
                  output: JSON.stringify(final.verdict),
                  metadata: {
                    mpacr_skipped: true,
                    mpacr_skip_reason: final.verdict.unsupported_claims.join("; ") || "MPACR critic skipped",
                  },
                })
                yield* recordPromptOutcome(completed, false)
                return
              }
              const completed = yield* tasks.complete(
                final.verdict && isMpacrReviewTask(started.metadata)
                  ? {
                      taskID: started.task_id,
                      parentSessionID: started.parent_session_id,
                      output: JSON.stringify(final.verdict),
                      metadata: mpacrVerdictMetadata(final.verdict),
                    }
                  : {
                      taskID: started.task_id,
                      parentSessionID: started.parent_session_id,
                      result: final.message,
                    },
              )
              yield* recordPromptOutcome(completed, true)
            }),
          ),
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            return Effect.gen(function* () {
              const reason = error instanceof Error ? error.message : String(error)
              if (isMpacrCriticTask(started.metadata)) {
                yield* completeMpacrCriticAsSkipped(started, reason)
                return
              }
              const failed = yield* tasks.fail({
                taskID: started.task_id,
                parentSessionID: started.parent_session_id,
                error: reason,
              })
              yield* recordPromptOutcome(failed, false)
            })
          }),
          Effect.tap(continueGroup),
        )
      return
    })

    const dispatchReady: Interface["dispatch"] = Effect.fn("Coordinator.dispatchReady")(function* (id) {
      const instance = yield* InstanceState.context
      const workspace = yield* InstanceState.workspaceID
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      const run = runOpt.value
      if (run.state !== "active") {
        return yield* Effect.fail(new Error(`Coordinator run cannot dispatch from state: ${run.state}`))
      }
      const allTasks = yield* relevantTasks(run)
      const pending = allTasks.filter((item) => item.status === "pending")
      const ready = (yield* Effect.forEach(
        pending,
        (item) =>
          tasks
            .canRun({
              parentSessionID: SessionID.make(run.sessionID),
              task: item,
            })
            .pipe(Effect.map((allowed) => (allowed ? item : undefined))),
        {
          concurrency: BudgetTuning.concurrency.storageRead,
        },
      )).filter((item): item is TaskRuntime.TaskRecord => Boolean(item))
      const runtime = runtimeStateFor(run, allTasks)
      const checkpointReady = ready.find((item) => item.metadata?.coordinator_node_id === "budget_checkpoint_synthesis")
      const ceilingHit = runtime.budget_state.ceiling_hit
      const softBudgetHit = runtime.budget_state.soft_budget_used >= 1
      const usage = resourceUsageFor(run, allTasks)
      const normalAbsoluteLimit = subtractResourceLimit(
        run.plan.budget_profile.absolute_ceiling,
        run.plan.budget_profile.checkpoint_reserve,
      )
      const checkpointSlots = resourceLimitSlots(usage, run.plan.budget_profile.absolute_ceiling)
      if (ceilingHit || checkpointSlots === 0) {
        const blocked = yield* blockRunForBudget(run, "absolute")
        return {
          run: blocked,
          dispatched: 0,
        }
      }
      if (softBudgetHit && !checkpointReady) {
        const blocked = yield* blockRunForBudget(run, ceilingHit ? "absolute" : "soft")
        return {
          run: blocked,
          dispatched: 0,
        }
      }
      const selection = dispatchSelectionFor({
        run,
        allTasks,
        ready,
        checkpointReady,
        usage,
        normalAbsoluteLimit,
        checkpointSlots,
        ceilingHit,
        softBudgetHit,
      })
      if (selection.budgetSlots === 0 && selection.orderedReady.length > 0) {
        const blocked = yield* blockRunForBudget(run, "absolute")
        return {
          run: blocked,
          dispatched: 0,
        }
      }
      yield* Effect.forEach(
        selection.selected,
        (item) => attachWith(executeTask(item), { instance, workspace }).pipe(Effect.forkIn(scope)),
        {
          concurrency: BudgetTuning.concurrency.storageRead,
        },
      )
      if (selection.selected.length === 0) yield* summarize(id).pipe(Effect.ignore)
      return {
        run,
        dispatched: selection.selected.length,
      }
    })

    const subscriptionStops = new Map<string, () => void>()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const stop of subscriptionStops.values()) stop()
        subscriptionStops.clear()
      }),
    )

    const ensureSubscribed: () => Effect.Effect<void, Error> = Effect.fn("Coordinator.ensureSubscribed")(function* () {
      const instance = yield* InstanceState.context
      if (subscriptionStops.has(instance.directory)) return
      const workspace = yield* InstanceState.workspaceID
      const stopTaskSubscription = yield* bus.subscribeCallback(TaskRuntime.Event.Updated, (event) => {
        if (!event.properties.result.group_id) return
        const runID = event.properties.result.group_id as CoordinatorRunIDType
        void Effect.runPromise(
          attachWith(dispatchReady(runID), {
            instance,
            workspace,
          }).pipe(Effect.catchCause(() => Effect.void)),
        )
      })
      subscriptionStops.set(instance.directory, () => {
        stopTaskSubscription()
        subscriptionStops.delete(instance.directory)
      })
    })

    const run: Interface["run"] = Effect.fn("Coordinator.run")(function* (input) {
      yield* ensureSubscribed()
      const settled = input.intent ?? settleIntentProfile({ goal: input.goal })
      const workflow = input.workflow ?? settled.workflow
      const intent = IntentProfile.parse({
        ...settled,
        workflow,
        task_type: workflow,
      })
      const planned = yield* plan({
        goal: input.goal,
        nodes: input.nodes,
        intent,
        effort: input.effort,
        workflow,
        parallel_policy: input.parallel_policy,
        budget: input.budget,
        autoContinue: input.autoContinue,
        maxRounds: input.maxRounds,
        maxSubagents: input.maxSubagents,
        maxWallclockMs: input.maxWallclockMs,
      })
      const mode = input.mode ?? (intent.risk_level === "high" ? "assisted" : "autonomous")
      const state =
        input.approved || (mode === "autonomous" && !intent.needs_user_clarification && intent.risk_level !== "high")
          ? "active"
          : "awaiting_approval"
      const runID = CoordinatorRunID.ascending()
      const nodeTaskIDs = new Map<string, SessionID>()
      for (const node of planned.nodes) {
        const session = yield* createTaskSession({ sessionID: input.sessionID, node })
        nodeTaskIDs.set(node.id, session.id)
      }
      for (const node of planned.nodes) {
        const taskID = nodeTaskIDs.get(node.id)
        if (!taskID) continue
        const selectedPrompt = yield* promptTemplateSelection(runID, node)
        yield* tasks.create({
          parentSessionID: input.sessionID,
          childSessionID: taskID,
          groupID: runID,
          strategy: "mixed",
          taskKind: node.task_kind,
          subagentType: node.subagent_type,
          description: node.description,
          prompt: selectedPrompt.prompt,
          dependsOn: node.depends_on.flatMap((item) => {
            const dependency = nodeTaskIDs.get(item)
            return dependency ? [dependency] : []
          }),
          metadata: {
            prompt: selectedPrompt.prompt,
            prompt_template_id: node.prompt_template_id,
            prompt_template_role: selectedPrompt.prompt_template_role,
            prompt_template_variant: selectedPrompt.prompt_template_variant,
            write_scope: node.write_scope,
            read_scope: node.read_scope,
            acceptance_checks: node.acceptance_checks,
            priority: node.priority,
            origin: node.origin,
            coordinator_node_id: node.id,
            coordinator_run_id: runID,
            role: node.role,
            model: node.model,
            risk: node.risk,
            parallel_group: node.parallel_group,
            assigned_scope: node.assigned_scope,
            excluded_scope: node.excluded_scope,
            merge_status: node.merge_status,
            conflicts: node.conflicts,
            output_schema: node.output_schema,
            requires_user_input: node.requires_user_input,
            effort: planned.effort,
            effort_profile: planned.effort_profile,
            long_task: planned.long_task,
            todo_timeline: planned.todo_timeline,
            budget_profile: planned.budget_profile,
            expert_id: node.expert_id,
            expert_role: node.expert_role,
            workflow: node.workflow ?? planned.workflow,
            artifact_type: node.artifact_type,
            artifact_id: node.artifact_id,
            revision_of: node.revision_of,
            quality_gate_id: node.quality_gate_id,
            mpacr_role: node.mpacr_role,
            mpacr_perspective: node.mpacr_perspective,
            mpacr_quorum: node.mpacr_quorum,
            mpacr_critic_node_ids: node.mpacr_critic_node_ids,
            mpacr_per_critic_timeout_ms: node.mpacr_per_critic_timeout_ms,
            mpacr_degraded: node.mpacr_degraded,
            memory_namespace: node.memory_namespace,
            confidence: node.confidence,
            revise_policy: node.revise_policy,
            intent,
            mode,
          },
          writeScope: node.write_scope,
          readScope: node.read_scope,
          acceptanceChecks: node.acceptance_checks,
          priority: node.priority,
          origin: node.origin,
        })
      }
      const timestamp = now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(CoordinatorRunTable)
            .values({
              id: runID,
              session_id: input.sessionID,
              goal: input.goal,
              intent,
              mode,
              workflow: intent.workflow,
              state,
              plan: planned,
              task_ids: [...nodeTaskIDs.values()],
              time_created: timestamp,
              time_updated: timestamp,
            })
            .run(),
        ),
      )
      const created = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, runID)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Created, created)
      if (created.state === "active") yield* dispatchReady(created.id)
      return created
    })

    const get: Interface["get"] = Effect.fn("Coordinator.get")(function* (id) {
      yield* ensureSubscribed()
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
      )
      return row ? Option.some(runFromRow(row)) : Option.none()
    })

    const list: Interface["list"] = Effect.fn("Coordinator.list")(function* (sessionID) {
      yield* ensureSubscribed()
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(CoordinatorRunTable)
            .where(eq(CoordinatorRunTable.session_id, sessionID))
            .orderBy(desc(CoordinatorRunTable.time_created))
            .all(),
        ),
      )
      return rows.map(runFromRow)
    })

    const projection: Interface["projection"] = Effect.fn("Coordinator.projection")(function* (id) {
      yield* ensureSubscribed()
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      const run = runOpt.value
      const taskList = yield* relevantTasks(run)
      const runtime = runtimeStateFor(run, taskList)
      return buildCoordinatorProjection({ run, taskList, runtime })
    })

    const summarize: Interface["summarize"] = Effect.fn("Coordinator.summarize")(function* (id) {
      yield* ensureSubscribed()
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      const info = runOpt.value
      if (info.state === "cancelled") return info.summary ?? "Run cancelled"
      const taskIDs = info.task_ids.map((item) => SessionID.make(item))
      const all = yield* tasks.list(SessionID.make(info.sessionID))
      const relevant = all.filter((item: (typeof all)[number]) => taskIDs.includes(item.task_id))
      const { summary, state } = buildCoordinatorSummary(relevant)
      const runtime = runtimeStateFor(info, relevant)
      const finished = state === "completed" || state === "failed" || state === "cancelled" ? now() : null
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state,
              summary,
              plan: planWithRuntimeState(info.plan, runtime),
              time_updated: now(),
              time_finished: finished,
            })
            .where(eq(CoordinatorRunTable.id, id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(state === "completed" ? Event.Completed : Event.Updated, updated)
      return summary
    })

    const activateRun = Effect.fn("Coordinator.activateRun")(function* (id: CoordinatorRunIDType) {
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      if (runOpt.value.state === "completed" || runOpt.value.state === "failed" || runOpt.value.state === "cancelled")
        return runOpt.value
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state: "active",
              summary: "Coordinator run active",
              time_updated: now(),
              time_finished: null,
            })
            .where(eq(CoordinatorRunTable.id, id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      return updated
    })

    const approve: Interface["approve"] = Effect.fn("Coordinator.approve")(function* (id) {
      yield* ensureSubscribed()
      const current = yield* get(id)
      if (Option.isNone(current)) throw new Error(`Coordinator run not found: ${id}`)
      if (current.value.state !== "awaiting_approval" && current.value.state !== "planned") {
        return yield* Effect.fail(new Error(`Coordinator run cannot be approved from state: ${current.value.state}`))
      }
      const activated = yield* activateRun(id)
      if (activated.state === "active") yield* dispatchReady(id)
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      return runOpt.value
    })

    const cancel: Interface["cancel"] = Effect.fn("Coordinator.cancel")(function* (id) {
      yield* ensureSubscribed()
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      if (runOpt.value.state === "completed" || runOpt.value.state === "failed" || runOpt.value.state === "cancelled") {
        return yield* Effect.fail(new Error(`Coordinator run cannot be cancelled from state: ${runOpt.value.state}`))
      }
      const taskList = yield* relevantTasks(runOpt.value)
      const prompt = yield* Effect.serviceOption(SessionPrompt.Service)
      const timestamp = now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state: "cancelled",
              summary: "Coordinator run cancelled",
              time_updated: timestamp,
              time_finished: timestamp,
            })
            .where(eq(CoordinatorRunTable.id, id))
            .run(),
        ),
      )
      yield* Effect.forEach(
        taskList.filter((item) => item.status === "pending" || item.status === "running"),
        (item) =>
          Effect.gen(function* () {
            if (item.status === "running" && Option.isSome(prompt)) {
              yield* prompt.value.cancel(item.child_session_id).pipe(Effect.ignore)
            }
            yield* tasks.cancel({
              taskID: item.task_id,
              parentSessionID: item.parent_session_id,
              reason: "Coordinator run cancelled",
            })
          }),
        {
          concurrency: BudgetTuning.concurrency.storageRead,
        },
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      return updated
    })

    const retry: Interface["retry"] = Effect.fn("Coordinator.retry")(function* (input) {
      yield* ensureSubscribed()
      const runOpt = yield* get(input.id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${input.id}`)
      if (runOpt.value.state === "active" || runOpt.value.state === "awaiting_approval") {
        return yield* Effect.fail(new Error(`Coordinator run cannot be retried from state: ${runOpt.value.state}`))
      }
      const taskList = yield* relevantTasks(runOpt.value)
      const retryable = taskList
        .filter((item) => item.status === "failed" || item.status === "cancelled" || item.status === "partial")
        .filter((item) => {
          if (input.taskID) return item.task_id === input.taskID
          if (input.nodeID) return item.metadata?.coordinator_node_id === input.nodeID
          return true
        })
      if (retryable.length === 0) return yield* Effect.fail(new Error("No retryable coordinator tasks matched"))
      yield* Effect.forEach(
        retryable,
        (item) =>
          tasks.retry({
            taskID: item.task_id,
            parentSessionID: item.parent_session_id,
          }),
        {
          concurrency: BudgetTuning.concurrency.storageRead,
          discard: true,
        },
      )
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state: "active",
              summary: "Coordinator run retrying",
              time_updated: now(),
              time_finished: null,
            })
            .where(eq(CoordinatorRunTable.id, input.id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, input.id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      yield* dispatchReady(input.id).pipe(Effect.ignore)
      const refreshed = yield* get(input.id)
      if (Option.isNone(refreshed)) throw new Error(`Coordinator run not found: ${input.id}`)
      return refreshed.value
    })

    const continueRun: Interface["continueRun"] = Effect.fn("Coordinator.continueRun")(function* (input) {
      yield* ensureSubscribed()
      const runOpt = yield* get(input.id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${input.id}`)
      if (runOpt.value.state !== "blocked" && runOpt.value.state !== "active") {
        return yield* Effect.fail(new Error(`Coordinator run cannot continue from state: ${runOpt.value.state}`))
      }
      const taskList = yield* relevantTasks(runOpt.value)
      const runtime = runtimeStateFor(runOpt.value, taskList)
      const requested = input.budgetDelta ?? runtime.continuation_request?.requested_budget_delta
      if (!requested) {
        return yield* Effect.fail(
          new Error("Coordinator continue requires an active continuation request or explicit budgetDelta"),
        )
      }
      const delta = requested
      const fullDelta = ResourceLimit.parse({
        max_rounds: delta.max_rounds ?? 0,
        max_model_calls: delta.max_model_calls ?? 0,
        max_tool_calls: delta.max_tool_calls ?? 0,
        max_subagents: delta.max_subagents ?? 0,
        max_wallclock_ms: delta.max_wallclock_ms ?? 0,
        max_estimated_tokens: delta.max_estimated_tokens ?? 0,
      })
      const budget_profile = BudgetProfile.parse({
        ...runOpt.value.plan.budget_profile,
        auto_continue: input.autoContinue ?? runOpt.value.plan.budget_profile.auto_continue,
        mission_ceiling: addResourceLimit(runOpt.value.plan.budget_profile.mission_ceiling, delta),
        absolute_ceiling: addResourceLimit(runOpt.value.plan.budget_profile.absolute_ceiling, delta),
        phase_ceiling: addResourceLimit(
          runOpt.value.plan.budget_profile.phase_ceiling,
          scaleResourceLimit(fullDelta, 0.5),
        ),
        checkpoint_reserve: addResourceLimit(
          runOpt.value.plan.budget_profile.checkpoint_reserve,
          scaleResourceLimit(fullDelta, 0.1),
        ),
      })
      const plan = CoordinatorPlan.parse({
        ...planWithRuntimeState(runOpt.value.plan, runtime),
        budget_profile,
        budget_state: BudgetState.parse({}),
        continuation_request: undefined,
      })
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(CoordinatorRunTable)
            .set({
              state: "active",
              summary: "Coordinator run continued with approved budget",
              plan,
              time_updated: now(),
              time_finished: null,
            })
            .where(eq(CoordinatorRunTable.id, input.id))
            .run(),
        ),
      )
      const updated = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, input.id)).get()),
      ).pipe(Effect.map((row) => runFromRow(row!)))
      yield* publish(Event.Updated, updated)
      yield* dispatchReady(input.id).pipe(Effect.ignore)
      const refreshed = yield* get(input.id)
      if (Option.isNone(refreshed)) throw new Error(`Coordinator run not found: ${input.id}`)
      return refreshed.value
    })

    const resume: Interface["resume"] = Effect.fn("Coordinator.resume")(function* (id) {
      yield* ensureSubscribed()
      const current = yield* get(id)
      if (Option.isNone(current)) throw new Error(`Coordinator run not found: ${id}`)
      if (current.value.state !== "blocked" && current.value.state !== "active") {
        return yield* Effect.fail(new Error(`Coordinator run cannot be resumed from state: ${current.value.state}`))
      }
      const activated = yield* activateRun(id)
      if (activated.state !== "active") return activated
      yield* dispatchReady(id).pipe(Effect.ignore)
      const runOpt = yield* get(id)
      if (Option.isNone(runOpt)) throw new Error(`Coordinator run not found: ${id}`)
      return runOpt.value
    })

    return Service.of({
      settleIntent,
      plan,
      run,
      approve,
      cancel,
      retry,
      continueRun,
      get,
      list,
      dispatch: dispatchReady,
      projection,
      resume,
      summarize,
    })
  }),
)

// ThreeLayerMemory and ExpertRegistry are NOT bundled here (they would create
// a circular import via personal.ts → coordinator.ts). AppRuntime's mergeAll
// composes them at the peer level so the Coordinator's runtime Service
// requirements are satisfied at the merged layer.
export const defaultLayer = layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(TaskRuntime.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(Agent.defaultLayer),
  Layer.provide(Provider.defaultLayer),
)

export * as Coordinator from "./coordinator"
