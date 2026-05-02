// Service tag + Interface for PersonalAgent.
//
// Extracted from personal/personal.ts so consumers can `import { Service }`
// without triggering the personal -> coordinator -> agent -> tool import
// cycle. personal/personal.ts itself imports `Coordinator` (for its
// subscribeCallback inside `ensureSubscribed`), and pulling that into the
// tool-registry load chain through escalate_to_inbox / task_give_up
// produces a TDZ on `Agent.defaultLayer` at coordinator/coordinator.ts:505
// when test files load tool/registry.
//
// This file contains only the Service tag and Interface type. The actual
// Layer construction lives in personal/personal.ts and re-exports Service
// from here for backward compatibility.

import { Context, Effect } from "effect"
import type {
  CreateInboxItemInput,
  ListInboxItemsInput,
  ReplyToInboxItemInput,
  UpdateInboxStateInput,
} from "./inbox-ops"
import type { IngestSessionInput, IngestWebhookInput } from "./ingestion-ops"
import type {
  ListMemoryInput,
  RememberInput,
  SearchMemoryInput,
  SynthesizeInput,
} from "./memory-ops"
import type {
  DispatchDueWakeupsInput,
  ListDueWakeupsInput,
  ScheduleWakeupInput,
} from "./wakeup-ops"
import type {
  InboxItem as InboxItemType,
  MemoryNote as MemoryNoteType,
  MemorySearchResult as MemorySearchResultType,
  ScheduledWakeup as ScheduledWakeupType,
  ScheduledWakeupID,
} from "./schema"
import type { OverviewInput, OverviewResult } from "./overview-ops"
import type z from "zod"

export interface Interface {
  readonly remember: (input: RememberInput) => Effect.Effect<MemoryNoteType, Error>
  readonly listMemory: (input?: ListMemoryInput) => Effect.Effect<MemoryNoteType[], Error>
  readonly searchMemory: (input: SearchMemoryInput) => Effect.Effect<MemorySearchResultType[], Error>
  readonly synthesize: (input: SynthesizeInput) => Effect.Effect<MemoryNoteType, Error>
  readonly createInboxItem: (input: CreateInboxItemInput) => Effect.Effect<InboxItemType, Error>
  readonly listInboxItems: (input: ListInboxItemsInput) => Effect.Effect<InboxItemType[], Error>
  readonly updateInboxState: (input: UpdateInboxStateInput) => Effect.Effect<InboxItemType, Error>
  // Wave 10: atomic reply + resolve. Reply text passes byte-for-byte
  // into payload.user_reply; state -> "done"; time_completed set.
  readonly replyToInboxItem: (input: ReplyToInboxItemInput) => Effect.Effect<InboxItemType, Error>
  readonly scheduleWakeup: (input: ScheduleWakeupInput) => Effect.Effect<ScheduledWakeupType, Error>
  readonly listDueWakeups: (input: ListDueWakeupsInput) => Effect.Effect<ScheduledWakeupType[], Error>
  readonly dispatchDueWakeups: (input: DispatchDueWakeupsInput) => Effect.Effect<InboxItemType[], Error>
  readonly completeWakeup: (id: z.infer<typeof ScheduledWakeupID.zod>) => Effect.Effect<ScheduledWakeupType, Error>
  readonly ingestSession: (input: IngestSessionInput) => Effect.Effect<InboxItemType, Error>
  readonly ingestWebhook: (input: IngestWebhookInput) => Effect.Effect<InboxItemType, Error>
  readonly overview: (input: OverviewInput) => Effect.Effect<OverviewResult, Error>
}

export class Service extends Context.Service<Service, Interface>()("@openagt/PersonalAgent") {}
