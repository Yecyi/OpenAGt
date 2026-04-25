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
  "researcher",
  "reducer",
  "implementer",
  "verifier",
  "reviewer",
  "debugger",
  "writer",
  "environment-auditor",
  "memory-curator",
  "automation-planner",
])
export type CoordinatorNodeRole = z.infer<typeof CoordinatorNodeRole>

export const CoordinatorOutputSchema = z.enum([
  "research",
  "implementation",
  "verification",
  "review",
  "debug",
  "document",
  "environment-diagnosis",
  "automation-plan",
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

export const IntentProfile = z.object({
  goal: z.string(),
  task_type: TaskType,
  success_criteria: z.array(z.string()),
  risk_level: RiskLevel,
  needs_user_clarification: z.boolean(),
  clarification_questions: z.array(z.string()),
  workflow: TaskType,
  expected_output: z.string(),
  permission_expectations: z.array(z.string()),
})
export type IntentProfile = z.infer<typeof IntentProfile>

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
})
export type CoordinatorNode = z.infer<typeof CoordinatorNode>
export type CoordinatorNodeInput = z.input<typeof CoordinatorNode>

export const CoordinatorPlan = z.object({
  goal: z.string(),
  nodes: z.array(CoordinatorNode),
  parallel_policy: ParallelExecutionPolicy.default({
    mode: "safe",
    max_parallel_agents: 4,
    max_parallel_tools: 8,
    read_only_parallel_allowed: true,
    write_parallel_requires_disjoint_scope: true,
    merge_strategy: "research-synthesis",
    conflict_resolution_strategy: "targeted-research",
  }),
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
