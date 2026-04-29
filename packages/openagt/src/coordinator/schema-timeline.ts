import z from "zod"
import { NodePriority } from "./schema-enums"

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
