import z from "zod"
import { TimelineTodo } from "./schema-timeline"

export const CheckpointMemorySummary = z.object({
  run_id: z.string().optional(),
  checkpoint_id: z.string().optional(),
  checkpoint_type: z
    .enum([
      "node_checkpoint",
      "milestone_checkpoint",
      "budget_checkpoint",
      "risk_checkpoint",
      "recovery_checkpoint",
      "cancellation_checkpoint",
    ])
    .optional(),
  current_milestone_id: z.string().optional(),
  todo_state: z.array(TimelineTodo).default([]),
  completed_artifacts: z.array(z.string()).default([]),
  evidence_index: z.array(z.string()).default([]),
  unresolved_claims: z.array(z.string()).default([]),
  blocked_reasons: z.array(z.string()).default([]),
  quality_scores: z.record(z.string(), z.number()).default({}),
  next_recommended_todos: z.array(z.string()).default([]),
  milestone_summaries: z.array(z.string()).default([]),
  compressed_context: z.string().default(""),
})
export type CheckpointMemorySummary = z.infer<typeof CheckpointMemorySummary>

export const MemoryContext = z.object({
  scopes: z
    .array(z.enum(["profile", "workspace", "session", "semantic", "procedural"]))
    .default(["profile", "workspace"]),
  workflow_tags: z.array(z.string()).default([]),
  expert_tags: z.array(z.string()).default([]),
  note_ids: z.array(z.string()).default([]),
})
export type MemoryContext = z.infer<typeof MemoryContext>
