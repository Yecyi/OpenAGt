import { Bus } from "@/bus"
import { Coordinator } from "@/coordinator/coordinator"
import { InstanceState } from "@/effect"
import { attachWith } from "@/effect/run-service"
import { ProjectID } from "@/project/schema"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { TaskRuntime } from "@/session/task-runtime"
import { Context, Effect, Layer } from "effect"
import { createInboxOps } from "./inbox-ops"
import { createIngestionOps } from "./ingestion-ops"
import { createMemoryOps, type SynthesizeKind } from "./memory-ops"
import { createOverviewOps, type OverviewInput, type OverviewResult } from "./overview-ops"
import { createWakeupOps } from "./wakeup-ops"
import {
  InboxCreated,
  InboxUpdated,
  MemoryUpdated,
  SchedulerCompleted,
  SchedulerFired,
  SchedulerScheduled,
} from "./events"
import type {
  CreateInboxItemInput,
  ListInboxItemsInput,
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
import type z from "zod"

export const Event = {
  MemoryUpdated,
  InboxCreated,
  InboxUpdated,
  SchedulerScheduled,
  SchedulerFired,
  SchedulerCompleted,
}

function memoryTags(input: {
  tags?: string[]
  workflow?: string
  expertID?: string
  role?: string
  artifactType?: string
  sourceTaskID?: string
}) {
  return [
    ...(input.tags ?? []),
    input.workflow ? `workflow:${input.workflow}` : undefined,
    input.expertID ? `expert:${input.expertID}` : undefined,
    input.role ? `role:${input.role}` : undefined,
    input.artifactType ? `artifact:${input.artifactType}` : undefined,
    input.sourceTaskID ? `source_task:${input.sourceTaskID}` : undefined,
  ].filter((item): item is string => Boolean(item))
}

export interface Interface {
  readonly remember: (input: RememberInput) => Effect.Effect<MemoryNoteType, Error>
  readonly listMemory: (input?: ListMemoryInput) => Effect.Effect<MemoryNoteType[], Error>
  readonly searchMemory: (input: SearchMemoryInput) => Effect.Effect<MemorySearchResultType[], Error>
  readonly synthesize: (input: SynthesizeInput) => Effect.Effect<MemoryNoteType, Error>
  readonly createInboxItem: (input: CreateInboxItemInput) => Effect.Effect<InboxItemType, Error>
  readonly listInboxItems: (input: ListInboxItemsInput) => Effect.Effect<InboxItemType[], Error>
  readonly updateInboxState: (input: UpdateInboxStateInput) => Effect.Effect<InboxItemType, Error>
  readonly scheduleWakeup: (input: ScheduleWakeupInput) => Effect.Effect<ScheduledWakeupType, Error>
  readonly listDueWakeups: (input: ListDueWakeupsInput) => Effect.Effect<ScheduledWakeupType[], Error>
  readonly dispatchDueWakeups: (input: DispatchDueWakeupsInput) => Effect.Effect<InboxItemType[], Error>
  readonly completeWakeup: (id: z.infer<typeof ScheduledWakeupID.zod>) => Effect.Effect<ScheduledWakeupType, Error>
  readonly ingestSession: (input: IngestSessionInput) => Effect.Effect<InboxItemType, Error>
  readonly ingestWebhook: (input: IngestWebhookInput) => Effect.Effect<InboxItemType, Error>
  readonly overview: (input: OverviewInput) => Effect.Effect<OverviewResult, Error>
}

export class Service extends Context.Service<Service, Interface>()("@openagt/PersonalAgent") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const sessions = yield* Session.Service

    const memory = createMemoryOps(bus)
    const inbox = createInboxOps(bus)
    const wakeup = createWakeupOps({ bus, createInboxItem: inbox.createInboxItem })
    const ingestion = createIngestionOps({ createInboxItem: inbox.createInboxItem })
    const overviewOps = createOverviewOps({
      listInboxItems: inbox.listInboxItems,
      listMemory: memory.listMemory,
    })

    const subscriptionStops = new Map<string, () => void>()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const stop of subscriptionStops.values()) stop()
        subscriptionStops.clear()
      }),
    )

    const ensureSubscribed = Effect.fn("PersonalAgent.ensureSubscribed")(function* () {
      const instance = yield* InstanceState.context
      if (subscriptionStops.has(instance.directory)) return
      const workspace = yield* InstanceState.workspaceID
      const stopCoordinatorCompleted = yield* bus.subscribeCallback(Coordinator.Event.Completed, (event) => {
        void Effect.runPromise(
          attachWith(
            Effect.gen(function* () {
              const parent = yield* sessions.get(SessionID.make(event.properties.sessionID))
              yield* memory.synthesizeOnce({
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
        if (event.properties.result.status !== "completed") return
        void Effect.runPromise(
          attachWith(
            Effect.gen(function* () {
              const parent = yield* sessions.get(event.properties.parent_session_id)
              const metadata = event.properties.result.metadata ?? {}
              const workflow = typeof metadata.workflow === "string" ? metadata.workflow : undefined
              const expertID = typeof metadata.expert_id === "string" ? metadata.expert_id : undefined
              const role =
                typeof metadata.expert_role === "string"
                  ? metadata.expert_role
                  : typeof metadata.role === "string"
                    ? metadata.role
                    : undefined
              const artifactType = typeof metadata.artifact_type === "string" ? metadata.artifact_type : undefined
              const tags = memoryTags({
                workflow,
                expertID,
                role,
                artifactType,
                sourceTaskID: event.properties.result.task_id,
                tags: event.properties.result.task_kind === "verify" ? ["verified"] : undefined,
              })
              if (event.properties.result.task_kind === "verify") {
                yield* memory.synthesizeOnce({
                  tag: `verify_task:${event.properties.result.task_id}`,
                  kind: "verify_completed",
                  projectID: parent.projectID,
                  sessionID: parent.id,
                  title: `Verified: ${event.properties.result.description}`,
                  content: event.properties.result.summary,
                  tags,
                  metadata,
                  importance: 7,
                })
              }
              if (!expertID) return
              const kind: SynthesizeKind =
                role === "reviser"
                  ? "reviser_pattern"
                  : role === "reducer"
                    ? "reducer_summary"
                    : role === "verifier" || event.properties.result.task_kind === "verify"
                      ? "verifier_rule"
                      : "expert_output"
              yield* memory.synthesizeOnce({
                tag: `expert_task:${event.properties.result.task_id}`,
                kind,
                projectID: parent.projectID,
                sessionID: parent.id,
                title: `Expert memory: ${event.properties.result.description}`,
                content: event.properties.result.summary,
                tags,
                metadata,
                importance: role === "reviser" ? 6 : 7,
              })
            }),
            {
              instance,
              workspace,
            },
          ).pipe(Effect.catch(() => Effect.void)),
        )
      })

      const stopSchedulerCompleted = yield* bus.subscribeCallback(SchedulerCompleted, (event) => {
        void Effect.runPromise(
          attachWith(
            memory.synthesizeOnce({
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
      subscriptionStops.set(instance.directory, () => {
        stopCoordinatorCompleted()
        stopTaskUpdated()
        stopSchedulerCompleted()
        subscriptionStops.delete(instance.directory)
      })
    })

    const wrap =
      <A extends unknown[], R, E>(fn: (...args: A) => Effect.Effect<R, E>) =>
      (...args: A) =>
        Effect.gen(function* () {
          yield* ensureSubscribed()
          return yield* fn(...args)
        })

    return Service.of({
      remember: wrap(memory.remember),
      listMemory: wrap(memory.listMemory),
      searchMemory: wrap(memory.searchMemory),
      synthesize: wrap(memory.synthesize),
      createInboxItem: wrap(inbox.createInboxItem),
      listInboxItems: wrap(inbox.listInboxItems),
      updateInboxState: wrap(inbox.updateInboxState),
      scheduleWakeup: wrap(wakeup.scheduleWakeup),
      listDueWakeups: wrap(wakeup.listDueWakeups),
      dispatchDueWakeups: wrap(wakeup.dispatchDueWakeups),
      completeWakeup: wrap(wakeup.completeWakeup),
      ingestSession: wrap(ingestion.ingestSession),
      ingestWebhook: wrap(ingestion.ingestWebhook),
      overview: wrap(overviewOps.overview),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(Session.defaultLayer))

export * as PersonalAgent from "./personal"
