import { InboxItemTable, PersonalMemoryNoteTable, ScheduledWakeupTable } from "./personal.sql"
import {
  InboxItem,
  InboxState,
  MemoryNote,
  ScheduledWakeup,
  type InboxState as InboxStateType,
} from "./schema"

export function normalizeInboxState(state: string): InboxStateType {
  if (state === "pending") return "queued"
  if (state === "processing") return "active"
  if (state === "completed") return "done"
  return InboxState.parse(state)
}

export function memoryFromRow(row: typeof PersonalMemoryNoteTable.$inferSelect) {
  return MemoryNote.parse({
    id: row.id,
    scope: row.scope,
    projectID: row.project_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    title: row.title,
    content: row.content,
    tags: row.tags,
    metadata: row.metadata ?? {},
    source: row.source,
    importance: row.importance,
    pinned: Boolean(row.pinned),
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  })
}

export function inboxFromRow(row: typeof InboxItemTable.$inferSelect) {
  return InboxItem.parse({
    id: row.id,
    projectID: row.project_id,
    sessionID: row.session_id ?? undefined,
    source: row.source,
    scope: row.scope,
    goal: row.goal,
    context_refs: row.context_refs,
    priority: row.priority,
    state: normalizeInboxState(row.state),
    scheduled_for: row.scheduled_for ?? undefined,
    payload: row.payload ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      completed: row.time_completed ?? undefined,
    },
  })
}

export function wakeupFromRow(row: typeof ScheduledWakeupTable.$inferSelect) {
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
