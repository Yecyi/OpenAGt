import { describe, expect, test } from "bun:test"
import {
  detectDomain,
  makeSemanticTitle,
  ProceduralRecipeInput,
  proceduralMetadata,
  proceduralTags,
  SemanticFactInput,
  semanticMetadata,
  semanticTags,
} from "../../src/personal/three-layer"
import { MemoryScope } from "../../src/personal/schema"

describe("MemoryScope — 3LMA scopes", () => {
  test("legacy scopes still parse", () => {
    expect(MemoryScope.parse("profile")).toBe("profile")
    expect(MemoryScope.parse("workspace")).toBe("workspace")
    expect(MemoryScope.parse("session")).toBe("session")
  })

  test("new semantic + procedural scopes parse", () => {
    expect(MemoryScope.parse("semantic")).toBe("semantic")
    expect(MemoryScope.parse("procedural")).toBe("procedural")
  })

  test("rejects unknown scopes (registry stays closed)", () => {
    expect(() => MemoryScope.parse("episodic")).toThrow()
    expect(() => MemoryScope.parse("mystery")).toThrow()
  })
})

describe("Semantic fact metadata layout", () => {
  test("semanticMetadata embeds the full triple plus provenance", () => {
    const input = SemanticFactInput.parse({
      domain: "tax-law",
      subject: "section 199A deduction",
      predicate: "applies_to",
      object: "qualified business income",
      confidence: 0.85,
      source_note_ids: ["note_a", "note_b"],
      rehearsal_count: 3,
    })
    const meta = semanticMetadata(input)
    expect(meta.layer).toBe("semantic")
    expect(meta.subject).toBe("section 199A deduction")
    expect(meta.predicate).toBe("applies_to")
    expect(meta.object).toBe("qualified business income")
    expect(meta.confidence).toBe(0.85)
    expect(meta.source_note_ids).toEqual(["note_a", "note_b"])
    expect(meta.rehearsal_count).toBe(3)
    expect(meta.domain).toBe("tax-law")
  })

  test("semanticTags use canonical prefixes (domain:, fact, predicate:)", () => {
    const input = SemanticFactInput.parse({
      domain: "tax-law",
      subject: "S",
      predicate: "P",
      object: "O",
    })
    expect(semanticTags(input)).toEqual(["domain:tax-law", "fact", "predicate:P"])
  })

  test("makeSemanticTitle is bounded for FTS5 token sanity", () => {
    const long = "a".repeat(500)
    const title = makeSemanticTitle({ subject: long, predicate: "x", object: "y" })
    expect(title.length).toBeLessThanOrEqual(200)
  })

  test("SemanticFactInput rejects empty fields and out-of-range confidence", () => {
    expect(() => SemanticFactInput.parse({ domain: "", subject: "s", predicate: "p", object: "o" })).toThrow()
    expect(() =>
      SemanticFactInput.parse({ domain: "d", subject: "s", predicate: "p", object: "o", confidence: 1.5 }),
    ).toThrow()
  })
})

describe("Procedural recipe metadata layout", () => {
  test("proceduralMetadata captures recipe shape and outcome stats", () => {
    const input = ProceduralRecipeInput.parse({
      task_signature: "coding:refactor:auth",
      domain: "coding",
      steps: [
        { description: "Map call sites", role: "researcher" },
        { description: "Apply changes", role: "implementer" },
        { description: "Run typecheck", role: "verifier" },
      ],
      success_count: 4,
      failure_count: 1,
      mean_duration_ms: 240_000,
      pitfalls_avoided: ["Don't touch generated files"],
    })
    const meta = proceduralMetadata(input)
    expect(meta.layer).toBe("procedural")
    expect(meta.task_signature).toBe("coding:refactor:auth")
    expect((meta.steps as unknown[]).length).toBe(3)
    expect(meta.success_count).toBe(4)
    expect(meta.failure_count).toBe(1)
    expect(meta.mean_duration_ms).toBe(240_000)
    expect(meta.pitfalls_avoided).toEqual(["Don't touch generated files"])
  })

  test("proceduralTags pin task_signature so searchProcedural can hit FTS5", () => {
    const input = ProceduralRecipeInput.parse({
      task_signature: "coding:refactor:auth",
      domain: "coding",
      steps: [{ description: "x" }],
    })
    expect(proceduralTags(input)).toEqual(["domain:coding", "recipe", "task_sig:coding:refactor:auth"])
  })

  test("ProceduralRecipeInput requires at least one step", () => {
    expect(() =>
      ProceduralRecipeInput.parse({ task_signature: "t", domain: "d", steps: [] }),
    ).toThrow()
  })
})

describe("detectDomain heuristic", () => {
  test("detects domain from keyword hits in goal text", () => {
    // Prefer single-domain phrases — the stub heuristic gives the same weight
    // to every keyword so multi-domain phrases ("draft a tax memo") tie and
    // fall back to insertion order. Final detector lives in task-classifier.
    expect(detectDomain("Help me reconcile the tax deduction ledger expense")).toBe("finance")
    expect(detectDomain("Summarize the research paper")).toBe("research")
    expect(detectDomain("Add a unit test to the api module")).toBe("coding")
    expect(detectDomain("Schedule a doctor appointment for the prescription")).toBe("health")
  })

  test("falls back to 'general' when no keywords match", () => {
    expect(detectDomain("Tell me a joke")).toBe("general")
  })

  test("picks the highest-scoring domain on competing hits", () => {
    // Two finance keywords + one coding keyword → finance wins.
    expect(detectDomain("Reconcile the budget invoice line in code")).toBe("finance")
  })
})
