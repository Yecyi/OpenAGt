import z from "zod"
import { Bus } from "@/bus"
import { ProjectID } from "@/project/schema"
import { loadMemory } from "@/session/memory"
import { SessionID } from "@/session/schema"
import { Database, desc, eq, sql } from "@/storage"
import { Client as DatabaseClient } from "@/storage/db"
import { Effect } from "effect"
import { PersonalMemoryIdempotencyTable, PersonalMemoryNoteTable } from "./personal.sql"
import {
  MemoryNoteID,
  MemorySearchResult,
  MemorySource,
  type MemoryKind as MemoryKindType,
  type MemoryNote as MemoryNoteType,
  type MemoryScope as MemoryScopeType,
  type MemorySearchResult as MemorySearchResultType,
} from "./schema"
import { memoryFromRow } from "./row-mappers"
import { escapeFts, lexicalScore, recencyScore, scopeWeight, tagScore } from "./scoring"
import { MemoryUpdated } from "./events"

function now() {
  return Date.now()
}

function privacySafeContent(content: string) {
  return ![
    /api[_-]?key\s*[:=]/i,
    /secret\s*[:=]/i,
    /token\s*[:=]/i,
    /password\s*[:=]/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ].some((pattern) => pattern.test(content))
}

function changed(result: unknown) {
  if (typeof result !== "object" || result === null || !("changes" in result)) return true
  return typeof result.changes === "number" ? result.changes > 0 : true
}

export type SynthesizeKind =
  | "coordinator_run_completed"
  | "verify_completed"
  | "manual_preference"
  | "follow_up_completed"
  | "expert_output"
  | "reviser_pattern"
  | "reducer_summary"
  | "verifier_rule"

export interface RememberInput {
  scope: MemoryScopeType
  // Wave 5: orthogonal classifier — fact (empirical claim), preference
  // (stated style/approach choice), belief (working hypothesis). Default
  // "belief" because most ad-hoc remember() callers don't classify.
  kind?: MemoryKindType
  title: string
  content: string
  projectID?: ProjectID
  sessionID?: SessionID
  tags?: string[]
  metadata?: Record<string, unknown>
  source: z.infer<typeof MemorySource>
  importance?: number
  pinned?: boolean
}

export interface ListMemoryInput {
  scope?: MemoryScopeType
  // Wave 5: optional allow-list of kinds. When omitted, all kinds returned
  // (no behavior change for existing callers). Critic / no-personal-memory
  // call sites pass `["fact"]` to filter out preferences and beliefs.
  kinds?: MemoryKindType[]
  projectID?: ProjectID
  sessionID?: SessionID
}

export interface SearchMemoryInput {
  query: string
  projectID?: ProjectID
  sessionID?: SessionID
  scopes?: MemoryScopeType[]
  // Wave 5: same allow-list semantics as ListMemoryInput.kinds.
  kinds?: MemoryKindType[]
  workflow?: string
  expertID?: string
  role?: string
  artifactType?: string
  includeFailurePatterns?: boolean
}

export interface SynthesizeInput {
  kind: SynthesizeKind
  projectID?: ProjectID
  sessionID?: SessionID
  title: string
  content: string
  tags?: string[]
  metadata?: Record<string, unknown>
  importance?: number
}

export interface SynthesizeOnceInput {
  tag: string
  kind: SynthesizeKind
  projectID?: ProjectID
  sessionID?: SessionID
  title: string
  content: string
  tags?: string[]
  metadata?: Record<string, unknown>
  importance?: number
}

