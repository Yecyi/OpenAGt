import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { SessionID } from "@/session/schema"
import { TaskRuntime } from "@/session/task-runtime"

export const TaskWaitTool = Tool.define(
  "task_wait",
  Effect.gen(function* () {
    const tasks = yield* TaskRuntime.Service

    return {
      description: "Wait for one or more tasks to reach a terminal state.",
      parameters: z.object({
        task_ids: z.array(SessionID.zod),
        mode: z.enum(["all", "any"]).optional(),
        timeout_ms: z.number().optional(),
      }),
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const result = yield* tasks.wait({
            parentSessionID: ctx.sessionID,
            taskIDs: params.task_ids,
            mode: params.mode ?? "all",
            timeoutMs: params.timeout_ms,
          })
          return {
            title: "Task Wait",
            output: result.map((item) => `${item.task_id} ${item.status} ${item.summary}`).join("\n"),
            metadata: {
              tasks: result,
            },
          }
        }),
    }
  }),
)
