import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { TaskRuntime } from "@/session/task-runtime"
import { SessionID } from "@/session/schema"

const parameters = z.object({
  task_ids: z.array(z.string()),
  mode: z.enum(["all", "any"]).optional(),
  timeout_ms: z.number().optional(),
})

type TaskWaitMetadata = {
  tasks: Tool.MetadataValue
}

export const TaskWaitTool = Tool.define(
  "task_wait",
  Effect.gen(function* () {
    const tasks = yield* TaskRuntime.Service

    return {
      description: "Wait for one or more tasks to reach a terminal state.",
      parameters,
      execute: (
        params: z.infer<typeof parameters>,
        ctx,
      ): Effect.Effect<Tool.ExecuteResult<TaskWaitMetadata>, never, never> =>
        Effect.gen(function* () {
          const result = yield* tasks.wait({
            parentSessionID: ctx.sessionID,
            taskIDs: params.task_ids.map((item) => SessionID.make(item)),
            mode: params.mode ?? "all",
            timeoutMs: params.timeout_ms,
          })
          return {
            title: "Task Wait",
            output: result.map((item) => `${item.task_id} ${item.status} ${item.summary}`).join("\n"),
            metadata: {
              tasks: Tool.toMetadataValue(result),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
