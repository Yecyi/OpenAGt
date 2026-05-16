import z from "zod"
import { Bus } from "@/bus"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import { Database, and, asc, eq, lte } from "@/storage"
import { Effect } from "effect"
import { InboxItemTable, ScheduledWakeupTable } from "./personal.sql"
import {
  InboxItemID,
  ScheduledWakeupID,
  type InboxItem as InboxItemType,
  type ScheduledWakeup as ScheduledWakeupType,
  type WorkPriority as WorkPriorityType,
} from "./schema"
import { inboxFromRow, wakeupFromRow } from "./row-mappers"
import { InboxCreated, SchedulerCompleted, SchedulerFired, SchedulerScheduled } from "./events"

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
}) {
  const { bus } = deps

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
          .where(
            and(
              eq(ScheduledWakeupTable.project_id, input.projectID),
              eq(ScheduledWakeupTable.state, "pending"),
              lte(ScheduledWakeupTable.scheduled_for, input.now ?? now()),
            ),
          )
          .orderBy(asc(ScheduledWakeupTable.scheduled_for))
          .all(),
      ),
    )
    return rows.map(wakeupFromRow)
  })

  const dispatchDueWakeups = Effect.fn("PersonalAgent.dispatchDueWakeups")(function* (input: DispatchDueWakeupsInput) {
    const fired = yield* Effect.sync(() =>
      Database.transaction(
        (db) =>
          db
            .select()
            .from(ScheduledWakeupTable)
            .where(
              and(
                eq(ScheduledWakeupTable.project_id, input.projectID),
                eq(ScheduledWakeupTable.state, "pending"),
                lte(ScheduledWakeupTable.scheduled_for, input.now ?? now()),
              ),
            )
            .orderBy(asc(ScheduledWakeupTable.scheduled_for))
            .all()
            .map((row) => {
              const inboxID = InboxItemID.ascending()
              const timestamp = now()
              db.insert(InboxItemTable)
                .values({
                  id: inboxID,
                  project_id: row.project_id,
                  session_id: row.session_id,
                  source: "scheduled",
                  scope: "workspace",
                  goal: row.goal,
                  context_refs: row.context_refs,
                  priority: row.priority,
                  state: "queued",
                  scheduled_for: row.scheduled_for,
                  payload: row.payload,
                  time_created: timestamp,
                  time_updated: timestamp,
                })
                .run()
              db.update(ScheduledWakeupTable)
                .set({
                  state: "fired",
                  inbox_item_id: inboxID,
                  time_fired: timestamp,
                  time_updated: timestamp,
                })
                .where(and(eq(ScheduledWakeupTable.id, row.id), eq(ScheduledWakeupTable.state, "pending")))
                .run()
              return {
                inbox: inboxFromRow(db.select().from(InboxItemTable).where(eq(InboxItemTable.id, inboxID)).get()!),
                wakeup: wakeupFromRow(
                  db.select().from(ScheduledWakeupTable).where(eq(ScheduledWakeupTable.id, row.id)).get()!,
                ),
              }
            }),
        { behavior: "immediate" },
      ),
    )
    yield* Effect.forEach(
      fired,
      (item) =>
        Effect.gen(function* () {
          yield* bus.publish(InboxCreated, item.inbox)
          yield* bus.publish(SchedulerFired, { ...item.wakeup, inbox_item: item.inbox })
        }),
      { concurrency: 4 },
    )
    return fired.map((item) => item.inbox)
  })

  const completeWakeup = Effect.fn("PersonalAgent.completeWakeup")(function* (
    id: z.infer<typeof ScheduledWakeupID.zod>,
  ) {
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
