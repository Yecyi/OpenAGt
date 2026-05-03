import { test, expect } from "bun:test"
import {
  planValidationErrorMessage,
  repairMissingDeps,
  validatePlan,
  validatePlanResult,
} from "../../src/coordinator/plan-ordering"
import { CoordinatorPlan } from "../../src/coordinator/schema"

function planWith(nodes: Array<{ id: string; depends_on?: string[] }>) {
  return CoordinatorPlan.parse({
    goal: "test",
    nodes: nodes.map((n) => ({
      id: n.id,
      description: "",
      prompt: "",
      task_kind: "implement",
      subagent_type: "worker",
      depends_on: n.depends_on ?? [],
      write_scope: [],
      read_scope: [],
      acceptance_checks: [],
      priority: "normal",
      origin: "coordinator",
    })),
  })
}

test("validatePlanResult — ok for an acyclic plan", () => {
  const plan = planWith([
    { id: "a" },
    { id: "b", depends_on: ["a"] },
    { id: "c", depends_on: ["a", "b"] },
  ])
  expect(validatePlanResult(plan)).toEqual({ ok: true })
})

test("validatePlanResult — surfaces duplicate node id", () => {
  const plan = planWith([{ id: "a" }, { id: "a" }])
  const result = validatePlanResult(plan)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.kind).toBe("duplicate")
    if (result.kind === "duplicate") expect(result.node_id).toBe("a")
  }
})

test("validatePlanResult — surfaces missing dep with offending node id", () => {
  const plan = planWith([{ id: "a", depends_on: ["nonexistent"] }])
  const result = validatePlanResult(plan)
  expect(result.ok).toBe(false)
  if (!result.ok && result.kind === "missing_dep") {
    expect(result.node_id).toBe("a")
    expect(result.missing).toBe("nonexistent")
  }
})

test("validatePlanResult — surfaces cycle path", () => {
  const plan = planWith([
    { id: "a", depends_on: ["b"] },
    { id: "b", depends_on: ["c"] },
    { id: "c", depends_on: ["a"] },
  ])
  const result = validatePlanResult(plan)
  expect(result.ok).toBe(false)
  if (!result.ok && result.kind === "cycle") {
    // The cycle path must contain all three nodes and end where it started.
    expect(result.cycle_path.length).toBeGreaterThanOrEqual(3)
    expect(result.cycle_path[0]).toBe(result.cycle_path[result.cycle_path.length - 1])
    expect(new Set(result.cycle_path)).toEqual(new Set(["a", "b", "c"]))
  }
})

test("planValidationErrorMessage — produces human-readable strings", () => {
  expect(planValidationErrorMessage({ ok: false, kind: "duplicate", node_id: "x" })).toContain("duplicate node id: x")
  expect(
    planValidationErrorMessage({ ok: false, kind: "missing_dep", node_id: "x", missing: "y" }),
  ).toContain("x depends on unknown node y")
  expect(planValidationErrorMessage({ ok: false, kind: "cycle", cycle_path: ["a", "b", "a"] })).toContain(
    "a -> b -> a",
  )
})

test("repairMissingDeps — drops bogus dep refs and reports them", () => {
  const plan = planWith([
    { id: "a" },
    { id: "b", depends_on: ["a", "ghost"] },
    { id: "c", depends_on: ["phantom"] },
  ])
  const { plan: repaired, dropped } = repairMissingDeps(plan)
  expect(dropped).toEqual([
    { node_id: "b", missing: "ghost" },
    { node_id: "c", missing: "phantom" },
  ])
  expect(repaired.nodes.find((n) => n.id === "b")?.depends_on).toEqual(["a"])
  expect(repaired.nodes.find((n) => n.id === "c")?.depends_on).toEqual([])
  // Repaired plan now passes validation.
  expect(validatePlanResult(repaired)).toEqual({ ok: true })
})

test("repairMissingDeps — does NOT touch cycles or duplicates (only safe cases)", () => {
  const cyclic = planWith([
    { id: "a", depends_on: ["b"] },
    { id: "b", depends_on: ["a"] },
  ])
  const { plan: repaired, dropped } = repairMissingDeps(cyclic)
  expect(dropped).toEqual([])
  // Same plan is returned (cycle is preserved for the validator to flag).
  expect(repaired).toBe(cyclic)
  const validation = validatePlanResult(repaired)
  expect(validation.ok).toBe(false)
  if (!validation.ok) expect(validation.kind).toBe("cycle")
})

test("repairMissingDeps — returns identical reference when no repair needed", () => {
  const plan = planWith([{ id: "a" }, { id: "b", depends_on: ["a"] }])
  const result = repairMissingDeps(plan)
  expect(result.dropped).toEqual([])
  expect(result.plan).toBe(plan)
})

test("validatePlan (legacy throwing variant) still throws on cycle for downstream callers", () => {
  const plan = planWith([
    { id: "a", depends_on: ["b"] },
    { id: "b", depends_on: ["a"] },
  ])
  expect(() => validatePlan(plan)).toThrow(/cycle/i)
})
