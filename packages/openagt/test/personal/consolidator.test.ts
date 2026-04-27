import { describe, expect, test } from "bun:test"
import {
  classifyDecayAction,
  DEFAULT_CONFIG,
  extractCandidateTriples,
  filterPatterns,
  groupTriples,
  scoreDecay,
  scorePatternConfidence,
} from "../../src/personal/consolidator"
import { MemoryNote } from "../../src/personal/schema"

function fakeNote(overrides: Partial<Parameters<typeof MemoryNote.parse>[0]>): ReturnType<typeof MemoryNote.parse> {
  return MemoryNote.parse({
    id: "mem_test_" + Math.random().toString(36).slice(2, 10),
    scope: "session",
    sessionID: "ses_test",
    title: "Test note",
    content: "Body",
    tags: [],
    metadata: {},
    source: "manual",
    importance: 5,
    pinned: false,
    time: { created: Date.now(), updated: Date.now() },
    ...overrides,
  })
}

describe("extractCandidateTriples — fast path: structured metadata triple", () => {
  test("emits a triple when metadata carries subject/predicate/object", () => {
    const note = fakeNote({
      metadata: {
        domain: "tax-law",
        subject: "section 199A deduction",
        predicate: "applies_to",
        object: "qualified business income",
      },
    })
    const triples = extractCandidateTriples([note])
    expect(triples.length).toBe(1)
    expect(triples[0]!.domain).toBe("tax-law")
    expect(triples[0]!.subject).toBe("section 199A deduction")
    expect(triples[0]!.predicate).toBe("applies_to")
    expect(triples[0]!.object).toBe("qualified business income")
    expect(triples[0]!.source_note_id).toBe(note.id)
  })

  test("falls back to domain tag when metadata.domain absent", () => {
    const note = fakeNote({
      tags: ["domain:finance", "fact"],
      metadata: { subject: "user", predicate: "uses", object: "Quicken" },
    })
    const triples = extractCandidateTriples([note])
    expect(triples[0]!.domain).toBe("finance")
  })

  test("uses 'general' domain when neither metadata nor tags specify one", () => {
    const note = fakeNote({
      metadata: { subject: "S", predicate: "is", object: "O" },
    })
    const triples = extractCandidateTriples([note])
    expect(triples[0]!.domain).toBe("general")
  })
})

describe("extractCandidateTriples — heuristic fallback over title", () => {
  test("recognises whitelisted verbs in titles", () => {
    const note = fakeNote({ title: "Python is dynamically typed" })
    const triples = extractCandidateTriples([note])
    expect(triples.length).toBe(1)
    expect(triples[0]!.subject).toBe("Python")
    expect(triples[0]!.predicate).toBe("is")
    expect(triples[0]!.object).toBe("dynamically typed")
  })

  test("captures multi-word verbs like 'depends on'", () => {
    const note = fakeNote({ title: "Drizzle depends on bun-sqlite" })
    const triples = extractCandidateTriples([note])
    expect(triples.length).toBe(1)
    expect(triples[0]!.predicate).toBe("depends on")
    expect(triples[0]!.object).toBe("bun-sqlite")
  })

  test("emits nothing when title is too short or has no whitelisted verb", () => {
    expect(extractCandidateTriples([fakeNote({ title: "x" })]).length).toBe(0)
    expect(extractCandidateTriples([fakeNote({ title: "Random observation" })]).length).toBe(0)
  })
})

describe("groupTriples — aggregates by canonical key", () => {
  test("merges duplicate triples and accumulates source_note_ids", () => {
    const triples = [
      { domain: "coding", subject: "bun", predicate: "is", object: "fast", source_note_id: "n1" },
      { domain: "coding", subject: "bun", predicate: "is", object: "fast", source_note_id: "n2" },
      { domain: "coding", subject: "bun", predicate: "is", object: "fast", source_note_id: "n3" },
    ]
    const groups = groupTriples(triples)
    expect(groups.length).toBe(1)
    expect(groups[0]!.occurrences).toBe(3)
    expect(groups[0]!.source_note_ids).toEqual(["n1", "n2", "n3"])
  })

  test("case-insensitive key dedupes 'Bun' / 'bun' / 'BUN'", () => {
    const triples = [
      { domain: "coding", subject: "Bun", predicate: "is", object: "fast", source_note_id: "n1" },
      { domain: "coding", subject: "bun", predicate: "is", object: "fast", source_note_id: "n2" },
      { domain: "coding", subject: "BUN", predicate: "is", object: "fast", source_note_id: "n3" },
    ]
    const groups = groupTriples(triples)
    expect(groups.length).toBe(1)
    expect(groups[0]!.occurrences).toBe(3)
  })

  test("different domains produce different groups", () => {
    const triples = [
      { domain: "coding", subject: "bun", predicate: "is", object: "fast", source_note_id: "n1" },
      { domain: "performance", subject: "bun", predicate: "is", object: "fast", source_note_id: "n2" },
    ]
    expect(groupTriples(triples).length).toBe(2)
  })
})

describe("scorePatternConfidence", () => {
  test("monotonically increases with occurrences", () => {
    const a = scorePatternConfidence(1)
    const b = scorePatternConfidence(5)
    const c = scorePatternConfidence(10)
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
  })

  test("caps at 0.95 — observation alone never claims certainty", () => {
    expect(scorePatternConfidence(100)).toBe(0.95)
    expect(scorePatternConfidence(1000)).toBe(0.95)
  })

  test("zero or negative occurrences yield 0", () => {
    expect(scorePatternConfidence(0)).toBe(0)
    expect(scorePatternConfidence(-5)).toBe(0)
  })
})

