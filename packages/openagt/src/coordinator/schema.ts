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

export const TaskSize = z.enum(["small", "medium", "large", "huge"])
export type TaskSize = z.infer<typeof TaskSize>

export const BudgetScale = z.enum(["small", "normal", "large", "max"])
export type BudgetScale = z.infer<typeof BudgetScale>

export const AutoContinuePolicy = z.enum(["never", "checkpoint", "safe"])
export type AutoContinuePolicy = z.infer<typeof AutoContinuePolicy>

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
  // MPACR (Multi-Perspective Adversarial Critical Review) stages.
  "steel_man",
  "red_team",
  "defense",
  "synthesis",
  "calibration",
])
export type ReviseKind = z.infer<typeof ReviseKind>

export const ParallelExecutionPolicy = z.object({
  mode: CoordinatorParallelMode.default("safe"),
  max_parallel_agents: z.number().int().min(1).max(16).default(4),
  max_parallel_tools: z.number().int().min(1).max(32).default(8),
  read_only_parallel_allowed: z.boolean().default(true),
  write_parallel_requires_disjoint_scope: z.boolean().default(true),
  merge_strategy: z.enum(["none", "research-synthesis", "verification-evidence"]).default("research-synthesis"),
  conflict_resolution_strategy: z
    .enum(["block", "targeted-research", "reviewer-judgement"])
    .default("targeted-research"),
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
  // MPACR (Multi-Perspective Adversarial Critical Review) roles.
  "steel-manner",
  "red-team-critic",
  "defender",
  "synth-reviser",
  "calibrator",
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
  // MPACR (Multi-Perspective Adversarial Critical Review) controls.
  // Disabled by default to preserve current behavior. Enable explicitly per
  // effort level via effortProfileFor() once Stream A integration lands.
  mpacr_enabled: z.boolean().default(false),
  mpacr_critic_count: z.number().int().min(2).max(6).default(3),
  mpacr_per_critic_timeout_ms: z.number().int().min(30_000).max(900_000).default(180_000),
})
export type EffortProfile = z.infer<typeof EffortProfile>

export const LongTaskProfile = z.object({
  is_long_task: z.boolean().default(false),
  task_size: TaskSize.default("small"),
  timeline_required: z.boolean().default(false),
  reasons: z.array(z.string()).default([]),
})
export type LongTaskProfile = z.infer<typeof LongTaskProfile>

export const TodoStatus = z.enum(["pending", "active", "done", "partial", "blocked", "skipped"])
export type TodoStatus = z.infer<typeof TodoStatus>

export const TodoStage = z.enum(["plan", "research", "expert", "reduce", "verify", "final"])
export type TodoStage = z.infer<typeof TodoStage>

export const TimelineTodo = z.object({
  id: z.string(),
  title: z.string(),
  status: TodoStatus.default("pending"),
  priority: NodePriority.default("normal"),
  budget_weight: z.number().min(0.1).max(100).default(1),
  acceptance_hint: z.string().default(""),
  depends_on: z.array(z.string()).default([]),
  assigned_stage: TodoStage.default("expert"),
  node_ids: z.array(z.string()).default([]),
  expert_lane_ids: z.array(z.string()).default([]),
})
export type TimelineTodo = z.infer<typeof TimelineTodo>

export const TimelinePhase = z.object({
  id: z.string(),
  title: z.string(),
  todo_ids: z.array(z.string()).default([]),
  expected_outputs: z.array(z.string()).default([]),
  checkpoint_after: z.boolean().default(false),
})
export type TimelinePhase = z.infer<typeof TimelinePhase>

export const TodoTimeline = z.object({
  required: z.boolean().default(false),
  todos: z.array(TimelineTodo).default([]),
  phases: z.array(TimelinePhase).default([]),
})
export type TodoTimeline = z.infer<typeof TodoTimeline>

export const ResourceLimit = z.object({
  max_rounds: z.number().int().min(0).max(10_000),
  max_model_calls: z.number().int().min(0).max(20_000),
  max_tool_calls: z.number().int().min(0).max(100_000),
  max_subagents: z.number().int().min(0).max(10_000),
  max_wallclock_ms: z
    .number()
    .int()
    .min(0)
    .max(14 * 24 * 60 * 60 * 1000),
  max_estimated_tokens: z.number().int().min(0).max(100_000_000),
})
export type ResourceLimit = z.infer<typeof ResourceLimit>

export const defaultResourceLimit = {
  max_rounds: 12,
  max_model_calls: 32,
  max_tool_calls: 160,
  max_subagents: 8,
  max_wallclock_ms: 45 * 60 * 1000,
  max_estimated_tokens: 500_000,
} as const satisfies ResourceLimit

