import z from "zod"
import { ConfidenceLevel, ReviseKind } from "./schema-enums"

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

export const QualityGate = z.object({
  id: z.string(),
  kind: ReviseKind,
  node_id: z.string().optional(),
  artifact_id: z.string().optional(),
  status: z.enum(["pending", "running", "pending_quorum", "passed", "failed", "skipped"]).default("pending"),
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
  status: z.enum(["pending", "running", "pending_quorum", "passed", "failed", "skipped"]).default("pending"),
})
export type RevisePoint = z.infer<typeof RevisePoint>
