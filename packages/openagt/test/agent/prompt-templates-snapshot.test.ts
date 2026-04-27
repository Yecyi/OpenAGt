import { describe, expect, test } from "bun:test"
import {
  buildRegistry,
  pickVariantFromMap,
  readPromptDir,
  renderTemplate,
} from "../../src/coordinator/prompt-templates"
import path from "path"

// Snapshot tests for C.3 prompt extraction.
//
// Asserts that each extracted template, when rendered with the same variables
// the coordinator's inline `*Node()` factories pass, produces the exact byte
// sequence the inline path would have produced. This is what guards C.4's
// future swap from inline strings → template loader: any drift trips this
// test before the swap can land.

const PROMPTS_DIR = path.join(import.meta.dirname, "../../src/coordinator/prompts")

function loadAll() {
  return buildRegistry(readPromptDir(PROMPTS_DIR))
}

function pick(role: string, variant: string) {
  const registry = loadAll()
  const template = pickVariantFromMap(registry, { role, forceVariant: variant })
  if (!template) throw new Error(`template not found: ${role}/${variant}`)
  return template
}

describe("Prompt-templates filesystem load", () => {
  test("loads all 5 known roles from coordinator/prompts/", () => {
    const registry = loadAll()
    expect(registry.has("reviser")).toBe(true)
    expect(registry.has("reviewer")).toBe(true)
    expect(registry.has("planner")).toBe(true)
    expect(registry.has("verifier")).toBe(true)
    expect(registry.has("reducer")).toBe(true)
  })

  test("reviser has both default and no-target variants", () => {
    const list = loadAll().get("reviser")!
    const variants = list.map((t) => t.variant).sort()
    expect(variants).toEqual(["default", "no-target"])
  })

  test("reducer has both default (research-synthesis) and project-deep-dive variants", () => {
    const list = loadAll().get("reducer")!
    const variants = list.map((t) => t.variant).sort()
    expect(variants).toEqual(["default", "project-deep-dive"])
  })
})

describe("Reviser default variant — byte-equal to coordinator.ts:787-799 reviseNode prompt", () => {
  test("renders to the exact string reviseNode produces when target is set", () => {
    const template = pick("reviser", "default")
    const rendered = renderTemplate(template.content, {
      goal: "implement mission control backend",
      workflow: "coding",
      effort: "high",
      target_id: "implement",
      kind: "output_revise",
    })
    // This must match the inline string assembly in coordinator.ts:787-799.
    const expected = [
      `Revise the target artifact quality without exposing chain-of-thought.`,
      ``,
      `Goal: implement mission control backend`,
      `Workflow: coding`,
      `Effort: high`,
      `Target node: implement`,
      `Revise kind: output_revise`,
      ``,
      `Return JSON-like fields: pass, issues, missing_context, required_changes, confidence, action.`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Reviser no-target variant — byte-equal to reviseNode without target", () => {
  test("renders to reviseNode's filtered output when target is absent", () => {
    const template = pick("reviser", "no-target")
    const rendered = renderTemplate(template.content, {
      goal: "g",
      workflow: "coding",
      effort: "high",
      kind: "plan_revise",
    })
    const expected = [
      `Revise the target artifact quality without exposing chain-of-thought.`,
      ``,
      `Goal: g`,
      `Workflow: coding`,
      `Effort: high`,
      `Revise kind: plan_revise`,
      ``,
      `Return JSON-like fields: pass, issues, missing_context, required_changes, confidence, action.`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Reviewer checkpoint variant — byte-equal to coordinator.ts:832-839 checkpointNode prompt", () => {
  test("renders to the exact checkpointNode prompt", () => {
    const template = pick("reviewer", "checkpoint")
    const rendered = renderTemplate(template.content, {
      goal: "G",
      workflow: "review",
      effort: "high",
    })
    const expected = [
      `Summarize mission progress for a budget checkpoint without continuing exploration.`,
      ``,
      `Goal: G`,
      `Workflow: review`,
      `Effort: high`,
      ``,
      `Return completed, partial, not_started, blocked, evidence_summary, unresolved_claims, quality_summary, and suggested_continuation when more work is valuable.`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Planner default variant — byte-equal to coordinator.ts:744-751 plannerNode prompt", () => {
  test("renders to the exact plannerNode prompt", () => {
    const template = pick("planner", "default")
    const rendered = renderTemplate(template.content, {
      goal: "g",
      workflow: "coding",
      effort: "deep",
    })
    const expected = [
      `Create or refine the execution plan for this mission.`,
      ``,
      `Goal: g`,
      `Workflow: coding`,
      `Effort: deep`,
      ``,
      `Return summary, assumptions, missing context, risks, confidence, and next step.`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Verifier shard variant — byte-equal to coordinator.ts:649-656 verifierShard prompt", () => {
  test("renders to the exact verifierShard prompt", () => {
    const template = pick("verifier", "shard")
    const rendered = renderTemplate(template.content, {
      goal: "g",
      checks_block: ["- typecheck passes", "- focused tests pass"].join("\n"),
    })
    const expected = [
      `Verify exactly one quality dimension for this mission.`,
      ``,
      `Goal: g`,
      `Verification focus:`,
      `- typecheck passes`,
      `- focused tests pass`,
      ``,
      `Return evidence, command/output summaries when available, confidence, and residual risk.`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Reducer default variant — byte-equal to coordinator.ts:600-612 researchReducer prompt (non-deep-dive)", () => {
  test("renders to the exact researchReducer prompt when projectDeepDive is false", () => {
    const template = pick("reducer", "default")
    const rendered = renderTemplate(template.content, { goal: "g" })
    const expected = [
      `Merge the completed parallel researcher outputs into a compact handoff for later agents.`,
      ``,
      `Goal: g`,
      ``,
      `Deduplicate overlapping findings, mark conflicts explicitly, and do not invent facts missing from evidence.`,
      `Output fields: summary, key_files, architecture_map, risks, recommended_plan_changes, open_questions, confidence.`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Reducer project-deep-dive variant — byte-equal to researchReducer prompt with deep-dive guidance", () => {
  test("renders to researchReducer prompt with the projectDeepDive line included", () => {
    const template = pick("reducer", "project-deep-dive")
    const rendered = renderTemplate(template.content, { goal: "g" })
    const expected = [
      `Merge the completed parallel researcher outputs into a compact handoff for later agents.`,
      ``,
      `Goal: g`,
      ``,
      `Deduplicate overlapping findings, mark conflicts explicitly, and do not invent facts missing from evidence.`,
      `For project deep dives, produce a technical architecture outline covering core subsystems, key algorithms, data flows, safety/runtime boundaries, important files, extension points, risks, and unknowns.`,
      `Output fields: summary, key_files, architecture_map, risks, recommended_plan_changes, open_questions, confidence.`,
    ].join("\n")
    expect(rendered).toBe(expected)
  })
})

describe("Variant weights and frontmatter", () => {
  test("default variants have weight 1; alternate variants start at weight 0 (cold)", () => {
    expect(pick("reviser", "default").weight).toBe(1)
    expect(pick("reviser", "no-target").weight).toBe(0)
    expect(pick("planner", "default").weight).toBe(1)
    expect(pick("reducer", "default").weight).toBe(1)
    expect(pick("reducer", "project-deep-dive").weight).toBe(0)
  })
})
