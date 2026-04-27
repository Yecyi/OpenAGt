import { describe, expect, test } from "bun:test"
import {
  MPACR_RETRY_PROMPT_SUFFIX,
  skippedVerdict,
  validateCritique,
} from "../../src/coordinator/mpacr-validation"

const ORIGINAL_PROMPT = "Critique this artifact from the factuality perspective."

describe("validateCritique — happy paths", () => {
  test("verdict=pass with evidence_for is accepted as ok", () => {
    const result = validateCritique({
      raw: {
        verdict: "pass",
        evidence_for: ["All cited regulations match published code"],
      },
      originalPrompt: ORIGINAL_PROMPT,
      retryCount: 0,
    })
    expect(result.kind).toBe("ok")
  })

  test("verdict=revise with evidence_against is accepted as ok", () => {
    const result = validateCritique({
      raw: {
        verdict: "revise",
        required_changes: ["Add bounds check"],
        evidence_against: ["Existing tests cover the empty case correctly"],
      },
      originalPrompt: ORIGINAL_PROMPT,
      retryCount: 0,
    })
    expect(result.kind).toBe("ok")
  })

  test("verdict=skipped (partial-failure path) bypasses evidence requirements", () => {
    const result = validateCritique({
      raw: { verdict: "skipped" },
      originalPrompt: ORIGINAL_PROMPT,
      retryCount: 0,
    })
    expect(result.kind).toBe("ok")
  })

  test("verdict=stop bypasses evidence requirements (catastrophic-stop path)", () => {
    const result = validateCritique({
      raw: { verdict: "stop", required_changes: ["Mission unsafe to continue"] },
      originalPrompt: ORIGINAL_PROMPT,
      retryCount: 0,
    })
    expect(result.kind).toBe("ok")
  })
})

describe("validateCritique — first-attempt retry on missing evidence", () => {
  test("verdict=revise without evidence_against triggers retry with sharpened prompt", () => {
    const result = validateCritique({
      raw: { verdict: "revise", required_changes: ["Tighten error handling"] },
      originalPrompt: ORIGINAL_PROMPT,
      retryCount: 0,
    })
    expect(result.kind).toBe("retry")
    if (result.kind === "retry") {
      expect(result.reason).toBe("missing_evidence_against_for_revise")
      expect(result.sharpenedPrompt).toContain(ORIGINAL_PROMPT)
      expect(result.sharpenedPrompt).toContain(MPACR_RETRY_PROMPT_SUFFIX)
    }
  })

  test("verdict=pass without evidence_for triggers retry on first attempt", () => {
    const result = validateCritique({
      raw: { verdict: "pass" },
      originalPrompt: ORIGINAL_PROMPT,
      retryCount: 0,
    })
    expect(result.kind).toBe("retry")
    if (result.kind === "retry") {
      expect(result.reason).toBe("missing_evidence_for_for_pass")
    }
  })

  test("malformed output triggers retry on first attempt", () => {
    const result = validateCritique({
      raw: { not_a_verdict: true },
      originalPrompt: ORIGINAL_PROMPT,
      retryCount: 0,
    })
    expect(result.kind).toBe("retry")
    if (result.kind === "retry") {
      expect(result.reason).toBe("parse_failure")
    }
  })
})

describe("validateCritique — second-attempt escalation", () => {
  test("verdict=revise with no evidence_against on retry escalates to ask_user", () => {
    const result = validateCritique({
      raw: { verdict: "revise", required_changes: ["..."] },
      originalPrompt: ORIGINAL_PROMPT,
      retryCount: 1,
    })
    expect(result.kind).toBe("escalate")
    if (result.kind === "escalate") {
      expect(result.reason).toBe("missing_evidence_against_for_revise")
      expect(result.verdict.verdict).toBe("ask_user")
      expect(result.verdict.required_changes.some((c) => c.includes("human review"))).toBe(true)
    }
  })

  test("verdict=pass with no evidence_for on retry soft-escalates with low confidence (not ask_user)", () => {
    const result = validateCritique({
      raw: { verdict: "pass" },
      originalPrompt: ORIGINAL_PROMPT,
      retryCount: 1,
    })
    expect(result.kind).toBe("escalate")
    if (result.kind === "escalate") {
      expect(result.reason).toBe("missing_evidence_for_for_pass")
      // Soft-escalation: keep the pass verdict but flag low confidence.
      expect(result.verdict.verdict).toBe("pass")
      expect(result.verdict.confidence).toBe("low")
      expect(result.verdict.evidence_for.length).toBeGreaterThan(0)
    }
  })

  test("malformed output on retry escalates to ask_user", () => {
    const result = validateCritique({
      raw: "not even an object",
      originalPrompt: ORIGINAL_PROMPT,
      retryCount: 1,
    })
    expect(result.kind).toBe("escalate")
    if (result.kind === "escalate") {
      expect(result.reason).toBe("parse_failure")
      expect(result.verdict.verdict).toBe("ask_user")
    }
  })
})

describe("skippedVerdict", () => {
  test("produces a parseable verdict carrying the skip reason as an unsupported_claim", () => {
    const verdict = skippedVerdict("critic timed out at 180s")
    expect(verdict.verdict).toBe("skipped")
    expect(verdict.confidence).toBe("low")
    expect(verdict.unsupported_claims).toContain("critic timed out at 180s")
  })
})
