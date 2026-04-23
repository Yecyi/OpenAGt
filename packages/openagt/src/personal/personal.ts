import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Coordinator } from "@/coordinator/coordinator"
import { InstanceState } from "@/effect"
import { attachWith } from "@/effect/run-service"
import { ProjectID } from "@/project/schema"
import { Session } from "@/session"
import { loadMemory } from "@/session/memory"
import { SessionID } from "@/session/schema"
import { TaskRuntime } from "@/session/task-runtime"
import { Database, desc, eq, sql } from "@/storage"
import { Client as DatabaseClient } from "@/storage/db"
import { Context, Effect, Layer } from "effect"
import { InboxItemTable, PersonalMemoryNoteTable, ScheduledWakeupTable } from "./personal.sql"
import {
  InboxItem,
  InboxItemID,
  InboxSource,
  InboxState,
  MemoryNote,
  MemoryNoteID,
  MemoryScope,
  MemorySearchResult,
  MemorySource,
  ScheduledWakeup,
  ScheduledWakeupID,
  type InboxItem as InboxItemType,
  type InboxState as InboxStateType,
  type MemoryNote as MemoryNoteType,
  type MemoryScope as MemoryScopeType,
  type MemorySearchResult as MemorySearchResultType,
  type ScheduledWakeup as ScheduledWakeupType,
  type WorkPriority as WorkPriorityType,
} from "./schema"

const scopeWeight = {
  session: 30,
  workspace: 20,
  profile: 10,
} as const satisfies Record<MemoryScopeType, number>

function now() {
  return Date.now()
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function lexicalScore(text: string, query: string) {
  if (!query.trim()) return 0
  const haystack = text.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .reduce((score, token) => score + (haystack.includes(token) ? 3 : 0), 0)
}

function recencyScore(updatedAt: number) {
  const ageHours = Math.max(0, (Date.now() - updatedAt) / 3_600_000)
  return clamp(10 - ageHours / 24, 0, 10)
}

function escapeFts(query: string) {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" ")
}

function memoryFromRow(row: typeof PersonalMemoryNoteTable.$inferSelect) {
  return MemoryNote.parse({
    id: row.id,
    scope: row.scope,
    projectID: row.project_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    title: row.title,
    content: row.content,
    tags: row.tags,
    source: row.source,
    importance: row.importance,
    pinned: Boolean(row.pinned),
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  })
}

function inboxFromRow(row: typeof InboxItemTable.$inferSelect) {
  return InboxItem.parse({
    id: row.id,
    projectID: row.project_id,
    sessionID: row.session_id ?? undefined,
    source: row.source,
    scope: row.scope,
    goal: row.goal,
    context_refs: row.context_refs,
    priority: row.priority,
    state: row.state,
    scheduled_for: row.scheduled_for ?? undefined,
    payload: row.payload ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      completed: row.time_completed ?? undefined,
    },
  })
}

function wakeupFromRow(row: typeof ScheduledWakeupTable.$inferSelect) {
  return ScheduledWakeup.parse({
    id: row.id,
    projectID: row.project_id,
    sessionID: row.session_id ?? undefined,
    goal: row.goal,
    context_refs: row.context_refs,
    priority: row.priority,
    scheduled_for: row.scheduled_for,
    state: row.state,
    payload: row.payload ?? undefined,
    inbox_item_id: row.inbox_item_id ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      fired: row.time_fired ?? undefined,
      completed: row.time_completed ?? undefined,
    },
  })
}

export const Event = {
  MemoryUpdated: BusEvent.define("memory.updated", MemoryNote),
  InboxCreated: BusEvent.define("inbox.created", InboxItem),
  InboxUpdated: BusEvent.define("inbox.updated", InboxItem),
  SchedulerScheduled: BusEvent.define("scheduler.scheduled", ScheduledWakeup),
  SchedulerFired: BusEvent.define(
    "scheduler.fired",
    ScheduledWakeup.extend({
      inbox_item: InboxItem,
    }),
  ),
  SchedulerCompleted: BusEvent.define("scheduler.completed", ScheduledWakeup),
}

