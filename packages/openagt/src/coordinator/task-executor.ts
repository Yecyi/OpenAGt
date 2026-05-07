// Owns coordinator task prompt execution and task result recording.
// It does not select ready tasks, create coordinator runs, or summarize runs.
import * as Bus from "@/bus"
import { Event as BehaviorEvent } from "@/bus/behavior-events"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { TaskRuntime } from "@/session/task-runtime"
import { Cause, Effect, Option } from "effect"
import { Log } from "@/util"
import { CoordinatorEvents } from "./events"
import { failureSignature } from "./failure-signature"
import {
  isMpacrCriticTask,
  isMpacrReviewTask,
  mpacrQuorumEscalation,
  mpacrVerdictMetadata,
  reviewFailureMessage,
  reviewVerdictForMessage,
  skippedReviewVerdict,
} from "./review-verdict"
import { buildTaskPrompt, messageText } from "./task-prompt"
import { mpacrCriticTimeoutMs, taskModel, taskVariant } from "./task-record"
import { aggregateVerifierSignals, collectVerifierSignals } from "./verifier-aggregator"
import type {
  CoordinatorRun as CoordinatorRunType,
  CoordinatorRunID as CoordinatorRunIDType,
  CriticalReviewVerdict as CriticalReviewVerdictType,
} from "./schema"

interface CoordinatorTaskExecutorInput {
  readonly tasks: TaskRuntime.Interface
  readonly getPrompt: () => Effect.Effect<Option.Option<SessionPrompt.Interface>>
  readonly get: (id: CoordinatorRunIDType) => Effect.Effect<Option.Option<CoordinatorRunType>, Error>
  readonly persistRuntimeState: (run: CoordinatorRunType) => Effect.Effect<CoordinatorRunType, Error>
  readonly dispatchReady: (
    id: CoordinatorRunIDType,
  ) => Effect.Effect<{ run: CoordinatorRunType; dispatched: number }, Error>
  readonly recordPromptOutcome: (record: TaskRuntime.TaskRecord, success: boolean) => Effect.Effect<void, Error>
  readonly recordCalibrationOutcome: (
    record: TaskRuntime.TaskRecord,
    verdict: CriticalReviewVerdictType | undefined,
  ) => Effect.Effect<void, Error>
}

const log = Log.create({ service: "coordinator.task-executor" })

function metadataString(record: TaskRuntime.TaskRecord, key: string) {
  const value = record.metadata?.[key]
  return typeof value === "string" ? value : undefined
}

function emitTaskEvent(
  record: TaskRuntime.TaskRecord,
  event_kind: "task_dispatched" | "task_finished" | "review_verdict" | "revise_triggered",
  payload: Record<string, unknown>,
) {
  return CoordinatorEvents.emit({
    session_id: String(record.parent_session_id),
    run_id: record.group_id,
    task_id: String(record.task_id),
    expert_id: metadataString(record, "expert_id") ?? record.subagent_type,
    workflow: metadataString(record, "workflow"),
    effort: metadataString(record, "effort"),
    event_kind,
    payload: {
      node_id: metadataString(record, "coordinator_node_id"),
      role: metadataString(record, "role"),
      task_kind: record.task_kind,
      subagent_type: record.subagent_type,
      ...payload,
    },
  }).pipe(Effect.ignore)
}

function isVerificationTask(record: TaskRuntime.TaskRecord) {
  return record.task_kind === "verify" && record.metadata?.output_schema === "verification"
}

export class CoordinatorTaskExecutor {
  constructor(private readonly input: CoordinatorTaskExecutorInput) {}

