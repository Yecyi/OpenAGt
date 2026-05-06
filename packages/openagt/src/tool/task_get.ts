import z from "zod"
import { Effect, Option } from "effect"
import * as Tool from "./tool"
import { TaskRuntime, type TaskRecord } from "@/session/task-runtime"
import type { TaskOutcome } from "@/session/task-outcomes"
import { SessionID } from "@/session/schema"

const parameters = z.object({
  task_id: z.string(),
})

type TaskGetMetadata =
  | {
      found: false
      task?: undefined
    }
  | {
      found: true
      task: Tool.Metadata
      outcome?: Tool.Metadata
    }

function storedResult(record: TaskRecord, outcome?: TaskOutcome) {
  if (outcome?.result_text?.trim()) return outcome.result_text
  if (outcome?.error_text?.trim()) return outcome.error_text
  if (outcome?.summary?.trim()) return outcome.summary
  const resultText =
    typeof record.metadata?.result_text === "string" && record.metadata.result_text.trim()
      ? record.metadata.result_text
      : undefined
  const partialSummary =
    typeof record.metadata?.partial_summary === "string" && record.metadata.partial_summary.trim()
      ? record.metadata.partial_summary
      : undefined
  return resultText ?? partialSummary ?? record.result_summary ?? record.error_summary ?? `Task is ${record.status}.`
}

function outcomeMetadata(outcome: TaskOutcome | undefined) {
  if (!outcome) return undefined
  return Tool.toMetadata({
    id: outcome.id,
    status: outcome.status,
    attempt_no: outcome.attempt_no,
    previous_outcome_id: outcome.previous_outcome_id,
    retryable: outcome.retryable === 1,
    limit_reason: outcome.limit_reason,
    summary: outcome.summary,
    has_result_text: Boolean(outcome.result_text),
    has_error_text: Boolean(outcome.error_text),
    time_recorded: outcome.time_recorded,
  })
}

export const TaskGetTool = Tool.define<typeof parameters, TaskGetMetadata, TaskRuntime.Service>(
  "task_get",
  Effect.gen(function* () {
    const tasks = yield* TaskRuntime.Service

    return {
      description: "Get structured status and summary for a previously created task.",
      parameters,
      execute: (
        params: z.infer<typeof parameters>,
        ctx,
      ): Effect.Effect<Tool.ExecuteResult<TaskGetMetadata>, never, never> =>
        Effect.gen(function* () {
          const record = yield* tasks.get({ taskID: SessionID.make(params.task_id), parentSessionID: ctx.sessionID })
          if (Option.isNone(record)) {
            return {
              title: "Task Missing",
              output: `Task not found: ${params.task_id}`,
              metadata: {
                found: false as const,
              } satisfies TaskGetMetadata,
            }
          }

          const outcome = yield* tasks.latestOutcome({
            taskID: record.value.task_id,
            parentSessionID: record.value.parent_session_id,
          })
          const latestOutcome = Option.isSome(outcome) ? outcome.value : undefined
          const result = storedResult(record.value, latestOutcome)

          return {
            title: "Task Status",
            output: [
              `task_id: ${record.value.task_id}`,
              `status: ${record.value.status}`,
              `kind: ${record.value.task_kind}`,
              `description: ${record.value.description}`,
              ...(latestOutcome
                ? [`outcome_id: ${latestOutcome.id}`, `attempt: ${latestOutcome.attempt_no}`]
                : []),
              "",
              `<task_result status="${record.value.status}">`,
              result,
              "</task_result>",
              ...(record.value.status === "partial"
                ? ["", "Task is partial and retryable; retry only the missing scope if more evidence is required."]
                : []),
            ].join("\n"),
            metadata: {
              found: true as const,
              task: Tool.toMetadata(record.value),
              outcome: outcomeMetadata(latestOutcome),
            } satisfies TaskGetMetadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
