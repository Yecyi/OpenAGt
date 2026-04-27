import { describe, expect, test } from "bun:test"
import {
  CalibrationRecord,
  computeBrier,
  gradeBrier,
  MIN_CALIBRATION_SAMPLES,
  recommendPriorShift,
} from "../../src/coordinator/calibration"

describe("computeBrier", () => {
  test("perfect prediction has Brier = 0", () => {
    expect(computeBrier(1.0, 1.0)).toBe(0)
    expect(computeBrier(0.0, 0.0)).toBe(0)
  })

  test("worst prediction has Brier = 1", () => {
    expect(computeBrier(1.0, 0.0)).toBe(1)
    expect(computeBrier(0.0, 1.0)).toBe(1)
  })

  test("uncertain prediction (0.5) has Brier = 0.25 against any binary outcome", () => {
    expect(computeBrier(0.5, 0)).toBeCloseTo(0.25, 6)
    expect(computeBrier(0.5, 1)).toBeCloseTo(0.25, 6)
  })

  test("inputs outside [0,1] are clamped", () => {
    expect(computeBrier(1.5, 1)).toBe(0)
    expect(computeBrier(-0.2, 0)).toBe(0)
    expect(computeBrier(2, 0)).toBe(1)
  })

  test("non-finite inputs degrade gracefully (treated as 0.5)", () => {
    // NaN posterior + outcome=1 → brier = (0.5 - 1)^2 = 0.25
    expect(computeBrier(NaN, 1)).toBeCloseTo(0.25, 6)
    // Both treated as 0.5 → brier = 0
    expect(computeBrier(0.5, Infinity)).toBeCloseTo(0, 6)
    expect(computeBrier(NaN, NaN)).toBeCloseTo(0, 6)
  })
})

describe("gradeBrier", () => {
  test("returns 'insufficient-data' under MIN_CALIBRATION_SAMPLES regardless of score", () => {
    expect(gradeBrier(0.05, MIN_CALIBRATION_SAMPLES - 1)).toBe("insufficient-data")
  })

  test("classifies bands by Brier score once sample size is sufficient", () => {
    expect(gradeBrier(0.05, MIN_CALIBRATION_SAMPLES)).toBe("well-calibrated")
    expect(gradeBrier(0.10, MIN_CALIBRATION_SAMPLES)).toBe("well-calibrated")
    expect(gradeBrier(0.15, MIN_CALIBRATION_SAMPLES)).toBe("acceptable")
    expect(gradeBrier(0.25, MIN_CALIBRATION_SAMPLES)).toBe("acceptable")
    expect(gradeBrier(0.40, MIN_CALIBRATION_SAMPLES)).toBe("poor")
  })
})

describe("recommendPriorShift", () => {
  test("returns undefined under MIN_CALIBRATION_SAMPLES", () => {
    const samples = Array.from({ length: MIN_CALIBRATION_SAMPLES - 1 }, () => ({ prior: 0.5, outcome: 0.7 }))
    expect(recommendPriorShift(samples)).toBeUndefined()
  })

  test("returns positive shift when outcomes consistently exceed priors", () => {
    // Reviewer was systematically pessimistic: said 0.5, outcomes were 0.7.
    // Expected shift: +0.2, clamped to +0.1.
    const samples = Array.from({ length: MIN_CALIBRATION_SAMPLES }, () => ({ prior: 0.5, outcome: 0.7 }))
    const result = recommendPriorShift(samples)
    expect(result).toBeDefined()
    expect(result!.shift).toBe(0.1) // clamped
    expect(result!.sample_size).toBe(MIN_CALIBRATION_SAMPLES)
  })

  test("returns negative shift when outcomes consistently fall short of priors", () => {
    // Reviewer was systematically optimistic: said 0.8, outcomes were 0.5.
    // Expected shift: -0.3, clamped to -0.1.
    const samples = Array.from({ length: MIN_CALIBRATION_SAMPLES }, () => ({ prior: 0.8, outcome: 0.5 }))
    const result = recommendPriorShift(samples)
    expect(result).toBeDefined()
    expect(result!.shift).toBe(-0.1)
  })

  test("returns ~0 shift when reviewer is well-calibrated", () => {
    const samples = Array.from({ length: MIN_CALIBRATION_SAMPLES }, (_, i) => ({
      prior: 0.6,
      outcome: i % 2 === 0 ? 0.61 : 0.59,
    }))
    const result = recommendPriorShift(samples)
    expect(result).toBeDefined()
    expect(Math.abs(result!.shift)).toBeLessThan(0.01)
  })

  test("does not exceed [-0.1, +0.1] even on extreme miscalibration", () => {
    const samples = Array.from({ length: MIN_CALIBRATION_SAMPLES }, () => ({ prior: 0.0, outcome: 1.0 }))
    const result = recommendPriorShift(samples)
    expect(result!.shift).toBe(0.1) // hard clamp
  })
})

describe("CalibrationRecord schema", () => {
  test("round-trips a well-formed record", () => {
    const rec = CalibrationRecord.parse({
      id: "cal_abc",
      expert_id: "coding.synth-reviser",
      workflow: "coding",
      prior: 0.5,
      posterior: 0.8,
      outcome: 0.9,
      brier: computeBrier(0.8, 0.9),
      time_recorded: Date.now(),
    })
    expect(rec.expert_id).toBe("coding.synth-reviser")
    expect(rec.brier).toBeLessThan(0.05)
  })

  test("rejects probabilities outside [0,1]", () => {
    expect(() =>
      CalibrationRecord.parse({
        id: "cal_x",
        expert_id: "x",
        workflow: "y",
        prior: 1.2,
        posterior: 0.5,
        outcome: 0.5,
        brier: 0,
        time_recorded: 0,
      }),
    ).toThrow()
    expect(() =>
      CalibrationRecord.parse({
        id: "cal_x",
        expert_id: "x",
        workflow: "y",
        prior: 0.5,
        posterior: -0.1,
        outcome: 0.5,
        brier: 0,
        time_recorded: 0,
      }),
    ).toThrow()
  })
})