  execute(record: TaskRuntime.TaskRecord): Effect.Effect<void, Error> {
    const input = this.input
    return Effect.gen(function* () {
      const prompt = yield* input.getPrompt()
      const continueGroup = () =>
        record.group_id
          ? Effect.gen(function* () {
              const runOpt = yield* input.get(record.group_id as CoordinatorRunIDType)
              if (Option.isSome(runOpt)) yield* input.persistRuntimeState(runOpt.value).pipe(Effect.ignore)
              yield* input.dispatchReady(record.group_id as CoordinatorRunIDType).pipe(Effect.ignore)
            })
          : Effect.void
      const completeMpacrCriticAsSkipped = (item: TaskRuntime.TaskRecord, reason: string): Effect.Effect<void, Error> =>
        Effect.gen(function* () {
          const completed = yield* input.tasks.complete({
            taskID: item.task_id,
            parentSessionID: item.parent_session_id,
            output: JSON.stringify(skippedReviewVerdict(reason)),
            metadata: {
              mpacr_skipped: true,
              mpacr_skip_reason: reason,
            },
          })
          yield* emitTaskEvent(completed, "task_finished", {
            status: completed.status,
            reason,
            mpacr_skipped: true,
          })
          yield* input.recordPromptOutcome(completed, false)
          yield* settleDependentMpacrSynthesis(completed)
        })
      const partialMpacrQuorumTask = (
        item: TaskRuntime.TaskRecord,
        quorumEscalation: NonNullable<ReturnType<typeof mpacrQuorumEscalation>>,
      ) =>
        Effect.gen(function* () {
          const partial = yield* input.tasks.partial({
            taskID: item.task_id,
            parentSessionID: item.parent_session_id,
            output: JSON.stringify(quorumEscalation.verdict),
            reason: reviewFailureMessage(quorumEscalation.verdict) ?? "MPACR quorum unmet",
            retryable: true,
            remainingScope: quorumEscalation.missing,
            metadata: mpacrVerdictMetadata(quorumEscalation.verdict, {
              mpacr_quorum_pending: true,
              mpacr_quorum_required: quorumEscalation.quorum,
              mpacr_quorum_substantive_count: quorumEscalation.substantive,
              mpacr_missing_critic_node_ids: quorumEscalation.missing,
            }),
          })
          yield* emitTaskEvent(partial, "review_verdict", {
            verdict: quorumEscalation.verdict.verdict,
            confidence: quorumEscalation.verdict.confidence,
            failure_signature: failureSignature({
              verdict: quorumEscalation.verdict.verdict,
              unsupportedClaims: quorumEscalation.verdict.unsupported_claims,
              missingEvidence: quorumEscalation.verdict.missing_evidence,
              contradictions: quorumEscalation.verdict.contradictions,
              requiredChanges: quorumEscalation.verdict.required_changes,
            }),
            missing_evidence: quorumEscalation.verdict.missing_evidence,
            required_changes: quorumEscalation.verdict.required_changes,
            mpacr_quorum_pending: true,
          })
          yield* emitTaskEvent(partial, "task_finished", {
            status: partial.status,
            retryable: true,
            reason: reviewFailureMessage(quorumEscalation.verdict) ?? "MPACR quorum unmet",
          })
          yield* input.recordCalibrationOutcome(partial, quorumEscalation.verdict)
          yield* input.recordPromptOutcome(partial, false)
        })
      const settleDependentMpacrSynthesis = (critic: TaskRuntime.TaskRecord): Effect.Effect<void, Error> =>
        Effect.gen(function* () {
          if (!isMpacrCriticTask(critic.metadata)) return
          const all = yield* input.tasks.list(critic.parent_session_id)
          const pendingSynthesis = all.filter(
            (item) =>
              item.status === "pending" &&
              item.depends_on.includes(critic.task_id) &&
              item.metadata?.output_schema === "revise" &&
              item.metadata?.mpacr_role === "synthesis",
          )
          yield* Effect.forEach(
            pendingSynthesis,
            (item) =>
              Effect.gen(function* () {
                const dependencies = all.filter((candidate) => item.depends_on.includes(candidate.task_id))
                if (
                  !item.depends_on.every((taskID) =>
                    dependencies.some((candidate) => candidate.task_id === taskID && candidate.status === "completed"),
                  )
                ) {
                  return
                }
                const quorumEscalation = mpacrQuorumEscalation(item, dependencies)
                if (!quorumEscalation) return
                yield* partialMpacrQuorumTask(item, quorumEscalation)
              }),
            { concurrency: 4 },
          )
        })
      const started = yield* input.tasks.tryStartPending(record.task_id, record.parent_session_id)
      if (!started) return
      // Wave 6: emit behavior.subagent.dispatched once the task transitions
      // from pending to running. isolation_level reads from record.metadata
      // when the planner attached it (CoordinatorNode.personal_memory_access);
      // defaults to "full" for the legacy dispatch path that doesn't carry
      // the flag through metadata yet.
      const isolationLevel =
        (started.metadata?.personal_memory_access as "full" | "facts_only" | "blind" | undefined) ?? "full"
      yield* Effect.promise(() =>
        Bus.publish(BehaviorEvent.SubagentDispatched, {
          parent_session_id: String(started.parent_session_id),
          child_session_id: String(started.child_session_id),
          node_id: String(started.task_id),
          agent: started.subagent_type,
          role: typeof started.metadata?.role === "string" ? started.metadata.role : undefined,
          isolation_level: isolationLevel,
          goal_hash: started.prompt_hash,
          started_at: started.started_at ?? Date.now(),
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            log.warn("behavior event publish failed", {
              event: "subagent.dispatched",
              node_id: String(started.task_id),
              cause: Cause.pretty(cause),
            }),
          ),
        ),
      )
      yield* emitTaskEvent(started, "task_dispatched", {
        status: started.status,
        depends_on: started.depends_on,
      })
      const dependencies = (yield* input.tasks.list(started.parent_session_id)).filter((item) =>
        started.depends_on.includes(item.task_id),
      )
      const quorumEscalation = mpacrQuorumEscalation(started, dependencies)
      if (quorumEscalation) {
        yield* partialMpacrQuorumTask(started, quorumEscalation)
        yield* continueGroup()
        return
      }
      if (Option.isNone(prompt)) {
        if (isMpacrCriticTask(started.metadata)) {
          yield* completeMpacrCriticAsSkipped(
            started,
            "Coordinator executor unavailable: SessionPrompt.Service is not available",
          )
          yield* continueGroup()
          return
        }
        const failed = yield* input.tasks.fail({
          taskID: started.task_id,
          parentSessionID: started.parent_session_id,
          error: "Coordinator executor unavailable: SessionPrompt.Service is not available",
        })
        yield* emitTaskEvent(failed, "task_finished", {
          status: failed.status,
          reason: "Coordinator executor unavailable: SessionPrompt.Service is not available",
        })
        yield* input.recordPromptOutcome(failed, false)
        yield* continueGroup()
        return
      }
      const promptService = prompt.value
      const basePrompt = buildTaskPrompt(started, dependencies)
      const promptOnce = (text: string) => {
        const effect = promptService.prompt({
          sessionID: started.child_session_id,
          agent: started.subagent_type,
          model: taskModel(started.metadata ?? {}),
          variant: taskVariant(started.metadata ?? {}),
          parts: [
            {
              type: "text",
              text,
            },
          ],
        })
        if (!isMpacrCriticTask(started.metadata)) return effect
        const timeoutMs = mpacrCriticTimeoutMs(started.metadata)
        return effect.pipe(
          Effect.timeout(`${timeoutMs} millis`),
          Effect.catchTag("TimeoutError", () =>
            Effect.fail(new Error(`MPACR critic timed out after ${timeoutMs}ms`)),
          ),
        )
      }
      yield* promptOnce(basePrompt).pipe(
        Effect.tap((message: MessageV2.WithParts) =>
          Effect.gen(function* () {
            const firstReview = reviewVerdictForMessage(started.metadata, messageText(message), basePrompt, 0)
            const final = yield* firstReview.retryPrompt
              ? promptOnce(firstReview.retryPrompt).pipe(
                  Effect.map((retryMessage) => ({
                    message: retryMessage,
                    verdict: reviewVerdictForMessage(started.metadata, messageText(retryMessage), basePrompt, 1).verdict,
                  })),
                )
              : Effect.succeed({ message, verdict: firstReview.verdict })
            const reviewFailure = isMpacrCriticTask(started.metadata) ? undefined : reviewFailureMessage(final.verdict)
            if (firstReview.retryPrompt) {
              yield* emitTaskEvent(started, "revise_triggered", {
                round_index: 1,
                reason: "review schema or evidence repair requested",
              })
            }
            if (final.verdict) {
              yield* emitTaskEvent(started, "review_verdict", {
                verdict: final.verdict.verdict,
                confidence: final.verdict.confidence,
                failure_signature: failureSignature({
                  verdict: final.verdict.verdict,
                  text: messageText(final.message),
                  unsupportedClaims: final.verdict.unsupported_claims,
                  missingEvidence: final.verdict.missing_evidence,
                  contradictions: final.verdict.contradictions,
                  requiredChanges: final.verdict.required_changes,
                }),
                unsupported_claims: final.verdict.unsupported_claims,
                missing_evidence: final.verdict.missing_evidence,
                contradictions: final.verdict.contradictions,
                required_changes: final.verdict.required_changes,
                posterior: final.verdict.posterior,
              })
            }
            const verifierSignals = isVerificationTask(started)
              ? yield* collectVerifierSignals({ childSessionID: started.child_session_id })
              : []
            const verifierAggregate = verifierSignals.length > 0 ? aggregateVerifierSignals(verifierSignals) : undefined
            if (verifierAggregate) {
              yield* emitTaskEvent(started, "review_verdict", {
                verdict: verifierAggregate.verdict,
                confidence: verifierAggregate.confidence,
                failure_signature: failureSignature({
                  verdict: verifierAggregate.verdict,
                  text: verifierAggregate.evidence.join("\n"),
                  requiredChanges: verifierAggregate.hard_fail_sources.map(
                    (source) => `${source} reported a hard verifier failure`,
                  ),
                }),
                hard_fail_sources: verifierAggregate.hard_fail_sources,
                warning_sources: verifierAggregate.warning_sources,
                unavailable_sources: verifierAggregate.unavailable_sources,
              })
            }
            yield* input.recordCalibrationOutcome(started, final.verdict)
            if (verifierAggregate?.verdict === "revise_required") {
              const reason = [
                "Verifier aggregate requires revision",
                verifierAggregate.hard_fail_sources.length
                  ? `hard failures: ${verifierAggregate.hard_fail_sources.join(", ")}`
                  : undefined,
                verifierAggregate.evidence.at(0),
              ]
                .filter((item): item is string => Boolean(item))
                .join(". ")
              const failed = yield* input.tasks.fail({
                taskID: started.task_id,
                parentSessionID: started.parent_session_id,
                error: reason,
                metadata: {
                  verifier_signals: verifierSignals,
                  verifier_aggregate: verifierAggregate,
                },
              })
              yield* emitTaskEvent(failed, "task_finished", {
                status: failed.status,
                reason,
                verifier_aggregate: verifierAggregate,
              })
              yield* input.recordPromptOutcome(failed, false)
              return
            }
            if (reviewFailure) {
              const failed = yield* input.tasks.fail({
                taskID: started.task_id,
                parentSessionID: started.parent_session_id,
                error: reviewFailure,
                metadata:
                  final.verdict && isMpacrReviewTask(started.metadata) ? mpacrVerdictMetadata(final.verdict) : undefined,
              })
              yield* emitTaskEvent(failed, "task_finished", {
                status: failed.status,
                reason: reviewFailure,
              })
              yield* input.recordPromptOutcome(failed, false)
              return
            }
            if (isMpacrCriticTask(started.metadata) && final.verdict?.verdict === "skipped") {
              const completed = yield* input.tasks.complete({
                taskID: started.task_id,
                parentSessionID: started.parent_session_id,
                output: JSON.stringify(final.verdict),
                metadata: {
                  mpacr_skipped: true,
                  mpacr_skip_reason: final.verdict.unsupported_claims.join("; ") || "MPACR critic skipped",
                },
              })
              yield* emitTaskEvent(completed, "task_finished", {
                status: completed.status,
                mpacr_skipped: true,
              })
              yield* input.recordPromptOutcome(completed, false)
              yield* settleDependentMpacrSynthesis(completed)
              return
            }
            const completed = yield* input.tasks.complete(
              final.verdict && isMpacrReviewTask(started.metadata)
                ? {
                    taskID: started.task_id,
                    parentSessionID: started.parent_session_id,
                    output: JSON.stringify(final.verdict),
                    metadata: mpacrVerdictMetadata(final.verdict),
                  }
                : {
                    taskID: started.task_id,
                    parentSessionID: started.parent_session_id,
                    result: final.message,
                    metadata: verifierAggregate
                      ? {
                          verifier_signals: verifierSignals,
                          verifier_aggregate: verifierAggregate,
                        }
                      : undefined,
                  },
            )
            yield* emitTaskEvent(completed, "task_finished", {
              status: completed.status,
              success: true,
            })
            yield* input.recordPromptOutcome(completed, true)
            yield* settleDependentMpacrSynthesis(completed)
          }),
        ),
        Effect.catchCause((cause) => {
          const error = Cause.squash(cause)
          return Effect.gen(function* () {
            const reason = error instanceof Error ? error.message : String(error)
            if (isMpacrCriticTask(started.metadata)) {
              yield* completeMpacrCriticAsSkipped(started, reason)
              return
            }
            const failed = yield* input.tasks.fail({
              taskID: started.task_id,
              parentSessionID: started.parent_session_id,
              error: reason,
            })
            yield* emitTaskEvent(failed, "task_finished", {
              status: failed.status,
              reason,
            })
            yield* input.recordPromptOutcome(failed, false)
          })
        }),
        Effect.tap(continueGroup),
      )
      return
    })
  }
}
