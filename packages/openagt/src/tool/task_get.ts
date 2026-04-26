import z from "zod"
import { Effect, Option } from "effect"
import * as Tool from "./tool"
import { TaskRuntime, type TaskRecord } from "@/session/task-runtime"
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
    }

function storedResult(record: TaskRecord) {
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

          const result = storedResult(record.value)

          return {
            title: "Task Status",
            output: [
              `task_id: ${record.value.task_id}`,
              `status: ${record.value.status}`,
              `kind: ${record.value.task_kind}`,
              `description: ${record.value.description}`,
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
            } satisfies TaskGetMetadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