export interface Interface {
  readonly remember: (input: {
    scope: MemoryScopeType
    title: string
    content: string
    projectID?: ProjectID
    sessionID?: SessionID
    tags?: string[]
    source: z.infer<typeof MemorySource>
    importance?: number
    pinned?: boolean
  }) => Effect.Effect<MemoryNoteType, Error>
  readonly listMemory: (input?: {
    scope?: MemoryScopeType
    projectID?: ProjectID
    sessionID?: SessionID
  }) => Effect.Effect<MemoryNoteType[], Error>
  readonly searchMemory: (input: {
    query: string
    projectID?: ProjectID
    sessionID?: SessionID
    scopes?: MemoryScopeType[]
  }) => Effect.Effect<MemorySearchResultType[], Error>
  readonly synthesize: (input: {
    kind: "coordinator_run_completed" | "verify_completed" | "manual_preference" | "follow_up_completed"
    projectID?: ProjectID
    sessionID?: SessionID
    title: string
    content: string
    tags?: string[]
    importance?: number
  }) => Effect.Effect<MemoryNoteType, Error>
  readonly createInboxItem: (input: {
    projectID: ProjectID
    sessionID?: SessionID
    source: z.infer<typeof InboxSource>
    scope: MemoryScopeType
    goal: string
    contextRefs?: string[]
    priority?: WorkPriorityType
    scheduledFor?: number
    payload?: Record<string, unknown>
  }) => Effect.Effect<InboxItemType, Error>
  readonly listInboxItems: (input: { projectID: ProjectID; state?: InboxStateType }) => Effect.Effect<InboxItemType[], Error>
  readonly updateInboxState: (input: { id: z.infer<typeof InboxItemID.zod>; state: InboxStateType }) => Effect.Effect<InboxItemType, Error>
  readonly scheduleWakeup: (input: {
    projectID: ProjectID
    sessionID?: SessionID
    goal: string
    contextRefs?: string[]
    priority?: WorkPriorityType
    scheduledFor: number
    payload?: Record<string, unknown>
  }) => Effect.Effect<ScheduledWakeupType, Error>
  readonly listDueWakeups: (input: { projectID: ProjectID; now?: number }) => Effect.Effect<ScheduledWakeupType[], Error>
  readonly dispatchDueWakeups: (input: { projectID: ProjectID; now?: number }) => Effect.Effect<InboxItemType[], Error>
  readonly completeWakeup: (id: z.infer<typeof ScheduledWakeupID.zod>) => Effect.Effect<ScheduledWakeupType, Error>
  readonly ingestSession: (input: {
    projectID: ProjectID
    sessionID: SessionID
    goal: string
    contextRefs?: string[]
    priority?: WorkPriorityType
  }) => Effect.Effect<InboxItemType, Error>
  readonly ingestWebhook: (input: {
    projectID: ProjectID
    goal: string
    scope?: MemoryScopeType
    contextRefs?: string[]
    priority?: WorkPriorityType
    payload?: Record<string, unknown>
  }) => Effect.Effect<InboxItemType, Error>
  readonly overview: (input: { projectID: ProjectID; now?: number }) => Effect.Effect<{
    inbox: Record<InboxStateType, number>
    wakeups: {
      due: number
      pending: number
      fired: number
    }
    memory: {
      profile: number
      workspace: number
      session: number
      recent: MemoryNoteType[]
    }
  }, Error>
}