export const BudgetProfile = z.object({
  scale: BudgetScale.default("normal"),
  auto_continue: AutoContinuePolicy.default("checkpoint"),
  mission_ceiling: ResourceLimit.default(defaultResourceLimit),
  phase_ceiling: ResourceLimit.default(defaultResourceLimit),
  todo_budget: z.record(z.string(), ResourceLimit).default({}),
  checkpoint_reserve: ResourceLimit.default({
    max_rounds: 2,
    max_model_calls: 3,
    max_tool_calls: 12,
    max_subagents: 1,
    max_wallclock_ms: 10 * 60 * 1000,
    max_estimated_tokens: 50_000,
  }),
  absolute_ceiling: ResourceLimit.default(defaultResourceLimit),
  single_checkpoint_ceiling: ResourceLimit.default({
    max_rounds: 24,
    max_model_calls: 40,
    max_tool_calls: 240,
    max_subagents: 16,
    max_wallclock_ms: 45 * 60 * 1000,
    max_estimated_tokens: 1_000_000,
  }),
  no_progress_stop: z
    .object({
      checkpoint_window: z.number().int().min(1).max(20).default(5),
      min_new_completed_todo_weight: z.number().min(0).max(1).default(0.05),
      min_new_evidence_items: z.number().int().min(0).max(100).default(3),
      min_quality_delta: z.number().min(0).max(1).default(0.03),
    })
    .default({
      checkpoint_window: 5,
      min_new_completed_todo_weight: 0.05,
      min_new_evidence_items: 3,
      min_quality_delta: 0.03,
    }),
})
export type BudgetProfile = z.infer<typeof BudgetProfile>

export const BudgetState = z.object({
  soft_budget_used: z.number().min(0).max(1).default(0),
  absolute_ceiling_used: z.number().min(0).max(1).default(0),
  checkpoint_count: z.number().int().min(0).default(0),
  budget_limited: z.boolean().default(false),
  ceiling_hit: z.boolean().default(false),
})
export type BudgetState = z.infer<typeof BudgetState>

export const ProgressSnapshot = z.object({
  done: z.number().int().min(0).default(0),
  partial: z.number().int().min(0).default(0),
  blocked: z.number().int().min(0).default(0),
  pending: z.number().int().min(0).default(0),
  progress_score: z.number().min(0).max(1).default(0),
  evidence_coverage: z.number().min(0).max(1).default(0),
  verifier_quality: z.number().min(0).max(1).default(0),
  tool_success_rate: z.number().min(0).max(1).default(1),
  remaining_work_score: z.number().min(0).max(1).default(1),
  failure_penalty: z.number().min(0).max(1).default(0),
  confidence: ConfidenceLevel.default("medium"),
})
export type ProgressSnapshot = z.infer<typeof ProgressSnapshot>

export const ContinuationRequest = z.object({
  reason: z.string(),
  requested_budget_delta: ResourceLimit,
  next_todos: z.array(z.string()).default([]),
  expected_value: z.string(),
  requires_user_approval: z.boolean().default(true),
})
export type ContinuationRequest = z.infer<typeof ContinuationRequest>

export const CheckpointMemorySummary = z.object({
  run_id: z.string().optional(),
  checkpoint_id: z.string().optional(),
  todo_state: z.array(TimelineTodo).default([]),
  completed_artifacts: z.array(z.string()).default([]),
  evidence_index: z.array(z.string()).default([]),
  unresolved_claims: z.array(z.string()).default([]),
  blocked_reasons: z.array(z.string()).default([]),
  quality_scores: z.record(z.string(), z.number()).default({}),
  next_recommended_todos: z.array(z.string()).default([]),
  compressed_context: z.string().default(""),
})
export type CheckpointMemorySummary = z.infer<typeof CheckpointMemorySummary>

export const CriticalReviewVerdict = z.object({
  verdict: z.enum(["pass", "revise", "retry", "ask_user", "stop", "skipped"]),
  unsupported_claims: z.array(z.string()).default([]),
  missing_evidence: z.array(z.string()).default([]),
  contradictions: z.array(z.string()).default([]),
  required_changes: z.array(z.string()).default([]),
  confidence: ConfidenceLevel.default("medium"),
  // MPACR fields. Reviewers and revisers must populate evidence_against
  // alongside evidence_for so feedback is symmetric, not one-sided.
  evidence_for: z.array(z.string()).default([]),
  evidence_against: z.array(z.string()).default([]),
  priors: z.record(z.string(), z.number().min(0).max(1)).default({}),
  posterior: z.number().min(0).max(1).optional(),
  brier_score: z.number().min(0).max(1).optional(),
})
export type CriticalReviewVerdict = z.infer<typeof CriticalReviewVerdict>

export const defaultEffortProfile = {
  planning_rounds: 1,
  expert_count_min: 1,
  expert_count_max: 2,
  verifier_count_min: 1,
  reducer_enabled: false,
  reviewer_enabled: true,
  debugger_enabled: false,
  revise_policy: "critical_only",
  max_revise_nodes: 1,
  max_revision_per_artifact: 1,
  timeout_multiplier: 1,
  mpacr_enabled: false,
  mpacr_critic_count: 3,
  mpacr_per_critic_timeout_ms: 180_000,
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
  long_task: LongTaskProfile.default({
    is_long_task: false,
    task_size: "small",
    timeline_required: false,
    reasons: [],
  }),
  todo_timeline: TodoTimeline.default({
    required: false,
    todos: [],
    phases: [],
  }),
  budget_profile: BudgetProfile.default(() => BudgetProfile.parse({})),
  budget_state: BudgetState.default(() => BudgetState.parse({})),
  progress_snapshot: ProgressSnapshot.default(() => ProgressSnapshot.parse({})),
  checkpoint_memory: CheckpointMemorySummary.default(() => CheckpointMemorySummary.parse({})),
  continuation_request: ContinuationRequest.optional(),
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
