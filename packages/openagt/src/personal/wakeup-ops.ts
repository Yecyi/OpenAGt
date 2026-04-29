import z from "zod"
import { Bus } from "@/bus"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import { Database, desc, eq } from "@/storage"
import { Effect } from "effect"
import { ScheduledWakeupTable } from "./personal.sql"
import {
  ScheduledWakeupID,
  type InboxItem as InboxItemType,
  type ScheduledWakeup as ScheduledWakeupType,
  type WorkPriority as WorkPriorityType,
} from "./schema"
import { wakeupFromRow } from "./row-mappers"
import { SchedulerCompleted, SchedulerFired, SchedulerScheduled } from "./events"
import type { CreateInboxItemInput } from "./inbox-ops"

function now() {
  return Date.now()
}

export interface ScheduleWakeupInput {
  projectID: ProjectID
  sessionID?: SessionID
  goal: string
  contextRefs?: string[]
  priority?: WorkPriorityType
  scheduledFor: number
  payload?: Record<string, unknown>
}

export interface ListDueWakeupsInput {
  projectID: ProjectID
  now?: number
}

export interface DispatchDueWakeupsInput {
  projectID: ProjectID
  now?: number
}

export function createWakeupOps(deps: {
  bus: Bus.Interface
  createInboxItem: (input: CreateInboxItemInput) => Effect.Effect<InboxItemType, Error>
}) {
  const { bus, createInboxItem } = deps

  const scheduleWakeup = Effect.fn("PersonalAgent.scheduleWakeup")(function* (input: ScheduleWakeupInput) {
    const id = ScheduledWakeupID.ascending()
    const timestamp = now()
    yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .insert(ScheduledWakeupTable)
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
    yield* bus.publish(SchedulerScheduled, wakeup)
    return wakeup
  })

  const listDueWakeups = Effect.fn("PersonalAgent.listDueWakeups")(function* (input: ListDueWakeupsInput) {
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

  const dispatchDueWakeups = Effect.fn("PersonalAgent.dispatchDueWakeups")(function* (input: DispatchDueWakeupsInput) {
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
              db
                .update(ScheduledWakeupTable)
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
            Database.use((db) =>
              db.select().from(ScheduledWakeupTable).where(eq(ScheduledWakeupTable.id, wakeup.id)).get(),
            ),
          ).pipe(Effect.map((row) => wakeupFromRow(row!)))
          yield* bus.publish(SchedulerFired, { ...fired, inbox_item: inbox })
          return inbox
        }),
      ),
      { concurrency: "unbounded" },
    )
  })

  const completeWakeup = Effect.fn("PersonalAgent.completeWakeup")(function* (id: z.infer<typeof ScheduledWakeupID.zod>) {
    yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .update(ScheduledWakeupTable)
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
    yield* bus.publish(SchedulerCompleted, wakeup)
    return wakeup
  })

  return { scheduleWakeup, listDueWakeups, dispatchDueWakeups, completeWakeup } as {
    scheduleWakeup: (input: ScheduleWakeupInput) => Effect.Effect<ScheduledWakeupType, Error>
    listDueWakeups: (input: ListDueWakeupsInput) => Effect.Effect<ScheduledWakeupType[], Error>
    dispatchDueWakeups: (input: DispatchDueWakeupsInput) => Effect.Effect<InboxItemType[], Error>
    completeWakeup: (id: z.infer<typeof ScheduledWakeupID.zod>) => Effect.Effect<ScheduledWakeupType, Error>
  }
}
