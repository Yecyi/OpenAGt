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
import { BudgetTuning, effortStepBudget, effortTimeoutFloor } from "../agent/budget-tuning"
import { classifyGoal, effortFromMetadata, numericMetadata } from "../agent/task-classifier"
import {
  assistantText,
  formatCompletedOutput,
  formatFailedOutput,
  formatPendingOutput,
  formatStepBudgetPartialOutput,
  formatStoredRecordOutput,
  formatTimeoutPartialOutput,
  limitReason,
  taskPartialSummary,
  type TaskMetadata,
} from "./task-output"

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

function taskStepBudget(params: z.infer<typeof parameters>, agentName: string, taskKind: z.infer<typeof TaskKind>) {
  const explicit = numericMetadata(params.metadata, "max_steps") ?? numericMetadata(params.metadata, "step_budget")
  if (explicit) {
    const value = Math.min(explicit, BudgetTuning.step.absoluteCap)
    return {
      value,
      metadata: {
        requested_step_budget: explicit,
        effective_step_budget: value,
        limit_reason: explicit > value ? "step_budget_cap" : undefined,
      },
    }
  }
  const effort = effortFromMetadata(params.metadata)
  const broad = classifyGoal(params.prompt).broad_task
  const base =
    effortStepBudget(effort) ??
    (agentName === "explore" && broad
      ? BudgetTuning.step.broadExploreFloor
      : taskKind === "research" && broad
        ? BudgetTuning.step.broadResearchFloor
        : undefined)
  if (!base) return undefined
  const broadFloor =
    agentName === "explore" && broad
      ? BudgetTuning.step.broadExploreFloor
      : taskKind === "research" && broad
        ? BudgetTuning.step.broadResearchFloor
        : 0
  const value = Math.max(base, broadFloor)
  return {
    value,
    metadata: {
      effective_step_budget: value,
      limit_reason: value > base ? "broad_explore_floor" : undefined,
    },
  }
}

