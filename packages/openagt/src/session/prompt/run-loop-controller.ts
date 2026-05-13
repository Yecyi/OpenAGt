// Coordinates one session prompt run loop.
// It does not create user messages, resolve prompt parts, or change public SessionPrompt contracts.
import { type Tool as AITool } from "ai"
import { Effect, Scope } from "effect"
import { NamedError } from "@openagt/shared/util/error"
import { Agent } from "../../agent/agent"
import { Bus } from "../../bus"
import { EffectLogger, InstanceState } from "../../effect"
import { Instruction } from "../instruction"
import { MessageV2 } from "../message-v2"
import { SessionCompaction } from "../compaction"
import { SessionProcessor } from "../processor"
import { SessionStatus } from "../status"
import { SessionSummary } from "../summary"
import { SystemPrompt } from "../system"
import { Plugin } from "../../plugin"
import { Provider, ProviderFallback } from "../../provider"
import type { ModelID, ProviderID } from "../../provider/schema"
import * as Session from "../session"
import { MessageID, type SessionID } from "../schema"
import MAX_STEPS from "./max-steps.txt"
import { promptCacheMetrics } from "../compaction/metrics"
import { loadMemory } from "../memory"
import { computeSHA256 } from "./hash"
import { collectRunLoopState, shouldExitRunLoop } from "./run-loop-state"
import { wrapUserMessagesAfterFinish } from "./run-loop-reminders"
import { effectiveMaxSteps, promptStepTimeoutMs } from "./step-policy"
import { createStructuredOutputTool, STRUCTURED_OUTPUT_SYSTEM_PROMPT } from "./structured-output"
import type { PromptReminderInserterInput } from "./reminder-inserter"
import type { PromptSubtaskRunnerInput } from "./subtask-runner"
import type { PromptToolResolverInput } from "./tool-resolver"
import type { PromptTitleGeneratorInput } from "./title-generator"

type PromptRunLoopOutcome = "break" | "continue"

export class PromptRunLoopController {
  constructor(
    private readonly deps: {
      agents: Agent.Interface
      bus: Bus.Interface
      compaction: SessionCompaction.Interface
      getModel: (providerID: ProviderID, modelID: ModelID, sessionID: SessionID) => Effect.Effect<Provider.Model>
      handleSubtask: (input: PromptSubtaskRunnerInput) => Effect.Effect<void>
      insertReminders: (input: PromptReminderInserterInput) => Effect.Effect<MessageV2.WithParts[]>
      instruction: Instruction.Interface
      lastAssistant: (sessionID: SessionID) => Effect.Effect<MessageV2.WithParts>
      log: EffectLogger.Handle
      plugin: Plugin.Interface
      processor: SessionProcessor.Interface
      providerFallback: ProviderFallback.Interface
      resolveTools: (input: PromptToolResolverInput) => Effect.Effect<Record<string, AITool>>
      scope: Scope.Scope
      sessions: Session.Interface
      status: SessionStatus.Interface
      summary: SessionSummary.Interface
      sys: SystemPrompt.Interface
      title: (input: PromptTitleGeneratorInput) => Effect.Effect<void>
    },
  ) {}

