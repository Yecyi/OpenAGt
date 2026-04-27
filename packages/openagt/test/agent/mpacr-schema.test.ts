import { describe, expect, test } from "bun:test"
import { CriticalReviewVerdict, EffortProfile, ReviseKind } from "../../src/coordinator/schema"

describe("CriticalReviewVerdict — MPACR fields", () => {
  test("legacy verdict shape still parses (no MPACR fields)", () => {
    const parsed = CriticalReviewVerdict.parse({
      verdict: "revise",
      required_changes: ["Tighten error handling"],
    })
    expect(parsed.evidence_for).toEqual([])
    expect(parsed.evidence_against).toEqual([])
    expect(parsed.priors).toEqual({})
    expect(parsed.posterior).toBeUndefined()
    expect(parsed.brier_score).toBeUndefined()
  })

  test("evidence_for and evidence_against round-trip", () => {
    const parsed = CriticalReviewVerdict.parse({
      verdict: "revise",
      required_changes: ["Add bounds check"],
      evidence_for: ["Fuzz test failed at length=0"],
      evidence_against: ["Existing tests do not exercise the empty case"],
    })
    expect(parsed.evidence_for).toEqual(["Fuzz test failed at length=0"])
    expect(parsed.evidence_against).toEqual(["Existing tests do not exercise the empty case"])
  })

  test("posterior must be in [0,1]", () => {
    expect(() =>
      CriticalReviewVerdict.parse({ verdict: "pass", posterior: 1.5 }),
    ).toThrow()
    expect(() =>
      CriticalReviewVerdict.parse({ verdict: "pass", posterior: -0.1 }),
    ).toThrow()
    const ok = CriticalReviewVerdict.parse({ verdict: "pass", posterior: 0.7 })
    expect(ok.posterior).toBe(0.7)
  })

  test("brier_score must be in [0,1]", () => {
    const ok = CriticalReviewVerdict.parse({ verdict: "pass", brier_score: 0.04 })
    expect(ok.brier_score).toBe(0.04)
    expect(() =>
      CriticalReviewVerdict.parse({ verdict: "pass", brier_score: 1.5 }),
    ).toThrow()
  })

  test("priors map values are clamped to [0,1] by validation", () => {
    const ok = CriticalReviewVerdict.parse({
      verdict: "revise",
      priors: { factuality: 0.6, risk: 0.3 },
    })
    expect(ok.priors).toEqual({ factuality: 0.6, risk: 0.3 })

    expect(() =>
      CriticalReviewVerdict.parse({ verdict: "revise", priors: { x: 1.2 } }),
    ).toThrow()
  })

  test("verdict accepts the new 'skipped' state for partial-failure handling", () => {
    const parsed = CriticalReviewVerdict.parse({ verdict: "skipped" })
    expect(parsed.verdict).toBe("skipped")
  })
})

describe("ReviseKind — MPACR stages", () => {
  test("MPACR stage values are accepted", () => {
    expect(ReviseKind.parse("steel_man")).toBe("steel_man")
    expect(ReviseKind.parse("red_team")).toBe("red_team")
    expect(ReviseKind.parse("defense")).toBe("defense")
    expect(ReviseKind.parse("synthesis")).toBe("synthesis")
    expect(ReviseKind.parse("calibration")).toBe("calibration")
  })

  test("legacy values still accepted", () => {
    expect(ReviseKind.parse("plan_revise")).toBe("plan_revise")
    expect(ReviseKind.parse("final_revise")).toBe("final_revise")
  })
})

describe("EffortProfile — MPACR controls", () => {
  test("missing MPACR fields default to disabled with K=3 and 180s per critic", () => {
    const p = EffortProfile.parse({
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
    })
    expect(p.mpacr_enabled).toBe(false)
    expect(p.mpacr_critic_count).toBe(3)
    expect(p.mpacr_per_critic_timeout_ms).toBe(180_000)
  })

  test("mpacr_critic_count is bounded to [2, 6]", () => {
    const base = {
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
    }
    expect(() => EffortProfile.parse({ ...base, mpacr_critic_count: 1 })).toThrow()
    expect(() => EffortProfile.parse({ ...base, mpacr_critic_count: 7 })).toThrow()
  })

  test("mpacr_per_critic_timeout_ms is bounded to [30_000, 900_000]", () => {
    const base = {
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
    }
    expect(() => EffortProfile.parse({ ...base, mpacr_per_critic_timeout_ms: 1_000 })).toThrow()
    expect(() => EffortProfile.parse({ ...base, mpacr_per_critic_timeout_ms: 60 * 60 * 1000 })).toThrow()
  })
})
