import z from "zod"
import { Effect, Option } from "effect"
import * as Tool from "./tool"
import { SessionID } from "@/session/schema"
import { TaskRuntime } from "@/session/task-runtime"

export const TaskGetTool = Tool.define(
  "task_get",
  Effect.gen(function* () {
    const tasks = yield* TaskRuntime.Service

    return {
      description: "Get structured status and summary for a previously created task.",
      parameters: z.object({
        task_id: SessionID.zod,
      }),
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const record = yield* tasks.get({ taskID: params.task_id, parentSessionID: ctx.sessionID })
          if (Option.isNone(record)) {
            return {
              title: "Task Missing",
              output: `Task not found: ${params.task_id}`,
              metadata: {
                found: false,
              },
            }
          }

          return {
            title: "Task Status",
            output: `${record.value.task_id} ${record.value.status}\n${record.value.result_summary ?? record.value.error_summary ?? ""}`.trim(),
            metadata: {
              found: true,
              task: record.value,
            },
          }
        }),
    }
  }),
)
