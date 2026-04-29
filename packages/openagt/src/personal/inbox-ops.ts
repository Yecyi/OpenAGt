import z from "zod"
import { Bus } from "@/bus"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import { Database, desc, eq } from "@/storage"
import { Effect } from "effect"
import { InboxItemTable } from "./personal.sql"
import {
  InboxItemID,
  InboxSource,
  type InboxItem as InboxItemType,
  type InboxState as InboxStateType,
  type MemoryScope as MemoryScopeType,
  type WorkPriority as WorkPriorityType,
} from "./schema"
import { inboxFromRow, normalizeInboxState } from "./row-mappers"
import { InboxCreated, InboxUpdated } from "./events"

function now() {
  return Date.now()
}

export interface CreateInboxItemInput {
  projectID: ProjectID
  sessionID?: SessionID
  source: z.infer<typeof InboxSource>
  scope: MemoryScopeType
  goal: string
  contextRefs?: string[]
  priority?: WorkPriorityType
  scheduledFor?: number
  payload?: Record<string, unknown>
}

export interface ListInboxItemsInput {
  projectID: ProjectID
  state?: InboxStateType
}

export interface UpdateInboxStateInput {
  id: z.infer<typeof InboxItemID.zod>
  state: InboxStateType
}

export function createInboxOps(bus: Bus.Interface) {
  const createInboxItem = Effect.fn("PersonalAgent.createInboxItem")(function* (input: CreateInboxItemInput) {
    const id = InboxItemID.ascending()
    const timestamp = now()
    yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .insert(InboxItemTable)
          .values({
            id,
            project_id: input.projectID,
            session_id: input.sessionID,
            source: input.source,
            scope: input.scope,
            goal: input.goal,
            context_refs: input.contextRefs ?? [],
            priority: input.priority ?? "normal",
            state: "queued",
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
    yield* bus.publish(InboxCreated, item)
    return item
  })

  const listInboxItems = Effect.fn("PersonalAgent.listInboxItems")(function* (input: ListInboxItemsInput) {
    const rows = yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .select()
          .from(InboxItemTable)
          .where(eq(InboxItemTable.project_id, input.projectID))
          .orderBy(desc(InboxItemTable.time_updated))
          .all()
          .filter((row) => !input.state || normalizeInboxState(row.state) === input.state),
      ),
    )
    return rows.map(inboxFromRow)
  })

  const updateInboxState = Effect.fn("PersonalAgent.updateInboxState")(function* (input: UpdateInboxStateInput) {
    const timestamp = now()
    yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .update(InboxItemTable)
          .set({
            state: input.state,
            time_updated: timestamp,
            time_completed: input.state === "done" ? timestamp : null,
          })
          .where(eq(InboxItemTable.id, input.id))
          .run(),
      ),
    )
    const item = yield* Effect.sync(() =>
      Database.use((db) => db.select().from(InboxItemTable).where(eq(InboxItemTable.id, input.id)).get()),
    ).pipe(Effect.map((row) => inboxFromRow(row!)))
    yield* bus.publish(InboxUpdated, item)
    return item
  })

  return { createInboxItem, listInboxItems, updateInboxState } as {
    createInboxItem: (input: CreateInboxItemInput) => Effect.Effect<InboxItemType, Error>
    listInboxItems: (input: ListInboxItemsInput) => Effect.Effect<InboxItemType[], Error>
    updateInboxState: (input: UpdateInboxStateInput) => Effect.Effect<InboxItemType, Error>
  }
}
