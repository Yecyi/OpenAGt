export * as MemoryConsolidator from "./consolidator"

// Memory Consolidator — B.3 of the v1.21 plan.
//
// Promotes episodic notes (scope: profile/workspace/session) into the
// semantic and procedural layers using a four-phase pipeline:
//
//   1. Encode   — extract candidate (subject, predicate, object) triples
//                 from un-consolidated notes; group by domain.
//   2. Replay   — for triples already present in semantic memory, bump the
//                 rehearsal counter so they decay slower.
//   3. Decay    — apply exponential decay to importance based on age and
//                 rehearsal count; soft-delete (importance below floor) facts
//                 that have not been referenced.
//   4. Pattern  — emit a SemanticFact whenever a triple has been seen
//                 ≥ min_pattern_occurrences times across the consolidation
//                 window.
//
// The pipeline runs behind an advisory lock so multiple openagt processes do
// not double-consolidate. Failures are non-fatal — the next run will retry.
//
// Most logic lives as PURE functions (extractCandidateTriples, scoreDecay,
// scorePatternConfidence, …) so the algorithmic heart is testable without
// touching the database.

import { Context, Effect, Layer } from "effect"
import { Bus } from "@/bus"
import {
  cleanExpiredAdvisoryLocks,
  releaseAdvisoryLock,
  tryAdvisoryLock,
  walCheckpointTruncate,
} from "@/storage/db"
import { Database, eq } from "@/storage"
import { Log } from "../util"
import { PersonalAgent } from "./personal"
import { ThreeLayerMemory } from "./three-layer"
import { PersonalMemoryNoteTable } from "./personal.sql"
import type { MemoryNote as MemoryNoteType } from "./schema"

const log = Log.create({ service: "consolidator" })

export interface ConsolidatorConfig {
  readonly replay_window_hours: number
  readonly decay_half_life_days: number
  readonly min_pattern_occurrences: number
  readonly max_facts_per_run: number
  readonly importance_demote_threshold: number
  readonly importance_delete_threshold: number
  readonly wal_checkpoint_every_n_writes: number
  readonly lock_ttl_ms: number
}

export const DEFAULT_CONFIG: ConsolidatorConfig = {
  replay_window_hours: 168, // one week
  decay_half_life_days: 30,
  min_pattern_occurrences: 3,
  max_facts_per_run: 50,
  importance_demote_threshold: 1,
  importance_delete_threshold: 0.1,
  wal_checkpoint_every_n_writes: 100,
  lock_ttl_ms: 5 * 60 * 1000, // 5 minutes
}

export interface ConsolidationReport {
  readonly encoded: number
  readonly replayed: number
  readonly decayed: number
  readonly patterns: number
  readonly skipped_lock_held: boolean
}

// =============================================================================
// PURE LOGIC — testable without DB
// =============================================================================

// Extract (subject, predicate, object) triples from a note's metadata, falling
// back to a coarse heuristic over the note title when no triple is encoded.
// The note metadata convention is set by ThreeLayerMemory.recordSemanticFact;
// episodic notes typically lack triples and we do best-effort splitting.
export interface CandidateTriple {
  readonly domain: string
  readonly subject: string
  readonly predicate: string
  readonly object: string
  readonly source_note_id: string
}

export function extractCandidateTriples(notes: readonly MemoryNoteType[]): CandidateTriple[] {
  const out: CandidateTriple[] = []
  for (const note of notes) {
    const meta = note.metadata as Record<string, unknown> | undefined
    const domain =
      (typeof meta?.domain === "string" ? meta.domain : undefined) ??
      domainFromTags(note.tags) ??
      "general"

    // Fast path: note already carries a structured triple in metadata.
    if (
      meta &&
      typeof meta.subject === "string" &&
      typeof meta.predicate === "string" &&
      typeof meta.object === "string"
    ) {
      out.push({
        domain,
        subject: meta.subject,
        predicate: meta.predicate,
        object: meta.object,
        source_note_id: note.id,
      })
      continue
    }

    // Heuristic fallback: split title on common separators. Skip if too short.
    const triple = heuristicTriple(note.title)
    if (triple) {
      out.push({ domain, ...triple, source_note_id: note.id })
    }
  }
  return out
}

function domainFromTags(tags: readonly string[]): string | undefined {
  for (const tag of tags) {
    if (tag.startsWith("domain:")) return tag.slice("domain:".length)
  }
  return undefined
}

