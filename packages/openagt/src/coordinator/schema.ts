import { Schema } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import { ZodOverride } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const coordinatorRunIdSchema = Schema.String.annotate({ [ZodOverride]: Identifier.schema("coordinator") }).pipe(
  Schema.brand("CoordinatorRunID"),
)

export type CoordinatorRunID = typeof coordinatorRunIdSchema.Type

export const CoordinatorRunID = coordinatorRunIdSchema.pipe(
  withStatics((schema: typeof coordinatorRunIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("coordinator", id)),
    zod: Identifier.schema("coordinator").pipe(z.custom<CoordinatorRunID>()),
  })),
)

export const NodePriority = z.enum(["high", "normal", "low"])
export type NodePriority = z.infer<typeof NodePriority>

export const TaskOrigin = z.enum(["user", "coordinator", "scheduler", "gateway"])
export type TaskOrigin = z.infer<typeof TaskOrigin>

export const TaskType = z.enum([
  "coding",
  "review",
  "debugging",
  "research",
  "writing",
  "data-analysis",
  "planning",
  "personal-admin",
  "documentation",
  "environment-audit",
  "automation",
  "file-data-organization",
  "general-operations",
])
export type TaskType = z.infer<typeof TaskType>

export const RiskLevel = z.enum(["low", "medium", "high"])
export type RiskLevel = z.infer<typeof RiskLevel>

export const CoordinatorMode = z.enum(["manual", "assisted", "autonomous"])
export type CoordinatorMode = z.infer<typeof CoordinatorMode>

export const CoordinatorParallelMode = z.enum(["off", "safe", "aggressive"])
export type CoordinatorParallelMode = z.infer<typeof CoordinatorParallelMode>

export const EffortLevel = z.enum(["low", "medium", "high", "deep"])
export type EffortLevel = z.infer<typeof EffortLevel>

export const ConfidenceLevel = z.enum(["low", "medium", "high"])
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>

export const RevisePolicy = z.enum(["none", "critical_only", "all_artifacts"])
export type RevisePolicy = z.infer<typeof RevisePolicy>

export const ReviseKind = z.enum([
  "plan_revise",
  "input_revise",
  "output_revise",
  "handoff_revise",
  "reducer_revise",
  "verifier_revise",
  "debugger_revise",
  "final_revise",
])
export type ReviseKind = z.infer<typeof ReviseKind>

export const ParallelExecutionPolicy = z.object({
  mode: CoordinatorParallelMode.default("safe"),
  max_parallel_agents: z.number().int().min(1).max(16).default(4),
  max_parallel_tools: z.number().int().min(1).max(32).default(8),
  read_only_parallel_allowed: z.boolean().default(true),
  write_parallel_requires_disjoint_scope: z.boolean().default(true),
  merge_strategy: z.enum(["none", "research-synthesis", "verification-evidence"]).default("research-synthesis"),
  conflict_resolution_strategy: z.enum(["block", "targeted-research", "reviewer-judgement"]).default("targeted-research"),
})
export type ParallelExecutionPolicy = z.infer<typeof ParallelExecutionPolicy>

export const CoordinatorNodeRole = z.enum([
  "coordinator",
  "planner",
  "researcher",
  "reducer",
  "implementer",
  "verifier",
  "reviewer",
  "debugger",
  "reviser",
  "writer",
  "analyst",
  "style-editor",
  "factuality-checker",
  "citation-auditor",
  "contradiction-checker",
  "constraint-checker",
  "alternative-planner",
  "risk-reviewer",
  "inbox-classifier",
  "priority-sorter",
  "scheduler",
  "privacy-reviewer",
  "follow-up-planner",
  "trigger-designer",
  "dry-run-verifier",
  "rollback-planner",
  "doc-researcher",
  "structure-writer",
  "environment-auditor",
  "blocker-classifier",
  "remediation-planner",
  "inventory-agent",
  "organizer",
  "safety-verifier",
  "executor",
  "memory-curator",
  "automation-planner",
])
export type CoordinatorNodeRole = z.infer<typeof CoordinatorNodeRole>

export const CoordinatorOutputSchema = z.enum([
  "plan",
  "research",
  "implementation",
  "verification",
  "review",
  "revise",
  "debug",
  "document",
  "analysis",
  "outline",
  "draft",
  "environment-diagnosis",
  "automation-plan",
  "organization-plan",
  "memory",
  "research-synthesis",
  "summary",
])
export type CoordinatorOutputSchema = z.infer<typeof CoordinatorOutputSchema>

export const CoordinatorModel = z.object({
  providerID: z.string(),
  modelID: z.string(),
  variant: z.string().optional(),
})
export type CoordinatorModel = z.infer<typeof CoordinatorModel>

export const EffortProfile = z.object({
  planning_rounds: z.number().int().min(1).max(8),
  expert_count_min: z.number().int().min(1).max(16),
  expert_count_max: z.number().int().min(1).max(16),
  verifier_count_min: z.number().int().min(0).max(8),
  reducer_enabled: z.boolean(),
  reviewer_enabled: z.boolean(),
  debugger_enabled: z.boolean(),
  revise_policy: RevisePolicy,
  max_revise_nodes: z.number().int().min(0).max(64),
  max_revision_per_artifact: z.number().int().min(0).max(8),
  reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
  timeout_multiplier: z.number().min(0.25).max(10),
})
export type EffortProfile = z.infer<typeof EffortProfile>

export const defaultEffortProfile = {
  planning_rounds: 1,
  expert_count_min: 1,
  expert_count_max: 2,
  verifier_count_min: 1,
  reducer_enabled: false,
  reviewer_enabled: false,
  debugger_enabled: false,
  revise_policy: "none",
  max_revise_nodes: 0,
  max_revision_per_artifact: 0,
  timeout_multiplier: 1,
} as const satisfies EffortProfile

