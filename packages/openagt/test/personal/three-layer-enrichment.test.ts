import { describe, expect, test } from "bun:test"
import {
  enrichMemoryContext,
  extractKeywords,
  taskSignatureFor,
} from "../../src/personal/three-layer"

describe("extractKeywords — stable signature inputs", () => {
  test("strips short tokens (< 4 chars) and dedupes, preserves first-appearance order", () => {
    const k = extractKeywords("Run the run-time test build build build")
    // 'run', 'the' < 4 chars dropped. 'api' would be too (3 chars) — using
    // 'build' (5 chars) which gets deduped. 'time' splits out of 'run-time'.
    expect(k).toEqual(["time", "test", "build"])
  })

  test("strips common stopwords", () => {
    const k = extractKeywords("This task should have been completed when there were updates")
    expect(k).not.toContain("this")
    expect(k).not.toContain("should")
    expect(k).not.toContain("there")
    expect(k).not.toContain("been")
    expect(k).toContain("task")
    expect(k).toContain("completed")
    expect(k).toContain("updates")
  })

  test("preserves order of first appearance", () => {
    const k = extractKeywords("alpha beta gamma alpha")
    expect(k).toEqual(["alpha", "beta", "gamma"])
  })

  test("handles non-alpha separators gracefully", () => {
    const k = extractKeywords("foo-bar.baz/qux:quux")
    expect(k).toEqual(["quux"])
    // 'foo','bar','baz','qux' all < 4 chars
  })

  test("empty / whitespace yields empty array", () => {
    expect(extractKeywords("")).toEqual([])
    expect(extractKeywords("    ")).toEqual([])
  })
})

describe("taskSignatureFor — stable across rephrasings", () => {
  test("same workflow + same top-3 keywords → same signature regardless of word order", () => {
    const a = taskSignatureFor({ goal: "implement mission control backend api", workflow: "coding" })
    const b = taskSignatureFor({ goal: "api control backend implement mission", workflow: "coding" })
    expect(a).toBe(b)
  })

  test("different workflows produce different signatures even on same goal", () => {
    const a = taskSignatureFor({ goal: "review the auth module", workflow: "coding" })
    const b = taskSignatureFor({ goal: "review the auth module", workflow: "review" })
    expect(a).not.toBe(b)
  })

  test("signature includes workflow + domain prefixes for traceability", () => {
    const sig = taskSignatureFor({ goal: "compute the budget tax invoice ledger", workflow: "personal-admin" })
    // detectDomain hits the finance vocabulary (budget/tax/invoice/ledger)
    expect(sig.startsWith("personal-admin:finance:")).toBe(true)
  })

  test("totally different goals (different keywords) yield different signatures", () => {
    const a = taskSignatureFor({ goal: "implement auth backend", workflow: "coding" })
    const b = taskSignatureFor({ goal: "draft architecture doc", workflow: "coding" })
    expect(a).not.toBe(b)
  })
})

describe("enrichMemoryContext — pure merge", () => {
  const baseCtx = {
    scopes: ["profile", "workspace"],
    workflow_tags: ["workflow:coding"],
    expert_tags: ["expert:coding.researcher"],
    note_ids: [],
  }

  test("merges fact + recipe note IDs into note_ids without duplicates", () => {
    const enriched = enrichMemoryContext({
      base: baseCtx,
      facts: [
        { note_id: "fact_1", domain: "coding" },
        { note_id: "fact_2", domain: "coding" },
      ],
      recipes: [{ note_id: "recipe_1", domain: "coding" }],
      domain: "coding",
    })
    expect(enriched.note_ids).toEqual(["fact_1", "fact_2", "recipe_1"])
  })

  test("dedupes when a note appears in both facts and recipes (rare but possible)", () => {
    const enriched = enrichMemoryContext({
      base: baseCtx,
      facts: [{ note_id: "shared", domain: "coding" }],
      recipes: [{ note_id: "shared", domain: "coding" }],
      domain: "coding",
    })
    expect(enriched.note_ids).toEqual(["shared"])
  })

  test("preserves base note_ids when adding new ones", () => {
    const enriched = enrichMemoryContext({
      base: { ...baseCtx, note_ids: ["existing_1", "existing_2"] },
      facts: [{ note_id: "fact_1", domain: "coding" }],
      recipes: [],
      domain: "coding",
    })
    expect(enriched.note_ids).toEqual(["existing_1", "existing_2", "fact_1"])
  })

  test("appends domain tag to workflow_tags (deduped)", () => {
    const enriched = enrichMemoryContext({
      base: baseCtx,
      facts: [],
      recipes: [],
      domain: "finance",
    })
    expect(enriched.workflow_tags).toContain("workflow:coding")
    expect(enriched.workflow_tags).toContain("domain:finance")
  })

  test("expands scopes to include semantic + procedural so downstream search reaches the new layers", () => {
    const enriched = enrichMemoryContext({
      base: baseCtx,
      facts: [],
      recipes: [],
      domain: "general",
    })
    expect(enriched.scopes).toContain("profile")
    expect(enriched.scopes).toContain("workspace")
    expect(enriched.scopes).toContain("semantic")
    expect(enriched.scopes).toContain("procedural")
  })

  test("expert_tags pass through unchanged", () => {
    const enriched = enrichMemoryContext({
      base: { ...baseCtx, expert_tags: ["expert:a", "expert:b"] },
      facts: [],
      recipes: [],
      domain: "x",
    })
    expect(enriched.expert_tags).toEqual(["expert:a", "expert:b"])
  })

  test("idempotent — re-enriching the same context yields the same shape", () => {
    const first = enrichMemoryContext({
      base: baseCtx,
      facts: [{ note_id: "f1", domain: "coding" }],
      recipes: [],
      domain: "coding",
    })
    const second = enrichMemoryContext({
      base: first,
      facts: [{ note_id: "f1", domain: "coding" }],
      recipes: [],
      domain: "coding",
    })
    expect(second.note_ids).toEqual(first.note_ids)
    expect(second.workflow_tags.length).toBe(first.workflow_tags.length)
    expect(second.scopes.length).toBe(first.scopes.length)
  })
})
