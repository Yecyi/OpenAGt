import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { Provider } from "../provider"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "../config"
import { Cause, Effect, Exit } from "effect"
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
  depends_on: z.array(z.string()).describe("Optional task ids that must complete first").optional(),
  task_kind: z.enum(["research", "implement", "verify", "generic"]).optional(),
  write_scope: z.array(z.string()).describe("Files or directories this task may write").optional(),
  read_scope: z.array(z.string()).describe("Files or directories this task reads without writing").optional(),
  acceptance_checks: z.array(z.string()).describe("Checks that determine task completion quality").optional(),
  priority: z.enum(["high", "normal", "low"]).describe("Scheduling priority for this task").optional(),
  origin: z.enum(["user", "coordinator", "scheduler", "gateway"]).describe("Origin of the task").optional(),
  return_mode: z.enum(["id", "summary"]).describe("Return task id or immediate summary").optional(),
  metadata: z.record(z.string(), z.unknown()).describe("Optional structured metadata for scheduling").optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

type TaskMetadata = {
  sessionId: SessionID
  model: {
    modelID: string
    providerID: string
  }
  taskId?: SessionID
  status?: "pending" | "completed" | "failed"
  groupId?: string
  error?: string
  retryable?: boolean
}

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
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
      const readOnlyExplore = next.name === "explore"

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

      if (next.model) {
        yield* provider.getModel(model.providerID, model.modelID)
      }

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const messageID = MessageID.ascending()
      const taskKind = params.task_kind ?? "generic"
      const dependsOn = (params.depends_on ?? []).map((item) => SessionID.make(item))
      const requestedTimeout = params.metadata?.timeout_ms
      const timeoutMs =
        typeof requestedTimeout === "number" && Number.isFinite(requestedTimeout) && requestedTimeout > 0
          ? Math.min(requestedTimeout, 900_000)
          : next.name === "explore"
            ? 90_000
            : 300_000

      const record = yield* tasks.create({
        parentSessionID: ctx.sessionID,
        childSessionID: nextSession.id,
        groupID: params.group_id,
        taskKind,
        subagentType: next.name,
        description: params.description,
        prompt: params.prompt,
        dependsOn,
        writeScope: params.write_scope,
        readScope: params.read_scope,
        acceptanceChecks: params.acceptance_checks,
        priority: params.priority,
        origin: params.origin,
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
            status: "pending" as const,
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
        Effect.gen(function* () {
          ctx.abort.addEventListener("abort", cancel)
          return yield* tasks.registerCancelHandler({
            taskID: nextSession.id,
            parentSessionID: ctx.sessionID,
            cancel,
          })
        }),
        () =>
          Effect.gen(function* () {
            const started = yield* tasks.tryStartPending(nextSession.id, ctx.sessionID)
            if (!started) return yield* Effect.fail(new Error(`Task is not pending: ${nextSession.id}`))
            const parts = yield* ops.resolvePromptParts(params.prompt)
            const promptExit = yield* ops
              .prompt({
                messageID,
                sessionID: nextSession.id,
                model: {
                  modelID: model.modelID,
                  providerID: model.providerID,
                },
                agent: next.name,
                tools: {
                  ...(readOnlyExplore
                    ? { bash: false, edit: false, write: false, multiedit: false, apply_patch: false }
                    : {}),
                  ...(canTodo ? {} : { todowrite: false }),
                  ...(canTask ? {} : { task: false }),
                  ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
                },
                parts,
              })
              .pipe(
                Effect.timeout(`${timeoutMs} millis`),
                Effect.exit,
              )
            const result = Exit.isSuccess(promptExit)
              ? { status: "completed" as const, message: promptExit.value }
              : yield* Effect.sync(() => {
                  const error = Cause.squash(promptExit.cause)
                  const timeout =
                    typeof error === "object" && error !== null && "_tag" in error && error._tag === "TimeoutError"
                  if (timeout) cancel()
                  return {
                    status: "failed" as const,
                    error: timeout
                      ? `Subagent timed out after ${Math.round(timeoutMs / 1000)}s`
                      : error instanceof Error
                        ? error.message
                        : String(error),
                    retryable: timeout,
                  }
                })

            if (result.status === "failed") {
              yield* tasks.fail({
                taskID: nextSession.id,
                parentSessionID: ctx.sessionID,
                error: result.error,
              })

              return {
                title: params.description,
                metadata: {
                  sessionId: nextSession.id,
                  model,
                  taskId: nextSession.id,
                  status: "failed" as const,
                  groupId: params.group_id,
                  error: result.error,
                  retryable: result.retryable,
                },
                output: [
                  `task_id: ${nextSession.id} (failed${result.retryable ? ", retryable" : ""})`,
                  "",
                  "<task_result status=\"failed\">",
                  result.error,
                  "</task_result>",
                ].join("\n"),
              }
            }

            yield* tasks.complete({
              taskID: nextSession.id,
              parentSessionID: ctx.sessionID,
              result: result.message,
            })

            const summary = result.message.parts.findLast((item) => item.type === "text")?.text ?? ""

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
                taskId: nextSession.id,
                status: "completed" as const,
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
        (unregister) =>
          Effect.sync(() => {
            unregister()
            ctx.abort.removeEventListener("abort", cancel)
          }),
      )
    })

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context<TaskMetadata>) => run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
