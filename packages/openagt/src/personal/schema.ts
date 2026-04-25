import { Schema } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import { ZodOverride } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const memoryNoteIdSchema = Schema.String.annotate({ [ZodOverride]: Identifier.schema("memory") }).pipe(
  Schema.brand("MemoryNoteID"),
)

export type MemoryNoteID = typeof memoryNoteIdSchema.Type

export const MemoryNoteID = memoryNoteIdSchema.pipe(
  withStatics((schema: typeof memoryNoteIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("memory", id)),
    zod: Identifier.schema("memory").pipe(z.custom<MemoryNoteID>()),
  })),
)

const inboxItemIdSchema = Schema.String.annotate({ [ZodOverride]: Identifier.schema("inbox") }).pipe(
  Schema.brand("InboxItemID"),
)

export type InboxItemID = typeof inboxItemIdSchema.Type

export const InboxItemID = inboxItemIdSchema.pipe(
  withStatics((schema: typeof inboxItemIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("inbox", id)),
    zod: Identifier.schema("inbox").pipe(z.custom<InboxItemID>()),
  })),
)

const scheduledWakeupIdSchema = Schema.String.annotate({ [ZodOverride]: Identifier.schema("wakeup") }).pipe(
  Schema.brand("ScheduledWakeupID"),
)

export type ScheduledWakeupID = typeof scheduledWakeupIdSchema.Type

export const ScheduledWakeupID = scheduledWakeupIdSchema.pipe(
  withStatics((schema: typeof scheduledWakeupIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("wakeup", id)),
    zod: Identifier.schema("wakeup").pipe(z.custom<ScheduledWakeupID>()),
  })),
)

export const MemoryScope = z.enum(["profile", "workspace", "session"])
export type MemoryScope = z.infer<typeof MemoryScope>

export const MemorySource = z.enum(["manual", "coordinator", "verify", "scheduler", "gateway", "expert", "reviser", "verifier", "reducer"])
export type MemorySource = z.infer<typeof MemorySource>

export const InboxSource = z.enum(["session", "scheduled", "webhook"])
export type InboxSource = z.infer<typeof InboxSource>

export const InboxState = z.enum(["queued", "active", "blocked", "done", "failed", "cancelled"])
export type InboxState = z.infer<typeof InboxState>

export const WakeupState = z.enum(["pending", "fired", "completed", "cancelled"])
export type WakeupState = z.infer<typeof WakeupState>

export const WorkPriority = z.enum(["high", "normal", "low"])
export type WorkPriority = z.infer<typeof WorkPriority>

export const MemoryNote = z.object({
  id: MemoryNoteID.zod,
  scope: MemoryScope,
  projectID: z.string().optional(),
  sessionID: z.string().optional(),
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).default({}),
  source: MemorySource,
  importance: z.number().int().min(0).max(10),
  pinned: z.boolean(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})
export type MemoryNote = z.infer<typeof MemoryNote>

export const MemorySearchResult = MemoryNote.extend({
  score: z.number(),
  match: z.enum(["fts", "session", "recent"]),
})
export type MemorySearchResult = z.infer<typeof MemorySearchResult>

export const InboxItem = z.object({
  id: InboxItemID.zod,
  projectID: z.string(),
  sessionID: z.string().optional(),
  source: InboxSource,
  scope: MemoryScope,
  goal: z.string(),
  context_refs: z.array(z.string()),
  priority: WorkPriority,
  state: InboxState,
  scheduled_for: z.number().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    completed: z.number().optional(),
  }),
})
export type InboxItem = z.infer<typeof InboxItem>

export const ScheduledWakeup = z.object({
  id: ScheduledWakeupID.zod,
  projectID: z.string(),
  sessionID: z.string().optional(),
  goal: z.string(),
  context_refs: z.array(z.string()),
  priority: WorkPriority,
  scheduled_for: z.number(),
  state: WakeupState,
  payload: z.record(z.string(), z.unknown()).optional(),
  inbox_item_id: InboxItemID.zod.optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    fired: z.number().optional(),
    completed: z.number().optional(),
  }),
})
export type ScheduledWakeup = z.infer<typeof ScheduledWakeup>

export * as PersonalSchema from "./schema"