function heuristicTriple(title: string): { subject: string; predicate: string; object: string } | undefined {
  const trimmed = title.trim()
  if (trimmed.length < 6) return undefined
  // Look for "<subject> <verb> <object>" with a verb in a small whitelist.
  const verbs = ["is", "uses", "has", "supports", "requires", "prevents", "depends on", "applies to"]
  for (const verb of verbs) {
    const idx = trimmed.toLowerCase().indexOf(` ${verb} `)
    if (idx > 0) {
      const subject = trimmed.slice(0, idx).trim()
      const object = trimmed.slice(idx + verb.length + 2).trim()
      if (subject && object) return { subject, predicate: verb, object }
    }
  }
  return undefined
}

// Group triples by (domain, subject, predicate, object) signature so we can
// count occurrences in O(n).
export interface TripleGroup {
  readonly key: string
  readonly triple: { domain: string; subject: string; predicate: string; object: string }
  readonly source_note_ids: string[]
  readonly occurrences: number
}

export function groupTriples(candidates: readonly CandidateTriple[]): TripleGroup[] {
  const map = new Map<string, { triple: CandidateTriple; source_note_ids: string[] }>()
  for (const c of candidates) {
    const key = `${c.domain}::${c.subject}::${c.predicate}::${c.object}`.toLowerCase()
    const existing = map.get(key)
    if (existing) {
      existing.source_note_ids.push(c.source_note_id)
    } else {
      map.set(key, { triple: c, source_note_ids: [c.source_note_id] })
    }
  }
  return [...map.entries()].map(([key, value]) => ({
    key,
    triple: {
      domain: value.triple.domain,
      subject: value.triple.subject,
      predicate: value.triple.predicate,
      object: value.triple.object,
    },
    source_note_ids: value.source_note_ids,
    occurrences: value.source_note_ids.length,
  }))
}

function tripleKey(input: { domain: string; subject: string; predicate: string; object: string }) {
  return `${input.domain}::${input.subject}::${input.predicate}::${input.object}`.toLowerCase()
}

function semanticKey(note: MemoryNoteType): string | undefined {
  const meta = note.metadata as Record<string, unknown> | undefined
  if (
    typeof meta?.domain !== "string" ||
    typeof meta.subject !== "string" ||
    typeof meta.predicate !== "string" ||
    typeof meta.object !== "string"
  ) {
    return undefined
  }
  return tripleKey({
    domain: meta.domain,
    subject: meta.subject,
    predicate: meta.predicate,
    object: meta.object,
  })
}

// Confidence scoring: more occurrences = higher confidence, capped at 0.95
// so we never claim certainty from observation alone.
export function scorePatternConfidence(occurrences: number): number {
  if (occurrences <= 0) return 0
  const raw = occurrences / 10
  return Math.min(0.95, raw)
}

// Pattern-extraction filter: only emit triples that appear ≥ min times AND
// would clear the confidence floor used by ThreeLayerMemory.searchSemantic.
export function filterPatterns(
  groups: readonly TripleGroup[],
  config: { min_pattern_occurrences: number; max_facts_per_run: number },
): readonly TripleGroup[] {
  return groups
    .filter((g) => g.occurrences >= config.min_pattern_occurrences)
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, config.max_facts_per_run)
}

// Exponential decay on importance. Inputs:
//   - currentImportance: integer 0-10 stored on the note
//   - ageMs: time since last update
//   - rehearsalCount: how many times this fact was referenced in the window
//   - half_life_days: from config
// Output: new importance score in [0, 10].
export function scoreDecay(input: {
  currentImportance: number
  ageMs: number
  rehearsalCount: number
  half_life_days: number
}): number {
  const ageDays = Math.max(0, input.ageMs / (24 * 60 * 60 * 1000))
  const decayFactor = Math.pow(0.5, ageDays / Math.max(1, input.half_life_days))
  // Each rehearsal in the window adds back 0.5 importance points so frequently-
  // accessed facts decay slower.
  const rehearsalBoost = Math.min(5, input.rehearsalCount * 0.5)
  const decayed = input.currentImportance * decayFactor + rehearsalBoost
  return Math.max(0, Math.min(10, decayed))
}

export type DecayAction = "keep" | "demote" | "delete"

