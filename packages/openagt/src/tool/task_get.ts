import z from "zod"
import { Effect, Option } from "effect"
import * as Tool from "./tool"
import { TaskRuntime } from "@/session/task-runtime"
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

export const TaskGetTool = Tool.define<typeof parameters, TaskGetMetadata, TaskRuntime.Service>(
  "task_get",
  Effect.gen(function* () {
    const tasks = yield* TaskRuntime.Service

    return {
      description: "Get structured status and summary for a previously created task.",
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx): Effect.Effect<Tool.ExecuteResult<TaskGetMetadata>, never, never> =>
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

          return {
            title: "Task Status",
            output: `${record.value.task_id} ${record.value.status}\n${record.value.result_summary ?? record.value.error_summary ?? ""}`.trim(),
            metadata: {
              found: true as const,
              task: Tool.toMetadata(record.value),
            } satisfies TaskGetMetadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