  run(sessionID: SessionID): Effect.Effect<MessageV2.WithParts> {
    const deps = this.deps
    return Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const slog = deps.log.with({ sessionID })
      let structured: unknown | undefined
      let step = 0
      const session = yield* deps.sessions.get(sessionID)

      while (true) {
        yield* deps.status.set(sessionID, { type: "busy" })
        yield* slog.info("loop", { step })

        let msgs = yield* MessageV2.filterCompactedEffect(sessionID)

        const loopState = collectRunLoopState(msgs)
        const lastUser = loopState.lastUser
        const lastAssistant = loopState.lastAssistant
        const lastFinished = loopState.lastFinished
        const tasks = loopState.tasks

        if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

        const lastAssistantMsg = msgs.findLast(
          (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
        )
        if (shouldExitRunLoop({ lastUser, lastAssistant, lastAssistantMsg })) {
          yield* slog.info("exiting loop")
          break
        }

        step++
        if (step === 1)
          yield* deps
            .title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            })
            .pipe(Effect.ignore, Effect.forkIn(deps.scope))

        const model = yield* deps.getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
        const task = tasks.pop()

        if (task?.type === "subtask") {
          yield* deps.handleSubtask({ task, model, lastUser, sessionID, session, msgs })
          continue
        }

        if (task?.type === "compaction") {
          const result = yield* deps.compaction.process({
            messages: msgs,
            parentID: lastUser.id,
            sessionID,
            auto: task.auto,
            overflow: task.overflow,
          })
          if (result === "stop") break
          continue
        }

        if (
          lastFinished &&
          lastFinished.summary !== true &&
          (yield* deps.compaction.isOverflow({ tokens: lastFinished.tokens, model }))
        ) {
          yield* deps.compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
          continue
        }

        yield* deps.compaction.prune({ sessionID }).pipe(Effect.ignore)
        msgs = yield* MessageV2.filterCompactedEffect(sessionID)

        const agent = yield* deps.agents.get(lastUser.agent)
        if (!agent) {
          const available = (yield* deps.agents.list()).filter((a) => !a.hidden).map((a) => a.name)
          const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
          const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
          yield* deps.bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
          throw error
        }
        const lastUserMsg = msgs.find((msg) => msg.info.id === lastUser.id)
        const maxSteps = effectiveMaxSteps(agent, lastUser, lastUserMsg)
        const isLastStep = step >= maxSteps
        msgs = yield* deps.insertReminders({ messages: msgs, agent, session })

        let fallbackState = yield* deps.providerFallback.createState(lastUser.model.providerID, lastUser.model.modelID)
        let activeModel = model
        let outcome: PromptRunLoopOutcome = "break"
        while (true) {
          const msg: MessageV2.Assistant = {
            id: MessageID.ascending(),
            parentID: lastUser.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            variant: lastUser.model.variant,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: activeModel.id,
            providerID: activeModel.providerID,
            time: { created: Date.now() },
            sessionID,
          }
          yield* deps.sessions.updateMessage(msg)
          const handle = yield* deps.processor.create({
            assistantMessage: msg,
            sessionID,
            model: activeModel,
          })

          outcome = yield* Effect.gen(function* () {
            const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

            const tools = yield* deps.resolveTools({
              agent,
              session,
              model: activeModel,
              tools: lastUser.tools,
              processor: handle,
              bypassAgentCheck,
              messages: msgs,
            })

            if (lastUser.format?.type === "json_schema") {
              tools["StructuredOutput"] = createStructuredOutputTool({
                schema: lastUser.format.schema,
                onSuccess(output) {
                  structured = output
                },
              })
            }

            if (step === 1)
              yield* deps.summary
                .summarize({ sessionID, messageID: lastUser.id })
                .pipe(Effect.ignore, Effect.forkIn(deps.scope))

            if (step > 1) wrapUserMessagesAfterFinish(msgs, lastFinished)

            yield* deps.plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

            // A-P2-1: Load session memory for resume
            const sessionMemory = yield* Effect.promise(() => loadMemory(sessionID))

            const [skills, envResult, instructions, modelMsgs] = yield* Effect.all([
              deps.sys.skills(agent),
              Effect.sync(() => deps.sys.environment(activeModel)),
              deps.instruction.system().pipe(Effect.orDie),
              MessageV2.toModelMessagesEffect(msgs, activeModel),
            ])

            // A-P1-2: Compute static hash for cache telemetry
            const staticHash = yield* Effect.promise(() => computeSHA256(envResult.static.join("")))
            promptCacheMetrics.recordStaticHash(staticHash)

            const memorySection = sessionMemory ? [`\n## Session Memory\n${sessionMemory}\n`] : []

            const system = [
              ...envResult.static,
              ...envResult.semiStatic,
              ...memorySection,
              ...(skills ? [skills] : []),
              ...instructions,
            ]
            const format = lastUser.format ?? { type: "text" as const }
            if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
            const result = yield* handle
              .process({
                user: lastUser,
                agent,
                permission: session.permission,
                sessionID,
                parentSessionID: session.parentID,
                system,
                messages: [...modelMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
                tools: isLastStep ? {} : tools,
                model: activeModel,
                toolChoice: isLastStep ? undefined : format.type === "json_schema" ? "required" : undefined,
              })
              .pipe(
                Effect.timeoutOrElse({
                  duration: promptStepTimeoutMs(agent, lastUser),
                  orElse: () =>
                    Effect.gen(function* () {
                      handle.message.error = new NamedError.Unknown({
                        message: `Prompt step timed out after ${promptStepTimeoutMs(agent, lastUser)}ms`,
                      }).toObject()
                      handle.message.finish = "error"
                      yield* deps.sessions.updateMessage(handle.message)
                      return "stop" as const
                    }),
                }),
              )

            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* deps.sessions.updateMessage(handle.message)
              return "break" as const
            }

            if (isLastStep && handle.message.finish && !handle.message.error) {
              handle.message.finish = "step-budget"
              yield* deps.sessions.updateMessage(handle.message)
            }

            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
            if (finished && !handle.message.error) {
              if (format.type === "json_schema") {
                handle.message.error = new MessageV2.StructuredOutputError({
                  message: "Model did not produce structured output",
                  retries: 0,
                }).toObject()
                yield* deps.sessions.updateMessage(handle.message)
                return "break" as const
              }
            }

            if (result === "stop") return "break" as const
            if (result === "compact") {
              yield* deps.compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !handle.message.finish,
              })
            }
            return "continue" as const
          }).pipe(Effect.ensuring(deps.instruction.clear(handle.message.id)))

          if (outcome === "continue") break
          if (!handle.message.error || !fallbackState) break

          const shouldFallback = yield* deps.providerFallback.shouldFallback(handle.message.error, fallbackState)
          if (!shouldFallback) break

          const nextFallback = yield* deps.providerFallback.next(fallbackState)
          if (!nextFallback) break

          fallbackState = nextFallback.state
          activeModel = nextFallback.model
          structured = undefined
        }

        if (outcome === "break") break
        continue
      }

      yield* deps.compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(deps.scope))
      return yield* deps.lastAssistant(sessionID)
    })
  }
}
