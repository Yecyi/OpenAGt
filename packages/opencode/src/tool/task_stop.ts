import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { SessionID } from "@/session/schema"
import { TaskRuntime } from "@/session/task-runtime"

export const TaskStopTool = Tool.define(
  "task_stop",
  Effect.gen(function* () {
    const tasks = yield* TaskRuntime.Service

    return {
      description: "Cancel a task and record a stop reason.",
      parameters: z.object({
        task_id: SessionID.zod,
        reason: z.string().optional(),
      }),
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const record = yield* tasks.cancel({
            taskID: params.task_id,
            parentSessionID: ctx.sessionID,
            reason: params.reason,
          })
          return {
            title: "Task Stopped",
            output: `${record.task_id} cancelled`,
            metadata: {
              task: record,
            },
          }
        }),
    }
  }),
)
