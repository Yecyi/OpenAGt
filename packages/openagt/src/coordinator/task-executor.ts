// Owns coordinator task prompt execution and task result recording.
// It does not select ready tasks, create coordinator runs, or summarize runs.
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { TaskRuntime } from "@/session/task-runtime"
import { Cause, Effect, Option } from "effect"
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
          yield* input.recordPromptOutcome(completed, false)
        })
      const started = yield* input.tasks.tryStartPending(record.task_id, record.parent_session_id)
      if (!started) return
      const dependencies = (yield* input.tasks.list(started.parent_session_id)).filter((item) =>
        started.depends_on.includes(item.task_id),
      )
      const quorumEscalation = mpacrQuorumEscalation(started, dependencies)
      if (quorumEscalation) {
        const partial = yield* input.tasks.partial({
          taskID: started.task_id,
          parentSessionID: started.parent_session_id,
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
        yield* input.recordCalibrationOutcome(partial, quorumEscalation.verdict)
        yield* input.recordPromptOutcome(partial, false)
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
            yield* input.recordCalibrationOutcome(started, final.verdict)
            if (reviewFailure) {
              const failed = yield* input.tasks.fail({
                taskID: started.task_id,
                parentSessionID: started.parent_session_id,
                error: reviewFailure,
                metadata:
                  final.verdict && isMpacrReviewTask(started.metadata) ? mpacrVerdictMetadata(final.verdict) : undefined,
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
              yield* input.recordPromptOutcome(completed, false)
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
                  },
            )
            yield* input.recordPromptOutcome(completed, true)
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
            yield* input.recordPromptOutcome(failed, false)
          })
        }),
        Effect.tap(continueGroup),
      )
      return
    })
  }
}