export class Service extends Context.Service<Service, Interface>()("@openagt/PersonalAgent") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const sessions = yield* Session.Service

    const remember: Interface["remember"] = Effect.fn("PersonalAgent.remember")(function* (input) {
      const id = MemoryNoteID.ascending()
      const timestamp = now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db.insert(PersonalMemoryNoteTable)
            .values({
              id,
              scope: input.scope,
              project_id: input.projectID,
              session_id: input.sessionID,
              title: input.title,
              content: input.content,
              tags: input.tags ?? [],
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
      yield* bus.publish(Event.MemoryUpdated, note)
      return note
    })

    const listMemory: Interface["listMemory"] = Effect.fn("PersonalAgent.listMemory")(function* (input) {
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
                (!input?.projectID || row.project_id === input.projectID) &&
                (!input?.sessionID || row.session_id === input.sessionID),
            ),
        ),
      )
      return rows.map(memoryFromRow)
    })

    const sessionSearch = (input: {
      query: string
      sessionID?: SessionID
    }) =>
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

    const searchMemory: Interface["searchMemory"] = Effect.fn("PersonalAgent.searchMemory")(function* (input) {
      const scopes = input.scopes && input.scopes.length > 0 ? input.scopes : (["profile", "workspace"] as MemoryScopeType[])
      const ftsQuery = escapeFts(input.query)
      const matches = yield* Effect.sync(() =>
        !ftsQuery
          ? new Map<string, number>()
          : new Map(
              DatabaseClient()
                .all<{ id: string; score: number }>(sql`
                  SELECT note.id AS id, bm25(personal_memory_fts) AS score
                  FROM personal_memory_fts
                  JOIN personal_memory_note AS note ON note.rowid = personal_memory_fts.rowid
                  WHERE personal_memory_fts MATCH ${ftsQuery}
                  ORDER BY score
                  LIMIT 50
                `)
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
                (!input.projectID || row.project_id === input.projectID) &&
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
              (matches.get(note.id) ?? 0),
            match: ftsQuery ? "fts" : "recent",
          })
        })
        .filter((item): item is MemorySearchResultType => Boolean(item))
      const session = yield* sessionSearch({ query: input.query, sessionID: input.sessionID })
      return [...ranked, ...session].toSorted((left, right) => right.score - left.score)
    })

    const synthesize: Interface["synthesize"] = Effect.fn("PersonalAgent.synthesize")(function* (input) {
      const scope: MemoryScopeType = input.kind === "manual_preference" ? "profile" : input.projectID ? "workspace" : "profile"
      const source =
        input.kind === "manual_preference"
          ? "manual"
          : input.kind === "follow_up_completed"
            ? "scheduler"
            : input.kind === "coordinator_run_completed"
              ? "coordinator"
              : "verify"
      return yield* remember({
        scope,
        title: input.title,
        content: input.content,
        projectID: input.projectID,
        sessionID: input.sessionID,
        tags: input.tags ?? [input.kind],
        importance: input.importance ?? (input.kind === "verify_completed" ? 7 : 6),
        source,
      })
    })

    const hasMemoryTag = Effect.fn("PersonalAgent.hasMemoryTag")(function* (tag: string) {
      return yield* Effect.sync(() =>
        Database.use((db) => db.select().from(PersonalMemoryNoteTable).all().some((row) => row.tags.includes(tag))),
      )
    })

    const synthesizeOnce = Effect.fn("PersonalAgent.synthesizeOnce")(function* (input: {
      tag: string
      kind: Parameters<Interface["synthesize"]>[0]["kind"]
      projectID?: ProjectID
      sessionID?: SessionID
      title: string
      content: string
      importance?: number
    }) {
      if (yield* hasMemoryTag(input.tag)) return
      yield* synthesize({
        kind: input.kind,
        projectID: input.projectID,
        sessionID: input.sessionID,
        title: input.title,
        content: input.content,
        importance: input.importance,
        tags: [input.tag],
      })
    })

    const createInboxItem: Interface["createInboxItem"] = Effect.fn("PersonalAgent.createInboxItem")(function* (input) {
      const id = InboxItemID.ascending()
      const timestamp = now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db.insert(InboxItemTable)
            .values({
              id,
              project_id: input.projectID,
              session_id: input.sessionID,
              source: input.source,
              scope: input.scope,
              goal: input.goal,
              context_refs: input.contextRefs ?? [],
              priority: input.priority ?? "normal",
              state: "pending",
              scheduled_for: input.scheduledFor,
              payload: input.payload,
              time_created: timestamp,
              time_updated: timestamp,
            })
            .run(),
        ),
      )
      const item = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(InboxItemTable).where(eq(InboxItemTable.id, id)).get()),
      ).pipe(Effect.map((row) => inboxFromRow(row!)))
      yield* bus.publish(Event.InboxCreated, item)
      return item
    })

    const listInboxItems: Interface["listInboxItems"] = Effect.fn("PersonalAgent.listInboxItems")(function* (input) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(InboxItemTable)
            .where(eq(InboxItemTable.project_id, input.projectID))
            .orderBy(desc(InboxItemTable.time_updated))
            .all()
            .filter((row) => !input.state || row.state === input.state),
        ),
      )
      return rows.map(inboxFromRow)
    })

    const updateInboxState: Interface["updateInboxState"] = Effect.fn("PersonalAgent.updateInboxState")(function* (input) {
      const timestamp = now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db.update(InboxItemTable)
            .set({
              state: input.state,
              time_updated: timestamp,
              time_completed: input.state === "completed" ? timestamp : null,
            })
            .where(eq(InboxItemTable.id, input.id))
            .run(),
        ),
      )
      const item = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(InboxItemTable).where(eq(InboxItemTable.id, input.id)).get()),
      ).pipe(Effect.map((row) => inboxFromRow(row!)))
      yield* bus.publish(Event.InboxUpdated, item)
      return item
    })

    const scheduleWakeup: Interface["scheduleWakeup"] = Effect.fn("PersonalAgent.scheduleWakeup")(function* (input) {
      const id = ScheduledWakeupID.ascending()
      const timestamp = now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db.insert(ScheduledWakeupTable)
            .values({
              id,
              project_id: input.projectID,
              session_id: input.sessionID,
              goal: input.goal,
              context_refs: input.contextRefs ?? [],
              priority: input.priority ?? "normal",
              scheduled_for: input.scheduledFor,
              state: "pending",
              payload: input.payload,
              time_created: timestamp,
              time_updated: timestamp,
            })
            .run(),
        ),
      )
      const wakeup = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(ScheduledWakeupTable).where(eq(ScheduledWakeupTable.id, id)).get()),
      ).pipe(Effect.map((row) => wakeupFromRow(row!)))
      yield* bus.publish(Event.SchedulerScheduled, wakeup)
      return wakeup
    })

    const listDueWakeups: Interface["listDueWakeups"] = Effect.fn("PersonalAgent.listDueWakeups")(function* (input) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(ScheduledWakeupTable)
            .where(eq(ScheduledWakeupTable.project_id, input.projectID))
            .orderBy(desc(ScheduledWakeupTable.scheduled_for))
            .all()
            .filter((row) => row.state === "pending" && row.scheduled_for <= (input.now ?? now())),
        ),
      )
      return rows.map(wakeupFromRow)
    })

    const dispatchDueWakeups: Interface["dispatchDueWakeups"] = Effect.fn("PersonalAgent.dispatchDueWakeups")(function* (input) {
      const due = yield* listDueWakeups(input)
      return yield* Effect.all(
        due.map((wakeup) =>
          Effect.gen(function* () {
            const inbox = yield* createInboxItem({
              projectID: wakeup.projectID as ProjectID,
              sessionID: wakeup.sessionID ? SessionID.make(wakeup.sessionID) : undefined,
              source: "scheduled",
              scope: "workspace",
              goal: wakeup.goal,
              contextRefs: wakeup.context_refs,
              priority: wakeup.priority,
              scheduledFor: wakeup.scheduled_for,
              payload: wakeup.payload,
            })
            yield* Effect.sync(() =>
              Database.use((db) =>
                db.update(ScheduledWakeupTable)
                  .set({
                    state: "fired",
                    inbox_item_id: inbox.id,
                    time_fired: now(),
                    time_updated: now(),
                  })
                  .where(eq(ScheduledWakeupTable.id, wakeup.id))
                  .run(),
              ),
            )
            const fired = yield* Effect.sync(() =>
              Database.use((db) => db.select().from(ScheduledWakeupTable).where(eq(ScheduledWakeupTable.id, wakeup.id)).get()),
            ).pipe(Effect.map((row) => wakeupFromRow(row!)))
            yield* bus.publish(Event.SchedulerFired, { ...fired, inbox_item: inbox })
            return inbox
          }),
        ),
        { concurrency: "unbounded" },
      )
    })

    const completeWakeup: Interface["completeWakeup"] = Effect.fn("PersonalAgent.completeWakeup")(function* (id) {
      yield* Effect.sync(() =>
        Database.use((db) =>
          db.update(ScheduledWakeupTable)
            .set({
              state: "completed",
              time_completed: now(),
              time_updated: now(),
            })
            .where(eq(ScheduledWakeupTable.id, id))
            .run(),
        ),
      )
      const wakeup = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(ScheduledWakeupTable).where(eq(ScheduledWakeupTable.id, id)).get()),
      ).pipe(Effect.map((row) => wakeupFromRow(row!)))
      yield* bus.publish(Event.SchedulerCompleted, wakeup)
      return wakeup
    })

    const ingestSession: Interface["ingestSession"] = Effect.fn("PersonalAgent.ingestSession")(function* (input) {
      return yield* createInboxItem({
        projectID: input.projectID,
        sessionID: input.sessionID,
        source: "session",
        scope: "session",
        goal: input.goal,
        contextRefs: input.contextRefs,
        priority: input.priority,
      })
    })

    const ingestWebhook: Interface["ingestWebhook"] = Effect.fn("PersonalAgent.ingestWebhook")(function* (input) {
      return yield* createInboxItem({
        projectID: input.projectID,
        source: "webhook",
        scope: input.scope ?? "workspace",
        goal: input.goal,
        contextRefs: input.contextRefs,
        priority: input.priority,
        payload: input.payload,
      })
    })

    const overview: Interface["overview"] = Effect.fn("PersonalAgent.overview")(function* (input) {
      const inbox = yield* listInboxItems({ projectID: input.projectID })
      const memory = yield* listMemory({ projectID: input.projectID })
      const wakeups = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(ScheduledWakeupTable).where(eq(ScheduledWakeupTable.project_id, input.projectID)).all(),
        ),
      )
      return {
        inbox: {
          pending: inbox.filter((item) => item.state === "pending").length,
          processing: inbox.filter((item) => item.state === "processing").length,
          completed: inbox.filter((item) => item.state === "completed").length,
          cancelled: inbox.filter((item) => item.state === "cancelled").length,
        },
        wakeups: {
          due: wakeups.filter((item) => item.state === "pending" && item.scheduled_for <= (input.now ?? now())).length,
          pending: wakeups.filter((item) => item.state === "pending").length,
          fired: wakeups.filter((item) => item.state === "fired").length,
        },
        memory: {
          profile: memory.filter((item) => item.scope === "profile").length,
          workspace: memory.filter((item) => item.scope === "workspace").length,
          session: memory.filter((item) => item.scope === "session").length,
          recent: memory.slice(0, 5),
        },
      }
    })

    const subscriptions = yield* InstanceState.make(
      Effect.fn("PersonalAgent.subscriptions")(function* () {
        const instance = yield* InstanceState.context
        const workspace = yield* InstanceState.workspaceID
        const stopCoordinatorCompleted = yield* bus.subscribeCallback(Coordinator.Event.Completed, (event) => {
          void Effect.runPromise(
            attachWith(
              Effect.gen(function* () {
                const parent = yield* sessions.get(SessionID.make(event.properties.sessionID))
                yield* synthesizeOnce({
                  tag: `coordinator_run:${event.properties.id}`,
                  kind: "coordinator_run_completed",
                  projectID: parent.projectID,
                  sessionID: parent.id,
                  title: `Coordinator completed: ${event.properties.goal}`,
                  content: event.properties.summary ?? "Coordinator run completed",
                  importance: 7,
                })
              }),
              {
                instance,
                workspace,
              },
            ).pipe(Effect.catch(() => Effect.void)),
          )
        })

        const stopTaskUpdated = yield* bus.subscribeCallback(TaskRuntime.Event.Updated, (event) => {
          if (event.properties.result.status !== "completed" || event.properties.result.task_kind !== "verify") return
          void Effect.runPromise(
            attachWith(
              Effect.gen(function* () {
                const parent = yield* sessions.get(event.properties.parent_session_id)
                yield* synthesizeOnce({
                  tag: `verify_task:${event.properties.result.task_id}`,
                  kind: "verify_completed",
                  projectID: parent.projectID,
                  sessionID: parent.id,
                  title: `Verified: ${event.properties.result.description}`,
                  content: event.properties.result.summary,
                  importance: 7,
                })
              }),
              {
                instance,
                workspace,
              },
            ).pipe(Effect.catch(() => Effect.void)),
          )
        })

        const stopSchedulerCompleted = yield* bus.subscribeCallback(Event.SchedulerCompleted, (event) => {
          void Effect.runPromise(
            attachWith(
              synthesizeOnce({
                tag: `follow_up:${event.properties.id}`,
                kind: "follow_up_completed",
                projectID: event.properties.projectID as ProjectID,
                sessionID: event.properties.sessionID ? SessionID.make(event.properties.sessionID) : undefined,
                title: `Follow-up completed: ${event.properties.goal}`,
                content: `Completed scheduled follow-up for ${event.properties.goal}`,
                importance: 6,
              }),
              {
                instance,
                workspace,
              },
            ).pipe(Effect.catch(() => Effect.void)),
          )
        })

        yield* Effect.addFinalizer(() => Effect.sync(stopCoordinatorCompleted))
        yield* Effect.addFinalizer(() => Effect.sync(stopTaskUpdated))
        yield* Effect.addFinalizer(() => Effect.sync(stopSchedulerCompleted))
        return true as const
      }),
    )

    const ensureSubscribed = Effect.fn("PersonalAgent.ensureSubscribed")(function* () {
      yield* InstanceState.get(subscriptions)
    })

    return Service.of({
      remember: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* remember(input)
      }),
      listMemory: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* listMemory(input)
      }),
      searchMemory: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* searchMemory(input)
      }),
      synthesize: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* synthesize(input)
      }),
      createInboxItem: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* createInboxItem(input)
      }),
      listInboxItems: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* listInboxItems(input)
      }),
      updateInboxState: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* updateInboxState(input)
      }),
      scheduleWakeup: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* scheduleWakeup(input)
      }),
      listDueWakeups: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* listDueWakeups(input)
      }),
      dispatchDueWakeups: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* dispatchDueWakeups(input)
      }),
      completeWakeup: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* completeWakeup(input)
      }),
      ingestSession: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* ingestSession(input)
      }),
      ingestWebhook: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* ingestWebhook(input)
      }),
      overview: (input) => Effect.gen(function* () {
        yield* ensureSubscribed()
        return yield* overview(input)
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(Session.defaultLayer))

export * as PersonalAgent from "./personal"
