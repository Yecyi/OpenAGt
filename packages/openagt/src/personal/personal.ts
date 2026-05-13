import { Bus } from "@/bus"
import { Coordinator } from "@/coordinator/coordinator"
import { failureSignature } from "@/coordinator/failure-signature"
import { reviewVerdictFromText } from "@/coordinator/review-verdict"
import { InstanceState } from "@/effect"
import { attachWith } from "@/effect/run-service"
import { ProjectID } from "@/project/schema"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { TaskRuntime } from "@/session/task-runtime"
import { Effect, Layer } from "effect"
import { createInboxOps } from "./inbox-ops"
import { createIngestionOps } from "./ingestion-ops"
import { createMemoryOps, type SynthesizeKind } from "./memory-ops"
import { createOverviewOps } from "./overview-ops"
import { createWakeupOps } from "./wakeup-ops"
import {
  InboxCreated,
  InboxUpdated,
  MemoryUpdated,
  SchedulerCompleted,
  SchedulerFired,
  SchedulerScheduled,
} from "./events"
// Service tag + Interface live in ./service so consumers (e.g. tool/escalate-to-inbox.ts)
// can import them without triggering personal -> coordinator load.
import { Service } from "./service"
import type { Interface } from "./service"
export { Service } from "./service"
export type { Interface } from "./service"
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

function terminalTaskStatus(status: string) {
  return status === "completed" || status === "failed" || status === "partial"
}

function reviewMemoryKind(input: { role?: string; taskKind: string; outputSchema?: string }): SynthesizeKind {
  if (
    input.outputSchema === "revise" ||
    input.role === "reviser" ||
    input.role === "synth-reviser" ||
    input.role === "red-team-critic" ||
    input.role === "reviewer"
  ) {
    return "reviser_pattern"
  }
  if (input.role === "verifier" || input.taskKind === "verify") return "verifier_rule"
  return "expert_output"
}

function reviewPatternContent(input: {
  description: string
  status: string
  verdict: NonNullable<ReturnType<typeof reviewVerdictFromText>>
}) {
  return [
    `Task: ${input.description}`,
    `Status: ${input.status}`,
    `Verdict: ${input.verdict.verdict}`,
    input.verdict.required_changes.length
      ? `Required changes: ${input.verdict.required_changes.join("; ")}`
      : undefined,
    input.verdict.missing_evidence.length
      ? `Missing evidence: ${input.verdict.missing_evidence.join("; ")}`
      : undefined,
    input.verdict.unsupported_claims.length
      ? `Unsupported claims: ${input.verdict.unsupported_claims.join("; ")}`
      : undefined,
    input.verdict.contradictions.length ? `Contradictions: ${input.verdict.contradictions.join("; ")}` : undefined,
    `Confidence: ${input.verdict.confidence}`,
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n")
}

// Interface and Service moved to ./service (re-exported above).

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
        if (!terminalTaskStatus(event.properties.result.status)) return
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
              const outputSchema = typeof metadata.output_schema === "string" ? metadata.output_schema : undefined
              const tags = memoryTags({
                workflow,
                expertID,
                role,
                artifactType,
                sourceTaskID: event.properties.result.task_id,
                tags: event.properties.result.task_kind === "verify" ? ["verified"] : undefined,
              })
              const reviewText =
                typeof metadata.review_text === "string"
                  ? metadata.review_text
                  : typeof metadata.result_text === "string"
                    ? metadata.result_text
                    : event.properties.result.summary
              const verdict = reviewVerdictFromText(reviewText)
              if (
                verdict &&
                (verdict.verdict === "revise" ||
                  verdict.verdict === "retry" ||
                  verdict.verdict === "ask_user" ||
                  verdict.verdict === "stop")
              ) {
                const signature = failureSignature({
                  verdict: verdict.verdict,
                  text: reviewText,
                  unsupportedClaims: verdict.unsupported_claims,
                  missingEvidence: verdict.missing_evidence,
                  contradictions: verdict.contradictions,
                  requiredChanges: verdict.required_changes,
                })
                yield* memory.synthesizeOnce({
                  tag: `review_pattern:${workflow ?? "general"}:${expertID ?? role ?? "unknown"}:${signature}`,
                  kind: reviewMemoryKind({
                    role,
                    taskKind: event.properties.result.task_kind,
                    outputSchema,
                  }),
                  projectID: parent.projectID,
                  sessionID: parent.id,
                  title: `Review pattern: ${event.properties.result.description}`,
                  content: reviewPatternContent({
                    description: event.properties.result.description,
                    status: event.properties.result.status,
                    verdict,
                  }),
                  tags: [...tags, "failure-pattern", `failure_signature:${signature}`, `verdict:${verdict.verdict}`],
                  metadata: {
                    ...metadata,
                    failure_signature: signature,
                    verdict: verdict.verdict,
                    confidence: verdict.confidence,
                    unsupported_claims: verdict.unsupported_claims,
                    missing_evidence: verdict.missing_evidence,
                    contradictions: verdict.contradictions,
                    required_changes: verdict.required_changes,
                  },
                  importance: verdict.confidence === "high" ? 8 : verdict.confidence === "low" ? 5 : 7,
                })
              }
              if (event.properties.result.status !== "completed") return
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
      replyToInboxItem: wrap(inbox.replyToInboxItem),
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
