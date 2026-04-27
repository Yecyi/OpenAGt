import { describe, expect, test } from "bun:test"
import {
  EXPLORATION_FRACTION,
  pickVariantFromMap,
  pickWithHistory,
  sampleBeta,
  type OutcomeStats,
  type PromptTemplate,
} from "../../src/coordinator/prompt-templates"

function template(variant: string, weight = 1): PromptTemplate {
  return { role: "reviser", variant, weight, content: `body-${variant}`, metadata: {} }
}

// Deterministic PRNG for reproducible Thompson sampling tests.
// Uses the same seeded LCG as the picker but exposed here so tests don't
// depend on Math.random.
function seededRand(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

describe("sampleBeta — distribution sanity", () => {
  test("produces samples in (0, 1)", () => {
    const rand = seededRand(42)
    for (let i = 0; i < 100; i++) {
      const x = sampleBeta(5, 5, rand)
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(1)
    }
  })

  test("Beta(s, f) with high s pushes mean toward 1", () => {
    const rand = seededRand(7)
    let sum = 0
    const N = 200
    for (let i = 0; i < N; i++) sum += sampleBeta(50, 5, rand)
    expect(sum / N).toBeGreaterThan(0.7)
  })

  test("Beta(s, f) with high f pushes mean toward 0", () => {
    const rand = seededRand(11)
    let sum = 0
    const N = 200
    for (let i = 0; i < N; i++) sum += sampleBeta(5, 50, rand)
    expect(sum / N).toBeLessThan(0.3)
  })

  test("Beta(0, 0) — completely cold variant — averages near 0.5", () => {
    const rand = seededRand(99)
    let sum = 0
    const N = 500
    for (let i = 0; i < N; i++) sum += sampleBeta(0, 0, rand)
    expect(sum / N).toBeGreaterThan(0.35)
    expect(sum / N).toBeLessThan(0.65)
  })

  test("negative inputs are clamped to zero", () => {
    const rand = seededRand(123)
    const x = sampleBeta(-5, -5, rand)
    // Treated as Beta(1, 1) → uniform → in (0, 1).
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThan(1)
  })
})

describe("pickWithHistory — Thompson sampling behaviour", () => {
  test("with one variant, always returns that variant", () => {
    const rand = seededRand(1)
    const variants = [template("only")]
    expect(pickWithHistory(variants, new Map(), rand)?.variant).toBe("only")
  })

  test("returns undefined for empty variant list", () => {
    const rand = seededRand(1)
    expect(pickWithHistory([], new Map(), rand)).toBeUndefined()
  })

  test("converges on the highest-success variant after enough samples", () => {
    // Variant 'good' has 80 successes / 20 failures; 'bad' has 20 / 80.
    // Across many picks, 'good' should dominate.
    const variants = [template("good"), template("bad")]
    const history = new Map<string, OutcomeStats>([
      ["good", { success: 80, failure: 20 }],
      ["bad", { success: 20, failure: 80 }],
    ])
    const rand = seededRand(2024)
    let goodCount = 0
    const N = 1000
    for (let i = 0; i < N; i++) {
      const pick = pickWithHistory(variants, history, rand)
      if (pick?.variant === "good") goodCount++
    }
    // 'good' should win clearly more than half the time. Allow exploration
    // overhead (~5%) and Beta-sample variance.
    expect(goodCount / N).toBeGreaterThan(0.7)
  })

  test("cold variant (no history) still gets traffic via exploration AND Beta(1,1)", () => {
    // 'cold' has zero history, 'hot' has 50 successes. With Beta(1,1) for cold
    // and Beta(51,1) for hot, cold should still win occasionally because
    // exploration kicks in EXPLORATION_FRACTION of the time.
    const variants = [template("hot"), template("cold")]
    const history = new Map<string, OutcomeStats>([["hot", { success: 50, failure: 0 }]])
    const rand = seededRand(7)
    let coldCount = 0
    const N = 2000
    for (let i = 0; i < N; i++) {
      if (pickWithHistory(variants, history, rand)?.variant === "cold") coldCount++
    }
    // Without exploration, cold would basically never win against (51, 1).
    // With EXPLORATION_FRACTION = 0.05 of uniform picks, cold gets ~2.5% baseline.
    expect(coldCount / N).toBeGreaterThan(0.01)
  })

  test("two equivalent variants split traffic roughly 50/50", () => {
    const variants = [template("a"), template("b")]
    const history = new Map<string, OutcomeStats>([
      ["a", { success: 25, failure: 25 }],
      ["b", { success: 25, failure: 25 }],
    ])
    const rand = seededRand(13)
    let aCount = 0
    const N = 1000
    for (let i = 0; i < N; i++) {
      if (pickWithHistory(variants, history, rand)?.variant === "a") aCount++
    }
    expect(aCount / N).toBeGreaterThan(0.4)
    expect(aCount / N).toBeLessThan(0.6)
  })
})

describe("pickVariantFromMap history integration", () => {
  test("uses outcome history instead of static weights when supplied", () => {
    const picked = pickVariantFromMap(
      new Map([["reviser", [template("good", 1), template("bad", 1000)]]]),
      { role: "reviser", seed: "history-prefers-good" },
      new Map<string, OutcomeStats>([
        ["good", { success: 200, failure: 0 }],
        ["bad", { success: 0, failure: 200 }],
      ]),
    )
    expect(picked?.variant).toBe("good")
  })
})

describe("EXPLORATION_FRACTION", () => {
  test("is set to a value that prevents starvation but doesn't dominate", () => {
    // Sanity: should be a small positive fraction.
    expect(EXPLORATION_FRACTION).toBeGreaterThan(0)
    expect(EXPLORATION_FRACTION).toBeLessThan(0.2)
  })
})