describe("filterPatterns", () => {
  function makeGroup(occurrences: number, label = "x"): Parameters<typeof filterPatterns>[0][number] {
    return {
      key: `coding::${label}::is::y`,
      triple: { domain: "coding", subject: label, predicate: "is", object: "y" },
      source_note_ids: Array.from({ length: occurrences }, (_, i) => `n${i}`),
      occurrences,
    }
  }

  test("filters out groups below min_pattern_occurrences", () => {
    const groups = [makeGroup(1), makeGroup(2), makeGroup(3), makeGroup(5)]
    const result = filterPatterns(groups, { min_pattern_occurrences: 3, max_facts_per_run: 50 })
    expect(result.length).toBe(2)
    expect(result.every((g) => g.occurrences >= 3)).toBe(true)
  })

  test("respects max_facts_per_run cap", () => {
    const groups = Array.from({ length: 100 }, (_, i) => makeGroup(5, `s${i}`))
    const result = filterPatterns(groups, { min_pattern_occurrences: 3, max_facts_per_run: 10 })
    expect(result.length).toBe(10)
  })

  test("sorts by descending occurrences (highest-confidence first)", () => {
    const groups = [makeGroup(3, "a"), makeGroup(7, "b"), makeGroup(5, "c")]
    const result = filterPatterns(groups, { min_pattern_occurrences: 3, max_facts_per_run: 50 })
    expect(result.map((g) => g.occurrences)).toEqual([7, 5, 3])
  })
})

describe("scoreDecay — exponential decay with rehearsal boost", () => {
  test("zero age: importance unchanged plus rehearsal boost", () => {
    const result = scoreDecay({
      currentImportance: 5,
      ageMs: 0,
      rehearsalCount: 0,
      half_life_days: 30,
    })
    expect(result).toBeCloseTo(5, 6)
  })

  test("after one half-life, importance roughly halves (no rehearsal)", () => {
    const halfLifeMs = 30 * 24 * 60 * 60 * 1000
    const result = scoreDecay({
      currentImportance: 8,
      ageMs: halfLifeMs,
      rehearsalCount: 0,
      half_life_days: 30,
    })
    expect(result).toBeCloseTo(4, 4)
  })

  test("rehearsals add up to a +5 boost cap", () => {
    const halfLifeMs = 30 * 24 * 60 * 60 * 1000
    const heavy = scoreDecay({
      currentImportance: 5,
      ageMs: halfLifeMs,
      rehearsalCount: 100, // would be +50 but capped at +5
      half_life_days: 30,
    })
    // Decayed 5 → 2.5, plus +5 rehearsal cap → 7.5
    expect(heavy).toBeCloseTo(7.5, 4)
  })

  test("output is clamped to [0, 10]", () => {
    expect(
      scoreDecay({ currentImportance: 100, ageMs: 0, rehearsalCount: 100, half_life_days: 30 }),
    ).toBe(10)
    expect(
      scoreDecay({
        currentImportance: 0,
        ageMs: 365 * 24 * 60 * 60 * 1000,
        rehearsalCount: 0,
        half_life_days: 30,
      }),
    ).toBeGreaterThanOrEqual(0)
  })

  test("half_life_days = 0 is guarded against (treated as 1 to avoid Infinity)", () => {
    const result = scoreDecay({
      currentImportance: 5,
      ageMs: 24 * 60 * 60 * 1000,
      rehearsalCount: 0,
      half_life_days: 0,
    })
    expect(Number.isFinite(result)).toBe(true)
    expect(result).toBeLessThan(5)
  })
})

describe("classifyDecayAction", () => {
  test("returns 'keep' when importance >= demote threshold", () => {
    expect(
      classifyDecayAction(2, { importance_demote_threshold: 1, importance_delete_threshold: 0.1 }),
    ).toBe("keep")
  })

  test("returns 'demote' between delete and demote thresholds", () => {
    expect(
      classifyDecayAction(0.5, { importance_demote_threshold: 1, importance_delete_threshold: 0.1 }),
    ).toBe("demote")
  })

  test("returns 'delete' under delete threshold", () => {
    expect(
      classifyDecayAction(0.05, { importance_demote_threshold: 1, importance_delete_threshold: 0.1 }),
    ).toBe("delete")
  })
})

describe("DEFAULT_CONFIG sanity", () => {
  test("week-long replay window and 30-day half-life", () => {
    expect(DEFAULT_CONFIG.replay_window_hours).toBe(168)
    expect(DEFAULT_CONFIG.decay_half_life_days).toBe(30)
  })

  test("min pattern occurrences low enough for early signal but >= 3", () => {
    expect(DEFAULT_CONFIG.min_pattern_occurrences).toBeGreaterThanOrEqual(3)
  })

  test("WAL checkpoint cadence reasonable (not after every write)", () => {
    expect(DEFAULT_CONFIG.wal_checkpoint_every_n_writes).toBeGreaterThanOrEqual(50)
  })

  test("delete threshold strictly below demote threshold", () => {
    expect(DEFAULT_CONFIG.importance_delete_threshold).toBeLessThan(DEFAULT_CONFIG.importance_demote_threshold)
  })
})
