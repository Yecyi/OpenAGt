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
import { Cause, Effect, Exit, Option } from "effect"
import { TaskKind, TaskRuntime } from "../session/task-runtime"
import { effortFromMetadata, isBroadAgentTask, numericMetadata } from "../agent/task-classifier"

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
  status?: "pending" | "running" | "completed" | "partial" | "failed" | "cancelled"
  groupId?: string
  error?: string
  retryable?: boolean
  partial?: boolean
  limitReason?: string
  partialSummary?: string
}

function taskPartialSummary(messages: MessageV2.WithParts[]) {
  const summary = messages
    .filter((message) => message.info.role === "assistant")
    .flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type === "text") return part.text.trim() ? [part.text.trim()] : []
        if (part.type !== "tool") return []
        if (part.state.status === "completed") {
          return [`tool ${part.tool} completed: ${part.state.output.slice(0, 300)}`]
        }
        if (part.state.status === "error") return [`tool ${part.tool} error: ${part.state.error}`]
        if (part.state.status === "running") return [`tool ${part.tool} running${part.state.title ? `: ${part.state.title}` : ""}`]
        return [`tool ${part.tool} pending`]
      }),
    )
    .join("\n")
    .trim()
  if (!summary) return undefined
  return summary.length > 4_000 ? summary.slice(-4_000) : summary
}

function taskStepBudget(params: z.infer<typeof parameters>, agentName: string, taskKind: z.infer<typeof TaskKind>) {
  const explicit = numericMetadata(params.metadata, "max_steps") ?? numericMetadata(params.metadata, "step_budget")
  if (explicit) return Math.min(explicit, 240)
  const effort = effortFromMetadata(params.metadata)
  const broad = isBroadAgentTask(params.prompt)
  const base =
    effort === "deep"
      ? 96
      : effort === "high"
        ? 64
        : effort === "medium"
          ? 36
          : effort === "low"
            ? 16
            : agentName === "explore" && broad
              ? 48
              : taskKind === "research" && broad
                ? 36
                : undefined
  if (!base) return undefined
  if (agentName === "explore" && broad) return Math.max(base, 48)
  return base
}

function taskTimeoutMs(
  params: z.infer<typeof parameters>,
  agentName: string,
  taskKind: z.infer<typeof TaskKind>,
  stepBudget: number | undefined,
) {
  const requested = numericMetadata(params.metadata, "timeout_ms")
  if (requested) return Math.min(requested, 1_800_000)
  const effort = effortFromMetadata(params.metadata)
  const broad = isBroadAgentTask(params.prompt)
  const base = agentName === "explore" ? 180_000 : 300_000
  const effortFloor =
    effort === "deep"
      ? 900_000
      : effort === "high"
        ? 600_000
        : effort === "medium"
          ? 300_000
          : effort === "low"
            ? 120_000
            : base
  const broadFloor =
    broad || taskKind === "research"
      ? Math.max(effortFloor, agentName === "explore" ? 360_000 : 480_000)
      : effortFloor
  const stepFloor = stepBudget ? stepBudget * 12_000 : base
  return Math.min(Math.max(base, broadFloor, stepFloor), 1_800_000)
}

function assistantText(message: MessageV2.WithParts) {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim()
}

