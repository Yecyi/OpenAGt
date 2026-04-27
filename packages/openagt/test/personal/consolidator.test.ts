import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import {
  classifyDecayAction,
  DEFAULT_CONFIG,
  extractCandidateTriples,
  filterPatterns,
  groupTriples,
  defaultLayer as memoryConsolidatorLayer,
  scoreDecay,
  scorePatternConfidence,
  Service as MemoryConsolidatorService,
} from "../../src/personal/consolidator"
import { PersonalAgent } from "../../src/personal/personal"
import { PersonalMemoryNoteTable } from "../../src/personal/personal.sql"
import { MemoryNote, MemoryNoteID } from "../../src/personal/schema"
import { ThreeLayerMemory } from "../../src/personal/three-layer"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    PersonalAgent.defaultLayer,
    ThreeLayerMemory.defaultLayer,
    memoryConsolidatorLayer,
  ),
)

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

describe("MemoryConsolidator runOnce integration", () => {
  it.live("replays existing semantic facts instead of creating duplicates", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const personal = yield* PersonalAgent.Service
        const threeLayer = yield* ThreeLayerMemory.Service
        const consolidator = yield* MemoryConsolidatorService
        const existing = yield* threeLayer.recordSemanticFact({
          domain: "coding",
          subject: "Bun",
          predicate: "is",
          object: "fast",
          confidence: 0.6,
          source_note_ids: ["old_note"],
          rehearsal_count: 1,
        })
        const episodic = yield* Effect.all(
          Array.from({ length: 3 }, (_, index) =>
            personal.remember({
              scope: "workspace",
              title: `Bun speed observation ${index}`,
              content: "Bun is fast",
              tags: ["domain:coding"],
              metadata: {
                domain: "coding",
                subject: "Bun",
                predicate: "is",
                object: "fast",
              },
              source: "manual",
              importance: 5,
            }),
          ),
        )

        const report = yield* consolidator.runOnce({ decay_half_life_days: 30_000 })
        const semanticNotes = yield* personal.listMemory({ scope: "semantic" })
        const matching = semanticNotes.filter((note) => {
          const metadata = note.metadata as Record<string, unknown>
          return metadata.subject === "Bun" && metadata.predicate === "is" && metadata.object === "fast"
        })
        const updated = matching[0]!
        const metadata = updated.metadata as Record<string, unknown>
        const workspaceNotes = yield* personal.listMemory({ scope: "workspace" })
        const consolidatedIDs = new Set(
          workspaceNotes
            .filter((note) => (note.metadata as Record<string, unknown>).consolidated === true)
            .map((note) => note.id),
        )

        expect(report.encoded).toBe(0)
        expect(report.replayed).toBe(1)
        expect(matching.map((note) => String(note.id))).toEqual([existing.note_id])
        expect(metadata.rehearsal_count).toBe(4)
        expect(metadata.source_note_ids).toEqual(
          expect.arrayContaining(["old_note", ...episodic.map((note) => note.id)]),
        )
        expect(episodic.every((note) => consolidatedIDs.has(note.id))).toBe(true)
      }),
    ),
  )

  it.live("decay soft-deletes semantic notes and removes them from semantic search", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const personal = yield* PersonalAgent.Service
        const threeLayer = yield* ThreeLayerMemory.Service
        const consolidator = yield* MemoryConsolidatorService
        const fact = yield* threeLayer.recordSemanticFact({
          domain: "coding",
          subject: "LegacyEndpoint",
          predicate: "is",
          object: "obsolete",
          confidence: 0.9,
          source_note_ids: ["old_note"],
          rehearsal_count: 0,
        })
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(PersonalMemoryNoteTable)
              .set({ time_updated: Date.now() - 365 * 24 * 60 * 60 * 1000 })
              .where(eq(PersonalMemoryNoteTable.id, MemoryNoteID.zod.parse(fact.note_id)))
              .run(),
          ),
        )

        const before = yield* threeLayer.searchSemantic({
          query: "",
          domain: "coding",
          minConfidence: 0.5,
        })
        const report = yield* consolidator.runOnce({
          replay_window_hours: 1,
          decay_half_life_days: 1,
        })
        const after = yield* threeLayer.searchSemantic({
          query: "",
          domain: "coding",
          minConfidence: 0.5,
        })
        const profileNotes = yield* personal.listMemory({ scope: "profile" })
        const archived = profileNotes.find((note) => note.id === fact.note_id)
        const metadata = archived?.metadata as Record<string, unknown> | undefined

        expect(before.some((item) => item.note_id === fact.note_id)).toBe(true)
        expect(report.decayed).toBeGreaterThanOrEqual(1)
        expect(after.some((item) => item.note_id === fact.note_id)).toBe(false)
        expect(metadata?.decay_action).toBe("delete")
        expect(metadata?.deleted).toBe(true)
      }),
    ),
  )

  it.live("keep decay advances the update timestamp so repeated runs do not compound age", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const personal = yield* PersonalAgent.Service
        const threeLayer = yield* ThreeLayerMemory.Service
        const consolidator = yield* MemoryConsolidatorService
        const fact = yield* threeLayer.recordSemanticFact({
          domain: "coding",
          subject: "StableAPI",
          predicate: "is",
          object: "supported",
          confidence: 0.9,
          source_note_ids: ["old_note"],
          rehearsal_count: 0,
        })
        const old = Date.now() - 24 * 60 * 60 * 1000
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(PersonalMemoryNoteTable)
              .set({ time_updated: old, importance: 8 })
              .where(eq(PersonalMemoryNoteTable.id, MemoryNoteID.zod.parse(fact.note_id)))
              .run(),
          ),
        )

        const report = yield* consolidator.runOnce({
          replay_window_hours: 1,
          decay_half_life_days: 30,
          importance_demote_threshold: 1,
          importance_delete_threshold: 0.1,
        })
        const after = (yield* personal.listMemory({ scope: "semantic" })).find((note) => note.id === fact.note_id)
        const metadata = after?.metadata as Record<string, unknown> | undefined

        expect(report.decayed).toBeGreaterThanOrEqual(1)
        expect(after?.time.updated).toBeGreaterThan(old)
        expect(metadata?.decay_action).toBe("keep")
        expect(metadata?.decayed_at).toBe(after?.time.updated)
      }),
    ),
  )
})
