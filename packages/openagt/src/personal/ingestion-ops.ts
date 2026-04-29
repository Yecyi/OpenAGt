import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import { Effect } from "effect"
import {
  type InboxItem as InboxItemType,
  type MemoryScope as MemoryScopeType,
  type WorkPriority as WorkPriorityType,
} from "./schema"
import type { CreateInboxItemInput } from "./inbox-ops"

export interface IngestSessionInput {
  projectID: ProjectID
  sessionID: SessionID
  goal: string
  contextRefs?: string[]
  priority?: WorkPriorityType
}

export interface IngestWebhookInput {
  projectID: ProjectID
  goal: string
  scope?: MemoryScopeType
  contextRefs?: string[]
  priority?: WorkPriorityType
  payload?: Record<string, unknown>
}

export function createIngestionOps(deps: {
  createInboxItem: (input: CreateInboxItemInput) => Effect.Effect<InboxItemType, Error>
}) {
  const { createInboxItem } = deps

  const ingestSession = Effect.fn("PersonalAgent.ingestSession")(function* (input: IngestSessionInput) {
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

  const ingestWebhook = Effect.fn("PersonalAgent.ingestWebhook")(function* (input: IngestWebhookInput) {
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

  return { ingestSession, ingestWebhook } as {
    ingestSession: (input: IngestSessionInput) => Effect.Effect<InboxItemType, Error>
    ingestWebhook: (input: IngestWebhookInput) => Effect.Effect<InboxItemType, Error>
  }
}
