// Factory helpers for coordinator plan nodes and expert harness metadata.
// This file does not apply effort governance, order plans, or dispatch runtime tasks.

import z from "zod"
import {
  CoordinatorNode,
  RevisePoint,
  type CoordinatorNode as CoordinatorNodeType,
  type CoordinatorNodeInput,
  type EffortLevel as EffortLevelType,
  type EffortProfile as EffortProfileType,
  type TaskType as TaskTypeType,
} from "./schema"

export function node(
  input: Omit<CoordinatorNodeInput, "priority" | "origin"> & Partial<Pick<CoordinatorNodeInput, "priority" | "origin">>,
) {
  return CoordinatorNode.parse({
    priority: "normal",
    origin: "coordinator",
    ...input,
  })
}

function expertID(workflow: TaskTypeType, role: CoordinatorNodeType["role"]) {
  return `${workflow}.${role}`.replace(/[^a-z0-9.-]/gi, "-").toLowerCase()
}

function artifactType(node: CoordinatorNodeType) {
  if (node.role === "reviser") return "revise"
  if (node.role === "reducer") return "reducer-output"
  if (node.task_kind === "verify") return "verification"
  if (node.task_kind === "implement") return "implementation"
  if (node.task_kind === "research") return "research"
  return node.output_schema
}

export function withExpertHarness(
  node: CoordinatorNodeType,
  input: {
    workflow: TaskTypeType
    effort: EffortLevelType
    profile: EffortProfileType
  },
) {
  const role = node.expert_role ?? node.role
  return CoordinatorNode.parse({
    ...node,
    workflow: node.workflow ?? input.workflow,
    expert_id: node.expert_id ?? expertID(input.workflow, node.role),
    expert_role: role,
    artifact_type: node.artifact_type ?? artifactType(node),
    artifact_id: node.artifact_id ?? `${node.id}:output`,
    memory_namespace: node.memory_namespace ?? `${input.workflow}:${role}`,
    revise_policy: node.revise_policy ?? input.profile.revise_policy,
  })
}

export function plannerNode(input: {
  id: string
  round: number
  goal: string
  workflow: TaskTypeType
  effort: EffortLevelType
}) {
  return node({
    id: input.id,
    description: `Planning round ${input.round}`,
    prompt: [
      `Create or refine the execution plan for this mission.`,
      ``,
      `Goal: ${input.goal}`,
      `Workflow: ${input.workflow}`,
      `Effort: ${input.effort}`,
      ``,
      `Return summary, assumptions, missing context, risks, confidence, and next step.`,
    ].join("\n"),
    task_kind: "generic",
    subagent_type: "general",
    role: "planner",
    risk: "low",
    depends_on: input.round === 1 ? [] : [`planning_round_${input.round - 1}`],
    write_scope: [],
    read_scope: [],
    acceptance_checks: ["Plan refined without unsupported assumptions"],
    output_schema: "plan",
    requires_user_input: false,
    priority: "high",
    expert_id: expertID(input.workflow, "planner"),
    expert_role: "planner",
    workflow: input.workflow,
    artifact_type: "plan",
    artifact_id: `${input.id}:output`,
    memory_namespace: `${input.workflow}:planner`,
  })
}

export function reviseNode(input: {
  id: string
  kind: z.infer<typeof RevisePoint>["kind"]
  target?: CoordinatorNodeType
  dependsOn: string[]
  goal: string
  workflow: TaskTypeType
  effort: EffortLevelType
  required?: boolean
}) {
  const artifactID = input.target?.artifact_id ?? `${input.target?.id ?? input.id}:artifact`
  return node({
    id: input.id,
    description: `${input.kind.replaceAll("_", " ")}${input.target ? ` for ${input.target.id}` : ""}`,
    prompt: [
      `Revise the target artifact quality without exposing chain-of-thought.`,
      ``,
      `Goal: ${input.goal}`,
      `Workflow: ${input.workflow}`,
      `Effort: ${input.effort}`,
      input.target ? `Target node: ${input.target.id}` : undefined,
      `Revise kind: ${input.kind}`,
      ``,
      `Return JSON-like fields: pass, issues, missing_context, required_changes, confidence, action.`,
    ]
      .filter((item): item is string => Boolean(item))
      .join("\n"),
    task_kind: "verify",
    subagent_type: "general",
    role: "reviser",
    risk: "low",
    depends_on: input.dependsOn,
    write_scope: [],
    read_scope: input.target?.read_scope ?? [],
    acceptance_checks: ["Artifact quality checked", "Required changes or pass/fail decision returned"],
    output_schema: "revise",
    requires_user_input: false,
    priority: input.required === false ? "low" : "normal",
    expert_id: expertID(input.workflow, "reviser"),
    expert_role: "reviser",
    workflow: input.workflow,
    artifact_type: "revise",
    artifact_id: `${input.id}:output`,
    revision_of: artifactID,
    quality_gate_id: input.id,
    memory_namespace: `${input.workflow}:reviser`,
  })
}

export function checkpointNode(input: {
  id: string
  goal: string
  workflow: TaskTypeType
  effort: EffortLevelType
  dependsOn: string[]
}) {
  return node({
    id: input.id,
    description: "Budget checkpoint synthesis",
    prompt: [
      `Summarize mission progress for a budget checkpoint without continuing exploration.`,
      ``,
      `Goal: ${input.goal}`,
      `Workflow: ${input.workflow}`,
      `Effort: ${input.effort}`,
      ``,
      `Return completed, partial, not_started, blocked, evidence_summary, unresolved_claims, quality_summary, and suggested_continuation when more work is valuable.`,
    ].join("\n"),
    task_kind: "verify",
    subagent_type: "general",
    role: "reviewer",
    risk: "low",
    depends_on: input.dependsOn,
    write_scope: [],
    read_scope: [],
    acceptance_checks: ["Progress checkpoint produced", "Continuation recommendation includes unfinished work"],
    output_schema: "summary",
    requires_user_input: false,
    priority: "normal",
    expert_id: expertID(input.workflow, "reviewer"),
    expert_role: "checkpoint-reviewer",
    workflow: input.workflow,
    artifact_type: "summary",
    artifact_id: `${input.id}:output`,
    memory_namespace: `${input.workflow}:checkpoint`,
  })
}