function taskTimeoutMs(
  params: z.infer<typeof parameters>,
  agentName: string,
  taskKind: z.infer<typeof TaskKind>,
  stepBudget: number | undefined,
) {
  const requested = numericMetadata(params.metadata, "timeout_ms")
  if (requested) {
    const value = Math.min(requested, BudgetTuning.timeoutMs.absoluteCap)
    return {
      value,
      metadata: {
        requested_timeout_ms: requested,
        effective_timeout_ms: value,
        timeout_limit_reason: requested > value ? "timeout_cap" : undefined,
      },
    }
  }
  const effort = effortFromMetadata(params.metadata)
  const broad = classifyGoal(params.prompt).broad_task
  const base = agentName === "explore" ? BudgetTuning.timeoutMs.exploreBase : BudgetTuning.timeoutMs.defaultBase
  const effortFloor = effortTimeoutFloor(effort) ?? base
  const broadFloor =
    broad || taskKind === "research"
      ? Math.max(
          effortFloor,
          agentName === "explore"
            ? BudgetTuning.timeoutMs.broadExploreFloor
            : BudgetTuning.timeoutMs.broadResearchFloor,
        )
      : effortFloor
  const stepFloor = stepBudget ? stepBudget * BudgetTuning.timeoutMs.perStepFloor : base
  const value = Math.min(Math.max(base, broadFloor, stepFloor), BudgetTuning.timeoutMs.absoluteCap)
  return {
    value,
    metadata: {
      effective_timeout_ms: value,
    },
  }
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
      const readOnlyTask =
        next.name === "explore" || (taskKind === "research" && (params.write_scope ?? []).length === 0)
      const stepBudget = taskStepBudget(params, next.name, taskKind)
      const dependsOn = (params.depends_on ?? []).map((item) => SessionID.make(item))
      const timeoutMs = taskTimeoutMs(params, next.name, taskKind, stepBudget?.value)
      const existingRecord = yield* tasks.get({ taskID: nextSession.id, parentSessionID: ctx.sessionID })
      const classification = classifyGoal(params.prompt)
      const runtimeMetadata = {
        ...(params.metadata ?? {}),
        ...stepBudget?.metadata,
        ...timeoutMs.metadata,
        broad_task: classification.broad_task,
        classification_confidence: classification.confidence,
        classification_reasons: classification.reasons,
        matched_terms: classification.matched_terms,
        fallback_used: classification.fallback_used,
      }

      const record = Option.isSome(existingRecord)
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
            metadata: runtimeMetadata,
          })

      const target = { sessionId: nextSession.id, model }

      if (record.status !== "pending") {
        return formatStoredRecordOutput(params, target, record)
      }

      const canRun = yield* tasks.canRun({ parentSessionID: ctx.sessionID, task: record })
      if (!canRun) {
        return formatPendingOutput(params, target)
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
                  stepBudget: stepBudget?.value,
                  timeoutMs: timeoutMs.value,
                  maxParallelSubagents:
                    numericMetadata(runtimeMetadata, "max_parallel_subagents") ??
                    numericMetadata(runtimeMetadata, "maxParallelSubagents"),
                  effort: effortFromMetadata(params.metadata),
                  taskKind,
                  reason: classification.broad_task ? "broad task or high-effort subagent" : undefined,
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
              .pipe(Effect.timeout(`${timeoutMs.value} millis`), Effect.exit)
            const result = Exit.isSuccess(promptExit)
              ? { status: "completed" as const, message: promptExit.value }
              : yield* Effect.gen(function* () {
                  const error = Cause.squash(promptExit.cause)
                  const timeout =
                    typeof error === "object" && error !== null && "_tag" in error && error._tag === "TimeoutError"
                  if (timeout) cancel()
                  const partial = timeout ? yield* partialSummary() : undefined
                  return {
                    status: timeout ? ("partial" as const) : ("failed" as const),
                    error: timeout
                      ? `Subagent timed out after ${Math.round(timeoutMs.value / 1000)}s`
                      : error instanceof Error
                        ? error.message
                        : String(error),
                    retryable: timeout,
                    partial,
                  }
                })

            if (result.status === "partial") {
              const summary = result.partial ?? "No partial output was available before the subagent timed out."
              yield* tasks.partial({
                taskID: nextSession.id,
                parentSessionID: ctx.sessionID,
                output: summary,
                reason: "timeout",
                retryable: true,
                remainingScope: params.acceptance_checks ??
                  params.read_scope ??
                  params.write_scope ?? [params.description],
              })

              return formatTimeoutPartialOutput(params, target, summary, result.error)
            }

            if (result.status === "failed") {
              yield* tasks.fail({
                taskID: nextSession.id,
                parentSessionID: ctx.sessionID,
                error: result.error,
              })

              return formatFailedOutput(params, target, result.error, result.retryable, result.partial)
            }

            if (result.status !== "completed") {
              return yield* Effect.fail(new Error(`Unhandled task result status: ${result.status}`))
            }

            const completedMessage = result.message
            const maxStepReason = limitReason(completedMessage)
            if (maxStepReason) {
              yield* tasks.partial({
                taskID: nextSession.id,
                parentSessionID: ctx.sessionID,
                result: completedMessage,
                reason: maxStepReason,
                retryable: true,
                remainingScope: params.acceptance_checks ??
                  params.read_scope ??
                  params.write_scope ?? [params.description],
              })

              const summary =
                assistantText(completedMessage) ||
                "Subagent reached its step budget before returning a detailed summary."

              return formatStepBudgetPartialOutput(params, target, summary, maxStepReason)
            }

            yield* tasks.complete({
              taskID: nextSession.id,
              parentSessionID: ctx.sessionID,
              result: completedMessage,
            })

            return formatCompletedOutput(params, target, assistantText(completedMessage))
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