function limitReason(message: MessageV2.WithParts) {
  if (message.info.role === "assistant" && message.info.finish === "step-budget") return "step_budget"
  const text = assistantText(message).toLowerCase()
  if (text.includes("step budget") && text.includes("reached")) return "step_budget"
  if (text.includes("maximum steps") && text.includes("reached")) return "step_budget"
  if (text.includes("max steps") && text.includes("reached")) return "step_budget"
  return undefined
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
      const readOnlyTask = next.name === "explore" || (taskKind === "research" && (params.write_scope ?? []).length === 0)
      const stepBudget = taskStepBudget(params, next.name, taskKind)
      const dependsOn = (params.depends_on ?? []).map((item) => SessionID.make(item))
      const timeoutMs = taskTimeoutMs(params, next.name, taskKind, stepBudget)
      const existingRecord = yield* tasks.get({ taskID: nextSession.id, parentSessionID: ctx.sessionID })

      const record =
        Option.isSome(existingRecord)
          ? existingRecord.value.status === "failed" ||
            existingRecord.value.status === "cancelled" ||
            existingRecord.value.status === "partial"
            ? yield* tasks.retry({ taskID: nextSession.id, parentSessionID: ctx.sessionID })
            : existingRecord.value
          : yield* tasks.create({
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

      if (record.status !== "pending") {
        return {
          title: params.description,
          metadata: {
            sessionId: nextSession.id,
            model,
            taskId: nextSession.id,
            status: record.status,
            groupId: record.group_id,
            partial: record.status === "partial" ? true : undefined,
            retryable: record.metadata?.retryable === true ? true : undefined,
            limitReason: typeof record.metadata?.limit_reason === "string" ? record.metadata.limit_reason : undefined,
            partialSummary:
              typeof record.metadata?.partial_summary === "string" ? record.metadata.partial_summary : undefined,
          },
          output: [
            `task_id: ${nextSession.id} (${record.status})`,
            "",
            "<task_result>",
            record.result_summary ?? record.error_summary ?? `Task is ${record.status}.`,
            "</task_result>",
          ].join("\n"),
        }
      }

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

      const partialSummary = Effect.fn("TaskTool.partialSummary")(function* () {
        const messages = yield* sessions
          .messages({ sessionID: nextSession.id, limit: 12 })
          .pipe(Effect.catch(() => Effect.succeed([])))
        return taskPartialSummary(messages)
      })

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
                runtime: {
                  stepBudget,
                  timeoutMs,
                  maxParallelSubagents:
                    numericMetadata(params.metadata, "max_parallel_subagents") ??
                    numericMetadata(params.metadata, "maxParallelSubagents"),
                  effort: effortFromMetadata(params.metadata),
                  taskKind,
                  reason: isBroadAgentTask(params.prompt) ? "broad task or high-effort subagent" : undefined,
                },
                tools: {
                  ...(readOnlyTask
                    ? { bash: false, edit: false, write: false, multiedit: false, apply_patch: false }
                    : {}),
                  ...(canTodo ? {} : { todowrite: false }),
                  ...(canTask ? {} : { task: false }),
                  ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
                },
                parts,
              })
              .pipe(Effect.timeout(`${timeoutMs} millis`), Effect.exit)
            const result = Exit.isSuccess(promptExit)
              ? { status: "completed" as const, message: promptExit.value }
              : yield* Effect.gen(function* () {
                  const error = Cause.squash(promptExit.cause)
                  const timeout =
                    typeof error === "object" && error !== null && "_tag" in error && error._tag === "TimeoutError"
                  if (timeout) cancel()
                  const partial = timeout ? yield* partialSummary() : undefined
                  return {
                    status: "failed" as const,
                    error: timeout
                      ? `Subagent timed out after ${Math.round(timeoutMs / 1000)}s`
                      : error instanceof Error
                        ? error.message
                        : String(error),
                    retryable: timeout,
                    partial,
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
                  partialSummary: result.partial,
                },
                output: [
                  `task_id: ${nextSession.id} (failed${result.retryable ? ", retryable" : ""})`,
                  "",
                  '<task_result status="failed">',
                  result.error,
                  "</task_result>",
                  ...(result.partial
                    ? ["", '<partial_task_result status="partial">', result.partial, "</partial_task_result>"]
                    : []),
                ].join("\n"),
              }
            }

            const maxStepReason = limitReason(result.message)
            if (maxStepReason) {
              yield* tasks.partial({
                taskID: nextSession.id,
                parentSessionID: ctx.sessionID,
                result: result.message,
                reason: maxStepReason,
                retryable: true,
              })

              const summary = assistantText(result.message) || "Subagent reached its step budget before returning a detailed summary."

              return {
                title: params.description,
                metadata: {
                  sessionId: nextSession.id,
                  model,
                  taskId: nextSession.id,
                  status: "partial" as const,
                  groupId: params.group_id,
                  partial: true,
                  retryable: true,
                  limitReason: maxStepReason,
                  partialSummary: summary,
                },
                output: [
                  `task_id: ${nextSession.id} (partial, retryable)`,
                  "",
                  `<partial_task_result status="partial" reason="${maxStepReason}">`,
                  summary,
                  "",
                  "Remaining work: retry this subagent with narrower scope or a larger step budget if the parent still needs more evidence.",
                  "</partial_task_result>",
                ].join("\n"),
              }
            }

            yield* tasks.complete({
              taskID: nextSession.id,
              parentSessionID: ctx.sessionID,
              result: result.message,
            })

            const summary = assistantText(result.message)

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
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context<TaskMetadata>) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
