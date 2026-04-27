// MPACR validation — A.3 of the v1.21 plan.
//
// Enforces the core epistemic-symmetry contract for MPACR critic and synthesis
// outputs: every `verdict === "revise"` must carry at least one entry in
// `evidence_against`, and every `verdict === "pass"` must carry at least one
// entry in `evidence_for`. This is the structural defense against models
// degrading to one-sided "looks fine" / "looks bad" rubber-stamps.
//
// The validator does NOT score evidence quality — that's the calibrator's job
// (A.4). It only enforces that the fields are populated. Models that respond
// without evidence get one retry with a sharpened prompt; second failures
// escalate to `verdict: "ask_user"` so a human breaks the tie.

import { CriticalReviewVerdict, type CriticalReviewVerdict as VerdictType } from "./schema"

export const MPACR_RETRY_PROMPT_SUFFIX = [
  ``,
  `Your previous response did not include enough evidence to be actionable.`,
  ``,
  `Required structure — populate ALL of:`,
  `- evidence_for: at least one bullet citing why your verdict holds`,
  `- evidence_against: at least one bullet citing the strongest counter-evidence`,
  `Symmetry is mandatory: even a "pass" verdict must list what could prove you wrong.`,
  `If the artifact genuinely has no counter-evidence, say so explicitly.`,
].join("\n")

export type ValidationStatus =
  | { kind: "ok"; verdict: VerdictType }
  | { kind: "retry"; reason: ValidationReason; sharpenedPrompt: string }
  | { kind: "escalate"; reason: ValidationReason; verdict: VerdictType }

export type ValidationReason =
  | "missing_evidence_against_for_revise"
  | "missing_evidence_for_for_pass"
  | "parse_failure"
  | "verdict_field_missing"

export interface ValidateInput {
  readonly raw: unknown
  // The original prompt sent to the critic/synthesizer. The retry path appends
  // MPACR_RETRY_PROMPT_SUFFIX so the model receives a self-contained instruction.
  readonly originalPrompt: string
  // How many times this same critic has already been retried in this round.
  // Counted against the parent task's `mission_ceiling.max_model_calls` budget
  // by the caller. The validator only enforces the policy; budget bookkeeping
  // happens in the coordinator wiring (A.2 follow-up).
  readonly retryCount: number
}

const MAX_RETRIES = 1

// Returns the structural validation outcome. No I/O, no side effects.
export function validateCritique(input: ValidateInput): ValidationStatus {
  const parsed = CriticalReviewVerdict.safeParse(input.raw)
  if (!parsed.success) {
    if (input.retryCount < MAX_RETRIES) {
      return {
        kind: "retry",
        reason: "parse_failure",
        sharpenedPrompt: input.originalPrompt + MPACR_RETRY_PROMPT_SUFFIX,
      }
    }
    return {
      kind: "escalate",
      reason: "parse_failure",
      verdict: CriticalReviewVerdict.parse({
        verdict: "ask_user",
        required_changes: ["MPACR critic returned malformed output twice; human review needed."],
        confidence: "low",
      }),
    }
  }

  const verdict = parsed.data

  if (verdict.verdict === "revise" && verdict.evidence_against.length === 0) {
    if (input.retryCount < MAX_RETRIES) {
      return {
        kind: "retry",
        reason: "missing_evidence_against_for_revise",
        sharpenedPrompt: input.originalPrompt + MPACR_RETRY_PROMPT_SUFFIX,
      }
    }
    return {
      kind: "escalate",
      reason: "missing_evidence_against_for_revise",
      verdict: CriticalReviewVerdict.parse({
        ...verdict,
        verdict: "ask_user",
        required_changes: [
          ...verdict.required_changes,
          "Critic could not articulate counter-evidence after retry; human review needed.",
        ],
      }),
    }
  }

  if (verdict.verdict === "pass" && verdict.evidence_for.length === 0) {
    if (input.retryCount < MAX_RETRIES) {
      return {
        kind: "retry",
        reason: "missing_evidence_for_for_pass",
        sharpenedPrompt: input.originalPrompt + MPACR_RETRY_PROMPT_SUFFIX,
      }
    }
    // Soft-escalate: keep the pass verdict but flag low confidence so callers
    // know not to trust it blindly. Bumping all the way to ask_user would be
    // too aggressive when the verdict itself was positive.
    return {
      kind: "escalate",
      reason: "missing_evidence_for_for_pass",
      verdict: CriticalReviewVerdict.parse({
        ...verdict,
        confidence: "low",
        evidence_for: ["[validator note] critic gave pass without articulating supporting evidence"],
      }),
    }
  }

  return { kind: "ok", verdict }
}

// Convenience for the partial-failure path (A.5): a critic that timed out or
// errored still emits a structured verdict so synthesis can proceed.
export function skippedVerdict(reason: string): VerdictType {
  return CriticalReviewVerdict.parse({
    verdict: "skipped",
    required_changes: [],
    confidence: "low",
    unsupported_claims: [reason],
  })
}
