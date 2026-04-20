import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { TaskRuntime } from "@/session/task-runtime"

export const TaskListTool = Tool.define(
  "task_list",
  Effect.gen(function* () {
    const tasks = yield* TaskRuntime.Service

    return {
      description: "List task state for the current session, including pending, running, and completed subtasks.",
      parameters: z.object({}),
      execute: (_params, ctx) =>
        Effect.gen(function* () {
          const records = yield* tasks.list(ctx.sessionID)
          const output = records.length
            ? records
                .map((item) => `${item.task_id} ${item.status} ${item.task_kind} ${item.description}`)
                .join("\n")
            : "No tasks found."
          return {
            title: "Task List",
            output,
            metadata: {
              tasks: records,
            },
          }
        }),
    }
  }),
)