export function classifyDecayAction(
  newImportance: number,
  config: { importance_demote_threshold: number; importance_delete_threshold: number },
): DecayAction {
  if (newImportance < config.importance_delete_threshold) return "delete"
  if (newImportance < config.importance_demote_threshold) return "demote"
  return "keep"
}

// =============================================================================
// EFFECT SERVICE — orchestrates the pure pieces around DB I/O
// =============================================================================

export interface Interface {
  readonly runOnce: (overrides?: Partial<ConsolidatorConfig>) => Effect.Effect<ConsolidationReport, Error>
}

export class Service extends Context.Service<Service, Interface>()("@openagt/MemoryConsolidator") {}

const LOCK_NAME = "consolidator.runOnce"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const personal = yield* PersonalAgent.Service
    const tlm = yield* ThreeLayerMemory.Service
    yield* Bus.Service // ensure layer is wired even if not used directly

    const runOnce: Interface["runOnce"] = Effect.fn("Consolidator.runOnce")(function* (overrides) {
      const config: ConsolidatorConfig = { ...DEFAULT_CONFIG, ...overrides }
      // Best-effort: clean any abandoned locks before we try to acquire ours.
      cleanExpiredAdvisoryLocks()
      const acquired = tryAdvisoryLock(LOCK_NAME, config.lock_ttl_ms)
      if (!acquired) {
        log.info("consolidator skipped — lock held by another process")
        return {
          encoded: 0,
          replayed: 0,
          decayed: 0,
          patterns: 0,
          skipped_lock_held: true,
        } satisfies ConsolidationReport
      }

      try {
        // Phase 1 — Encode: pull recent un-consolidated episodic notes.
        const since = Date.now() - config.replay_window_hours * 60 * 60 * 1000
        const profile = yield* personal.listMemory({ scope: "profile" })
        const workspace = yield* personal.listMemory({ scope: "workspace" })
        const session = yield* personal.listMemory({ scope: "session" })
        const recentEpisodic = [...profile, ...workspace, ...session].filter(
          (n) =>
            n.time.updated >= since &&
            (n.metadata as Record<string, unknown> | undefined)?.consolidated !== true,
        )
        const candidates = extractCandidateTriples(recentEpisodic)

        // Phase 2 — Replay + pattern extraction
        const groups = groupTriples(candidates)
        const existingSemanticByKey = new Map(
          (yield* personal.listMemory({ scope: "semantic" })).flatMap((note) => {
            const key = semanticKey(note)
            return key ? [[key, note] as const] : []
          }),
        )
        const replayGroups = groups
          .filter((pattern) => existingSemanticByKey.has(pattern.key))
          .sort((a, b) => b.occurrences - a.occurrences)
          .slice(0, config.max_facts_per_run)
        const patterns = filterPatterns(groups, config).filter((pattern) => !existingSemanticByKey.has(pattern.key))

        let writes = 0
        let replayed = 0
        for (const pattern of replayGroups) {
          const note = existingSemanticByKey.get(pattern.key)
          if (!note) continue
          const meta = note.metadata as Record<string, unknown>
          const sourceNoteIDs = Array.isArray(meta.source_note_ids)
            ? meta.source_note_ids.filter((item): item is string => typeof item === "string")
            : []
          const rehearsalCount =
            (typeof meta.rehearsal_count === "number" ? meta.rehearsal_count : 0) + pattern.occurrences
          const confidence = Math.max(
            typeof meta.confidence === "number" ? meta.confidence : 0,
            scorePatternConfidence(rehearsalCount),
          )
          const timestamp = Date.now()
          yield* Effect.sync(() =>
            Database.use((db) =>
              db
                .update(PersonalMemoryNoteTable)
                .set({
                  metadata: {
                    ...meta,
                    source_note_ids: [...new Set([...sourceNoteIDs, ...pattern.source_note_ids])],
                    rehearsal_count: rehearsalCount,
                    confidence,
                    replayed_at: timestamp,
                  },
                  importance: Math.max(note.importance, Math.round(confidence * 10)),
                  time_updated: timestamp,
                })
                .where(eq(PersonalMemoryNoteTable.id, note.id))
                .run(),
            ),
          )
          replayed++
          writes++
          if (writes % config.wal_checkpoint_every_n_writes === 0) walCheckpointTruncate()
        }

        let encoded = 0
        for (const pattern of patterns) {
          yield* tlm.recordSemanticFact({
            domain: pattern.triple.domain,
            subject: pattern.triple.subject,
            predicate: pattern.triple.predicate,
            object: pattern.triple.object,
            confidence: scorePatternConfidence(pattern.occurrences),
            source_note_ids: pattern.source_note_ids,
            rehearsal_count: pattern.occurrences,
          })
          encoded++
          writes++
          if (writes % config.wal_checkpoint_every_n_writes === 0) walCheckpointTruncate()
        }

        const sourceIDs = new Set(
          [...replayGroups, ...patterns].flatMap((pattern) => pattern.source_note_ids),
        )
        if (sourceIDs.size > 0) {
          const timestamp = Date.now()
          for (const note of recentEpisodic.filter((item) => sourceIDs.has(item.id))) {
            yield* Effect.sync(() =>
              Database.use((db) =>
                db
                  .update(PersonalMemoryNoteTable)
                  .set({
                    metadata: {
                      ...(note.metadata as Record<string, unknown>),
                      consolidated: true,
                      consolidated_at: timestamp,
                    },
                    time_updated: timestamp,
                  })
                  .where(eq(PersonalMemoryNoteTable.id, note.id))
                  .run(),
              ),
            )
            writes++
            if (writes % config.wal_checkpoint_every_n_writes === 0) walCheckpointTruncate()
          }
        }

        // Phase 3 — Decay
        const semanticNotes = yield* personal.listMemory({ scope: "semantic" })
        const now = Date.now()
        let decayed = 0
        for (const note of semanticNotes) {
          if (note.pinned) continue
          const meta = note.metadata as Record<string, unknown> | undefined
          const rehearsal = typeof meta?.rehearsal_count === "number" ? meta.rehearsal_count : 0
          const newImportance = scoreDecay({
            currentImportance: note.importance,
            ageMs: now - note.time.updated,
            rehearsalCount: rehearsal,
            half_life_days: config.decay_half_life_days,
          })
          const action = classifyDecayAction(newImportance, config)
          const importance = Math.max(0, Math.min(10, Math.round(newImportance)))
          if (action === "keep") {
            yield* Effect.sync(() =>
              Database.use((db) =>
                db
                  .update(PersonalMemoryNoteTable)
                  .set({
                    metadata: {
                      ...(meta ?? {}),
                      decay_action: "keep",
                      decay_importance: newImportance,
                      decayed_at: now,
                    },
                    importance,
                    time_updated: now,
                  })
                  .where(eq(PersonalMemoryNoteTable.id, note.id))
                  .run(),
              ),
            )
            decayed++
            writes++
            if (writes % config.wal_checkpoint_every_n_writes === 0) walCheckpointTruncate()
            continue
          }
          yield* Effect.sync(() =>
            Database.use((db) =>
              db
                .update(PersonalMemoryNoteTable)
                .set({
                  scope: "profile",
                  tags: action === "delete" ? note.tags.filter((tag) => tag !== "fact") : note.tags,
                  metadata: {
                    ...(meta ?? {}),
                    archived: action === "delete" ? true : undefined,
                    deleted: action === "delete" ? true : undefined,
                    decayed_from: "semantic",
                    decay_action: action,
                    decay_importance: newImportance,
                    decayed_at: now,
                  },
                  importance: action === "delete" ? 0 : importance,
                  time_updated: now,
                })
                .where(eq(PersonalMemoryNoteTable.id, note.id))
                .run(),
            ),
          )
          decayed++
          writes++
          if (writes % config.wal_checkpoint_every_n_writes === 0) walCheckpointTruncate()
        }

        // Final WAL checkpoint to trim the journal after our writes.
        if (writes > 0) walCheckpointTruncate()

        const report: ConsolidationReport = {
          encoded,
          replayed,
          decayed,
          patterns: patterns.length,
          skipped_lock_held: false,
        }
        log.info("consolidator finished", report)
        return report
      } finally {
        releaseAdvisoryLock(LOCK_NAME)
      }
    })

    return Service.of({ runOnce })
  }),
)

import { ThreeLayerMemory as ThreeLayerMemoryNS } from "./three-layer"

// Provides PersonalAgent + ThreeLayerMemory + Bus so the consolidator can
// invoke their write paths.
export const defaultLayer = layer.pipe(
  Layer.provide(ThreeLayerMemoryNS.defaultLayer),
  Layer.provide(PersonalAgent.defaultLayer),
  Layer.provide(Bus.defaultLayer),
)
