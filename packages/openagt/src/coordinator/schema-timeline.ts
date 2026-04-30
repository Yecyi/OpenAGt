import z from "zod"
import { ConfidenceLevel, NodePriority, RiskLevel } from "./schema-enums"

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
  milestone_id: z.string().optional(),
})
export type TimelinePhase = z.infer<typeof TimelinePhase>

export const MilestoneStatus = z.enum(["pending", "active", "completed", "partial", "blocked", "skipped"])
export type MilestoneStatus = z.infer<typeof MilestoneStatus>

export const MissionMilestone = z.object({
  id: z.string(),
  title: z.string(),
  status: MilestoneStatus.default("pending"),
  risk: RiskLevel.default("medium"),
  todo_ids: z.array(z.string()).default([]),
  acceptance_checks: z.array(z.string()).default([]),
  expected_artifact: z.string().default(""),
  budget_slice: z.number().min(0).max(1).default(0),
  checkpoint_after: z.boolean().default(true),
})
export type MissionMilestone = z.infer<typeof MissionMilestone>

export const CheckpointType = z.enum([
  "node_checkpoint",
  "milestone_checkpoint",
  "budget_checkpoint",
  "risk_checkpoint",
  "recovery_checkpoint",
  "cancellation_checkpoint",
])
export type CheckpointType = z.infer<typeof CheckpointType>

export const MissionCheckpoint = z.object({
  id: z.string(),
  type: CheckpointType,
  milestone_id: z.string().optional(),
  node_id: z.string().optional(),
  task_id: z.string().optional(),
  status: z.string().default("recorded"),
  summary: z.string().default(""),
  next_recommended_action: z.string().default(""),
  created_at: z.number(),
})
export type MissionCheckpoint = z.infer<typeof MissionCheckpoint>

export const EvidenceLedgerItem = z.object({
  id: z.string(),
  source_type: z.enum(["task", "checkpoint", "artifact", "memory"]).default("task"),
  source_id: z.string(),
  milestone_id: z.string().optional(),
  node_id: z.string().optional(),
  summary: z.string(),
  confidence: ConfidenceLevel.default("medium"),
  scope: z.array(z.string()).default([]),
  created_at: z.number(),
})
export type EvidenceLedgerItem = z.infer<typeof EvidenceLedgerItem>

export const MissionMemorySlice = z.object({
  id: z.string(),
  milestone_id: z.string().optional(),
  completed: z.array(z.string()).default([]),
  important_context: z.array(z.string()).default([]),
  unresolved_risks: z.array(z.string()).default([]),
  next_context: z.string().default(""),
  discard_context: z.array(z.string()).default([]),
  created_at: z.number(),
})
export type MissionMemorySlice = z.infer<typeof MissionMemorySlice>

export const TodoTimeline = z.object({
  required: z.boolean().default(false),
  todos: z.array(TimelineTodo).default([]),
  phases: z.array(TimelinePhase).default([]),
  milestones: z.array(MissionMilestone).default([]),
  current_milestone_id: z.string().optional(),
  active_milestone_limit: z.number().int().min(1).max(8).default(2),
  checkpoints: z.array(MissionCheckpoint).default([]),
  evidence_ledger: z.array(EvidenceLedgerItem).default([]),
  memory_slices: z.array(MissionMemorySlice).default([]),
  pause_after_current_milestone: z.boolean().default(false),
})
export type TodoTimeline = z.infer<typeof TodoTimeline>
