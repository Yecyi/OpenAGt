import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { TaskRuntime } from "@/session/task-runtime"
import { SessionID } from "@/session/schema"

const parameters = z.object({
  task_id: z.string(),
  reason: z.string().optional(),
})

type TaskStopMetadata = {
  task: TaskRuntime.TaskRecord
}

export const TaskStopTool = Tool.define<typeof parameters, TaskStopMetadata, TaskRuntime.Service>(
  "task_stop",
  Effect.gen(function* () {
    const tasks = yield* TaskRuntime.Service

    return {
      description: "Cancel a task and record a stop reason.",
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx): Effect.Effect<Tool.ExecuteResult<TaskStopMetadata>, never, never> =>
        Effect.gen(function* () {
          const record = yield* tasks.cancel({
            taskID: SessionID.make(params.task_id),
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
        }).pipe(Effect.orDie),
    }
  }),
)