export function createMemoryOps(bus: Bus.Interface) {
  const remember = Effect.fn("PersonalAgent.remember")(function* (input: RememberInput) {
    if (!privacySafeContent(input.content)) return yield* Effect.fail(new Error("Memory content failed privacy filter"))
    const id = MemoryNoteID.ascending()
    const timestamp = now()
    yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .insert(PersonalMemoryNoteTable)
          .values({
            id,
            scope: input.scope,
            kind: input.kind ?? "belief",
            project_id: input.projectID,
            session_id: input.sessionID,
            title: input.title,
            content: input.content,
            tags: input.tags ?? [],
            metadata: input.metadata ?? {},
            source: input.source,
            importance: input.importance ?? 5,
            pinned: input.pinned ? 1 : 0,
            time_created: timestamp,
            time_updated: timestamp,
          })
          .run(),
      ),
    )
    const note = yield* Effect.sync(() =>
      Database.use((db) => db.select().from(PersonalMemoryNoteTable).where(eq(PersonalMemoryNoteTable.id, id)).get()),
    ).pipe(Effect.map((row) => memoryFromRow(row!)))
    yield* bus.publish(MemoryUpdated, note)
    return note
  })

  const listMemory = Effect.fn("PersonalAgent.listMemory")(function* (input?: ListMemoryInput) {
    const rows = yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .select()
          .from(PersonalMemoryNoteTable)
          .orderBy(desc(PersonalMemoryNoteTable.time_updated))
          .all()
          .filter(
            (row) =>
              (!input?.scope || row.scope === input.scope) &&
              (!input?.kinds || input.kinds.includes((row.kind ?? "belief") as MemoryKindType)) &&
              (!input?.projectID || row.project_id === input.projectID) &&
              (!input?.sessionID || row.session_id === input.sessionID),
          ),
      ),
    )
    return rows.map(memoryFromRow)
  })

  const sessionSearch = (input: { query: string; sessionID?: SessionID }) =>
    Effect.gen(function* () {
      if (!input.sessionID) return [] as MemorySearchResultType[]
      const sessionID = input.sessionID
      const memory = yield* Effect.promise(() => loadMemory(sessionID)).pipe(Effect.orElseSucceed(() => null))
      if (!memory) return [] as MemorySearchResultType[]
      const lexical = lexicalScore(memory, input.query)
      if (input.query.trim() && lexical === 0) return [] as MemorySearchResultType[]
      return [
        MemorySearchResult.parse({
          id: MemoryNoteID.ascending(),
          scope: "session",
          sessionID,
          title: "Session Memory",
          content: memory,
          tags: ["session-memory"],
          source: "manual",
          importance: 10,
          pinned: true,
          time: {
            created: now(),
            updated: now(),
          },
          score: scopeWeight.session + lexical + 10,
          match: "session",
        }),
      ]
    })

  const searchMemory = Effect.fn("PersonalAgent.searchMemory")(function* (input: SearchMemoryInput) {
    const scopes =
      input.scopes && input.scopes.length > 0 ? input.scopes : (["profile", "workspace"] as MemoryScopeType[])
    const ftsQuery = escapeFts(input.query)
    const matches = yield* Effect.sync(() =>
      !ftsQuery
        ? new Map<string, number>()
        : new Map(
            DatabaseClient()
              .all<{ id: string; score: number }>(
                sql`
                  SELECT note.id AS id, bm25(personal_memory_fts) AS score
                  FROM personal_memory_fts
                  JOIN personal_memory_note AS note ON note.rowid = personal_memory_fts.rowid
                  WHERE personal_memory_fts MATCH ${ftsQuery}
                  ORDER BY score
                  LIMIT 50
                `,
              )
              .map((item) => [item.id, Math.max(0, item.score * -1)]),
          ),
    )
    const rows = yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .select()
          .from(PersonalMemoryNoteTable)
          .orderBy(desc(PersonalMemoryNoteTable.time_updated))
          .all()
          .filter(
            (row) =>
              scopes.includes(row.scope as MemoryScopeType) &&
              (!input.kinds || input.kinds.includes((row.kind ?? "belief") as MemoryKindType)) &&
              (!input.projectID || row.project_id === input.projectID) &&
              (!input.workflow || row.tags.includes(`workflow:${input.workflow}`)) &&
              (!input.expertID || row.tags.includes(`expert:${input.expertID}`)) &&
              (!input.role || row.tags.includes(`role:${input.role}`)) &&
              (!input.artifactType || row.tags.includes(`artifact:${input.artifactType}`)) &&
              (input.includeFailurePatterns || !row.tags.includes("failure-pattern")) &&
              (!ftsQuery || matches.has(row.id)),
          ),
      ),
    )
    const ranked = rows
      .map((row) => {
        const note = memoryFromRow(row)
        const lexical = lexicalScore(`${note.title}\n${note.content}\n${note.tags.join(" ")}`, input.query)
        if (ftsQuery && !matches.has(note.id)) return
        return MemorySearchResult.parse({
          ...note,
          score:
            scopeWeight[note.scope as MemoryScopeType] +
            lexical +
            recencyScore(note.time.updated) +
            note.importance +
            (note.pinned ? 10 : 0) +
            tagScore(note.tags, input) +
            (matches.get(note.id) ?? 0),
          match: ftsQuery ? "fts" : "recent",
        })
      })
      .filter((item): item is MemorySearchResultType => Boolean(item))
    const session = yield* sessionSearch({ query: input.query, sessionID: input.sessionID })
    return [...ranked, ...session].toSorted((left, right) => right.score - left.score)
  })

  const synthesize = Effect.fn("PersonalAgent.synthesize")(function* (input: SynthesizeInput) {
    const scope: MemoryScopeType =
      input.kind === "manual_preference" ? "profile" : input.projectID ? "workspace" : "profile"
    const source =
      input.kind === "manual_preference"
        ? "manual"
        : input.kind === "follow_up_completed"
          ? "scheduler"
          : input.kind === "coordinator_run_completed"
            ? "coordinator"
            : input.kind === "expert_output"
              ? "expert"
              : input.kind === "reviser_pattern"
                ? "reviser"
                : input.kind === "reducer_summary"
                  ? "reducer"
                  : "verifier"
    return yield* remember({
      scope,
      title: input.title,
      content: input.content,
      projectID: input.projectID,
      sessionID: input.sessionID,
      tags: input.tags ?? [input.kind],
      metadata: input.metadata,
      importance: input.importance ?? (input.kind === "verify_completed" ? 7 : 6),
      source,
    })
  })

  const hasMemoryTag = Effect.fn("PersonalAgent.hasMemoryTag")(function* (tag: string) {
    return yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .select()
          .from(PersonalMemoryNoteTable)
          .all()
          .some((row) => row.tags.includes(tag)),
      ),
    )
  })

  const synthesizeOnce = Effect.fn("PersonalAgent.synthesizeOnce")(function* (input: SynthesizeOnceInput) {
    // DB-level idempotency. The old path scanned note.tags and then inserted
    // the note in the same process. A second OpenAGt process could race that
    // scan. Claiming the tag through a primary-key table makes the database
    // the source of truth.
    if (!privacySafeContent(input.content)) return yield* Effect.fail(new Error("Memory content failed privacy filter"))
    const scope: MemoryScopeType =
      input.kind === "manual_preference" ? "profile" : input.projectID ? "workspace" : "profile"
    const source =
      input.kind === "manual_preference"
        ? "manual"
        : input.kind === "follow_up_completed"
          ? "scheduler"
          : input.kind === "coordinator_run_completed"
            ? "coordinator"
            : input.kind === "expert_output"
              ? "expert"
              : input.kind === "reviser_pattern"
                ? "reviser"
                : input.kind === "reducer_summary"
                  ? "reducer"
                  : "verifier"
    const id = MemoryNoteID.ascending()
    const timestamp = now()
    const inserted = yield* Effect.sync(() =>
      Database.transaction(
        (db) => {
          const claimed = db
            .insert(PersonalMemoryIdempotencyTable)
            .values({
              tag: input.tag,
              note_id: id,
              time_created: timestamp,
            })
            .onConflictDoNothing()
            .run()
          if (!changed(claimed)) return false
          db.insert(PersonalMemoryNoteTable)
            .values({
              id,
              scope,
              kind: "belief",
              project_id: input.projectID,
              session_id: input.sessionID,
              title: input.title,
              content: input.content,
              tags: [...new Set([input.tag, ...(input.tags ?? [])])],
              metadata: input.metadata ?? {},
              source,
              importance: input.importance ?? (input.kind === "verify_completed" ? 7 : 6),
              pinned: 0,
              time_created: timestamp,
              time_updated: timestamp,
            })
            .run()
          return true
        },
        { behavior: "immediate" },
      ),
    )
    if (!inserted) return
    const note = yield* Effect.sync(() =>
      Database.use((db) => db.select().from(PersonalMemoryNoteTable).where(eq(PersonalMemoryNoteTable.id, id)).get()),
    ).pipe(Effect.map((row) => memoryFromRow(row!)))
    yield* bus.publish(MemoryUpdated, note)
  })

  return { remember, listMemory, searchMemory, synthesize, synthesizeOnce, hasMemoryTag } as {
    remember: (input: RememberInput) => Effect.Effect<MemoryNoteType, Error>
    listMemory: (input?: ListMemoryInput) => Effect.Effect<MemoryNoteType[], Error>
    searchMemory: (input: SearchMemoryInput) => Effect.Effect<MemorySearchResultType[], Error>
    synthesize: (input: SynthesizeInput) => Effect.Effect<MemoryNoteType, Error>
    synthesizeOnce: (input: SynthesizeOnceInput) => Effect.Effect<void, Error>
    hasMemoryTag: (tag: string) => Effect.Effect<boolean, Error>
  }
}