export const IntentProfile = z.object({
  goal: z.string(),
  task_type: TaskType,
  success_criteria: z.array(z.string()),
  risk_level: RiskLevel,
  needs_user_clarification: z.boolean(),
  clarification_questions: z.array(z.string()),
  workflow: TaskType,
  workflow_confidence: ConfidenceLevel.default("medium"),
  secondary_workflows: z.array(TaskType).default([]),
  expected_output: z.string(),
  permission_expectations: z.array(z.string()),
})
export type IntentProfile = z.infer<typeof IntentProfile>

export const ExpertLane = z.object({
  id: z.string(),
  workflow: TaskType,
  role: CoordinatorNodeRole,
  expert_id: z.string(),
  node_ids: z.array(z.string()),
  memory_namespace: z.string(),
})
export type ExpertLane = z.infer<typeof ExpertLane>

export const QualityGate = z.object({
  id: z.string(),
  kind: ReviseKind,
  node_id: z.string().optional(),
  artifact_id: z.string().optional(),
  status: z.enum(["pending", "running", "passed", "failed", "skipped"]).default("pending"),
  required: z.boolean().default(true),
  confidence: ConfidenceLevel.optional(),
  issues: z.array(z.string()).default([]),
})
export type QualityGate = z.infer<typeof QualityGate>

export const RevisePoint = z.object({
  id: z.string(),
  kind: ReviseKind,
  target_node_id: z.string().optional(),
  artifact_id: z.string().optional(),
  required: z.boolean().default(true),
  node_id: z.string().optional(),
  status: z.enum(["pending", "running", "passed", "failed", "skipped"]).default("pending"),
})
export type RevisePoint = z.infer<typeof RevisePoint>

export const MemoryContext = z.object({
  scopes: z.array(z.enum(["profile", "workspace", "session"])).default(["profile", "workspace"]),
  workflow_tags: z.array(z.string()).default([]),
  expert_tags: z.array(z.string()).default([]),
  note_ids: z.array(z.string()).default([]),
})
export type MemoryContext = z.infer<typeof MemoryContext>

export const CoordinatorNode = z.object({
  id: z.string(),
  description: z.string(),
  prompt: z.string(),
  task_kind: z.enum(["research", "implement", "verify", "generic"]),
  subagent_type: z.string(),
  role: CoordinatorNodeRole.default("coordinator"),
  model: CoordinatorModel.optional(),
  risk: RiskLevel.default("medium"),
  depends_on: z.array(z.string()),
  write_scope: z.array(z.string()),
  read_scope: z.array(z.string()),
  parallel_group: z.string().optional(),
  assigned_scope: z.array(z.string()).default([]),
  excluded_scope: z.array(z.string()).default([]),
  merge_status: z.enum(["none", "waiting", "merged", "conflict"]).default("none"),
  conflicts: z.array(z.string()).default([]),
  acceptance_checks: z.array(z.string()),
  output_schema: CoordinatorOutputSchema.default("summary"),
  requires_user_input: z.boolean().default(false),
  priority: NodePriority,
  origin: TaskOrigin,
  expert_id: z.string().optional(),
  expert_role: z.string().optional(),
  workflow: TaskType.optional(),
  artifact_type: z.string().optional(),
  artifact_id: z.string().optional(),
  revision_of: z.string().optional(),
  quality_gate_id: z.string().optional(),
  memory_namespace: z.string().optional(),
  confidence: ConfidenceLevel.optional(),
  revise_policy: RevisePolicy.optional(),
})
export type CoordinatorNode = z.infer<typeof CoordinatorNode>
export type CoordinatorNodeInput = z.input<typeof CoordinatorNode>

export const CoordinatorPlan = z.object({
  goal: z.string(),
  nodes: z.array(CoordinatorNode),
  effort: EffortLevel.default("medium"),
  workflow: TaskType.default("general-operations"),
  effort_profile: EffortProfile.default(defaultEffortProfile),
  parallel_policy: ParallelExecutionPolicy.default({
    mode: "safe",
    max_parallel_agents: 4,
    max_parallel_tools: 8,
    read_only_parallel_allowed: true,
    write_parallel_requires_disjoint_scope: true,
    merge_strategy: "research-synthesis",
    conflict_resolution_strategy: "targeted-research",
  }),
  expert_lanes: z.array(ExpertLane).default([]),
  quality_gates: z.array(QualityGate).default([]),
  revise_points: z.array(RevisePoint).default([]),
  memory_context: MemoryContext.default({
    scopes: ["profile", "workspace"],
    workflow_tags: [],
    expert_tags: [],
    note_ids: [],
  }),
  budget_limited: z.boolean().default(false),
  specialization_fallback: z.boolean().default(false),
})
export type CoordinatorPlan = z.infer<typeof CoordinatorPlan>

export const CoordinatorRunState = z.enum([
  "settling_intent",
  "awaiting_approval",
  "planned",
  "active",
  "blocked",
  "completed",
  "failed",
  "cancelled",
])
export type CoordinatorRunState = z.infer<typeof CoordinatorRunState>

export const CoordinatorRun = z.object({
  id: CoordinatorRunID.zod,
  sessionID: z.string(),
  goal: z.string(),
  intent: IntentProfile,
  mode: CoordinatorMode,
  workflow: TaskType,
  effort: EffortLevel,
  effort_profile: EffortProfile,
  state: CoordinatorRunState,
  plan: CoordinatorPlan,
  task_ids: z.array(z.string()),
  summary: z.string().optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    finished: z.number().optional(),
  }),
})
export type CoordinatorRun = z.infer<typeof CoordinatorRun>

export * as CoordinatorSchema from "./schema"
