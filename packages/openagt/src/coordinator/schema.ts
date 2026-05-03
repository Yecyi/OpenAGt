import { Schema } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import { ZodOverride } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import {
  ConfidenceLevel,
  CoordinatorMode,
  CoordinatorNodeRole,
  CoordinatorOutputSchema,
  CoordinatorParallelMode,
  EffortLevel,
  NodePriority,
  PersonalMemoryAccess,
  ReviseKind,
  RevisePolicy,
  RiskLevel,
  TaskOrigin,
  TaskSize,
  TaskType,
} from "./schema-enums"
import { BudgetProfile, BudgetState, ContinuationRequest, ProgressSnapshot } from "./schema-budget"
import { CheckpointMemorySummary, MemoryContext } from "./schema-memory"
import { QualityGate, RevisePoint } from "./schema-review"
import { TodoTimeline } from "./schema-timeline"
export {
  AutoContinuePolicy,
  BudgetScale,
  ConfidenceLevel,
  CoordinatorMode,
  CoordinatorNodeRole,
  CoordinatorOutputSchema,
  CoordinatorParallelMode,
  EffortLevel,
  NodePriority,
  ReviseKind,
  RevisePolicy,
  RiskLevel,
  TaskOrigin,
  TaskSize,
  TaskType,
} from "./schema-enums"
export {
  BudgetProfile,
  BudgetState,
  ContinuationRequest,
  defaultResourceLimit,
  ProgressSnapshot,
  ResourceLimit,
} from "./schema-budget"
export { CheckpointMemorySummary, MemoryContext } from "./schema-memory"
export { CriticalReviewVerdict, QualityGate, RevisePoint } from "./schema-review"
export {
  CheckpointType,
  EvidenceLedgerItem,
  MilestoneStatus,
  MissionCheckpoint,
  MissionMemorySlice,
  MissionMilestone,
  TimelinePhase,
  TimelineTodo,
  TodoStage,
  TodoStatus,
  TodoTimeline,
} from "./schema-timeline"

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
  execution_model: z.enum(["short-task", "long-task", "epic"]).default("short-task"),
  classification: z.enum(["short", "medium", "long", "epic"]).default("short"),
  confidence: ConfidenceLevel.default("medium"),
  trigger_score: z.number().min(0).max(100).default(0),
  decision_stage: z.enum(["pre-plan", "post-plan", "runtime"]).default("post-plan"),
  positive_signals: z.array(z.string()).default([]),
  negative_signals: z.array(z.string()).default([]),
  needs_user_confirmation: z.boolean().default(false),
  auto_upgrade_allowed: z.boolean().default(true),
  auto_downgrade_allowed: z.boolean().default(true),
  active_milestone_limit: z.number().int().min(1).max(8).default(2),
  milestone_count: z.number().int().min(0).default(0),
  reasons: z.array(z.string()).default([]),
})
export type LongTaskProfile = z.infer<typeof LongTaskProfile>

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
  // C2: knowledge-domain classification. Set by settleIntentProfile via
  // detectDomain (multilingual keyword classifier). Downstream consumers
  // (taskSignatureFor, plan-enrichment) prefer this field when present
  // instead of re-running detection from the raw goal string.
  domain: z.string().default("general"),
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
  prompt_template_id: z.string().optional(),
  workflow: TaskType.optional(),
  artifact_type: z.string().optional(),
  artifact_id: z.string().optional(),
  revision_of: z.string().optional(),
  quality_gate_id: z.string().optional(),
  mpacr_role: z.enum(["steel_man", "critic", "defender", "synthesis", "calibrator"]).optional(),
  mpacr_perspective: z.string().optional(),
  mpacr_quorum: z.number().int().min(1).optional(),
  mpacr_critic_node_ids: z.array(z.string()).optional(),
  mpacr_per_critic_timeout_ms: z.number().int().min(1).optional(),
  mpacr_degraded: z.boolean().optional(),
  memory_namespace: z.string().optional(),
  // Wave 5: how much personal memory this node's session may see.
  // Default "full" — existing nodes are unchanged. Critic / defender /
  // synthesis nodes set "facts_only" for sycophancy mitigation so the
  // adversarial reviewer is blind to user preferences but still grounded
  // in cross-session facts. See PersonalMemoryAccess enum.
  personal_memory_access: PersonalMemoryAccess.default("full"),
  // Wave 7: acceptable-failure spec. The planner attaches this when it
  // detects an impossible-spec pattern (tight time bound + math-style
  // assertion + no escape hatch — the reward-hacking case from the
  // emotion-concepts paper §1.3 case B). Surfaced to the agent's prompt
  // as "If <condition>, this is an expected outcome; use task_give_up
  // with reason=<on_match>." Avoids reward-hacking by giving the agent
  // a legitimate stop affordance for the impossible-spec case.
  acceptable_failure: z
    .object({
      conditions: z.array(z.string()),
      on_match: z.enum(["give_up", "escalate"]).default("give_up"),
    })
    .optional(),
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
    execution_model: "short-task",
    classification: "short",
    confidence: "medium",
    trigger_score: 0,
    decision_stage: "post-plan",
    positive_signals: [],
    negative_signals: [],
    needs_user_confirmation: false,
    auto_upgrade_allowed: true,
    auto_downgrade_allowed: true,
    active_milestone_limit: 2,
    milestone_count: 0,
    reasons: [],
  }),
  todo_timeline: TodoTimeline.default(() => ({
    required: false,
    todos: [],
    phases: [],
    milestones: [],
    active_milestone_limit: 2,
    checkpoints: [],
    evidence_ledger: [],
    memory_slices: [],
    pause_after_current_milestone: false,
  })),
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
