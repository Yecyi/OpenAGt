import z from "zod"
import { AutoContinuePolicy, BudgetScale, ConfidenceLevel } from "./schema-enums"

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

export const zeroResourceLimit = {
  max_rounds: 0,
  max_model_calls: 0,
  max_tool_calls: 0,
  max_subagents: 0,
  max_wallclock_ms: 0,
  max_estimated_tokens: 0,
} as const satisfies ResourceLimit

export const BudgetContinuationState = z.object({
  approved_count: z.number().int().min(0).default(0),
  last_approved_usage: ResourceLimit.default(zeroResourceLimit),
  last_denied_reason: z.string().optional(),
})
export type BudgetContinuationState = z.infer<typeof BudgetContinuationState>

export const BudgetLimitReason = z.enum(["none", "mission", "absolute", "phase", "todo", "checkpoint_reserve"])
export type BudgetLimitReason = z.infer<typeof BudgetLimitReason>

export const ResourceLimitKey = z.enum([
  "max_rounds",
  "max_model_calls",
  "max_tool_calls",
  "max_subagents",
  "max_wallclock_ms",
  "max_estimated_tokens",
])
export type ResourceLimitKey = z.infer<typeof ResourceLimitKey>

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
  continuation_state: BudgetContinuationState.default(() => BudgetContinuationState.parse({})),
})
export type BudgetProfile = z.infer<typeof BudgetProfile>

export const BudgetState = z.object({
  soft_budget_used: z.number().min(0).max(1).default(0),
  absolute_ceiling_used: z.number().min(0).max(1).default(0),
  checkpoint_count: z.number().int().min(0).default(0),
  budget_limited: z.boolean().default(false),
  ceiling_hit: z.boolean().default(false),
  limit_reason: BudgetLimitReason.default("none"),
  limited_resource: ResourceLimitKey.optional(),
  limited_todo_id: z.string().optional(),
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
