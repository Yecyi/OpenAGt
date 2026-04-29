import { ProjectID } from "@/project/schema"
import { Database, eq } from "@/storage"
import { Effect } from "effect"
import { ScheduledWakeupTable } from "./personal.sql"
import {
  type InboxItem as InboxItemType,
  type InboxState as InboxStateType,
  type MemoryNote as MemoryNoteType,
} from "./schema"
import type { ListInboxItemsInput } from "./inbox-ops"
import type { ListMemoryInput } from "./memory-ops"

function now() {
  return Date.now()
}

export interface OverviewInput {
  projectID: ProjectID
  now?: number
}

export interface OverviewResult {
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
}

export function createOverviewOps(deps: {
  listInboxItems: (input: ListInboxItemsInput) => Effect.Effect<InboxItemType[], Error>
  listMemory: (input?: ListMemoryInput) => Effect.Effect<MemoryNoteType[], Error>
}) {
  const { listInboxItems, listMemory } = deps

  const overview = Effect.fn("PersonalAgent.overview")(function* (input: OverviewInput) {
    const inbox = yield* listInboxItems({ projectID: input.projectID })
    const memory = yield* listMemory({ projectID: input.projectID })
    const wakeups = yield* Effect.sync(() =>
      Database.use((db) =>
        db.select().from(ScheduledWakeupTable).where(eq(ScheduledWakeupTable.project_id, input.projectID)).all(),
      ),
    )
    return {
      inbox: {
        queued: inbox.filter((item) => item.state === "queued").length,
        active: inbox.filter((item) => item.state === "active").length,
        blocked: inbox.filter((item) => item.state === "blocked").length,
        done: inbox.filter((item) => item.state === "done").length,
        failed: inbox.filter((item) => item.state === "failed").length,
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

  return { overview } as {
    overview: (input: OverviewInput) => Effect.Effect<OverviewResult, Error>
  }
}
