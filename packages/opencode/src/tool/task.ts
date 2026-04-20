import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "../config"
import { Effect } from "effect"
import { TaskRuntime } from "../session/task-runtime"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): void
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  group_id: z.string().describe("Optional task group identifier for related subtasks").optional(),
  depends_on: z.array(SessionID.zod).describe("Optional task ids that must complete first").optional(),
  task_kind: z.enum(["research", "implement", "verify", "generic"]).optional(),
  return_mode: z.enum(["id", "summary"]).describe("Return task id or immediate summary").optional(),
  metadata: z.record(z.string(), z.unknown()).describe("Optional structured metadata for scheduling").optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const tasks = yield* TaskRuntime.Service

    const run = Effect.fn("TaskTool.execute")(function* (params: z.infer<typeof parameters>, ctx: Tool.Context) {
      const cfg = yield* config.get()

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const canTask = next.permission.some((rule) => rule.permission === id)
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...(canTodo
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(canTask
              ? []
              : [
                  {
                    permission: id,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const messageID = MessageID.ascending()
      const taskKind = params.task_kind ?? "generic"
      const dependsOn = params.depends_on ?? []

      const record = yield* tasks.create({
        parentSessionID: ctx.sessionID,
        childSessionID: nextSession.id,
        groupID: params.group_id,
        taskKind,
        subagentType: next.name,
        description: params.description,
        prompt: params.prompt,
        dependsOn,
        metadata: params.metadata,
      })

      const canRun = yield* tasks.canRun({ parentSessionID: ctx.sessionID, task: record })
      if (!canRun) {
        return {
          title: params.description,
          metadata: {
            sessionId: nextSession.id,
            model,
            taskId: nextSession.id,
            status: "pending",
            groupId: params.group_id,
          },
          output: [
            `task_id: ${nextSession.id} (pending)`,
            "",
            "<task_result>",
            "Task created and queued pending dependency or write-class constraints.",
            "</task_result>",
          ].join("\n"),
        }
      }

      function cancel() {
        ops.cancel(nextSession.id)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", cancel)
        }),
        () =>
          Effect.gen(function* () {
            yield* tasks.setRunning(nextSession.id, ctx.sessionID)
            const parts = yield* ops.resolvePromptParts(params.prompt)
            const result = yield* ops
              .prompt({
                messageID,
                sessionID: nextSession.id,
                model: {
                  modelID: model.modelID,
                  providerID: model.providerID,
                },
                agent: next.name,
                tools: {
                  ...(canTodo ? {} : { todowrite: false }),
                  ...(canTask ? {} : { task: false }),
                  ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
                },
                parts,
              })
              .pipe(
                Effect.tap((message) =>
                  tasks.complete({
                    taskID: nextSession.id,
                    parentSessionID: ctx.sessionID,
                    result: message,
                  }),
                ),
                Effect.tapError((error) =>
                  tasks.fail({
                    taskID: nextSession.id,
                    parentSessionID: ctx.sessionID,
                    error: error instanceof Error ? error.message : String(error),
                  }),
                ),
              )

            const summary = result.parts.findLast((item) => item.type === "text")?.text ?? ""

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
                taskId: nextSession.id,
                status: "completed",
                groupId: params.group_id,
              },
              output:
                (params.return_mode ?? "id") === "summary"
                  ? [
                      `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                      "",
                      "<task_result>",
                      summary,
                      "</task_result>",
                    ].join("\n")
                  : `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
            }
          }),
        () =>
          Effect.sync(() => {
            ctx.abort.removeEventListener("abort", cancel)
          }),
      )
    })

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context) => run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
