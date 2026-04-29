// Handles LLM stream events for one assistant message processor.
// It does not run retries, drain streams, or decide final processor results.
import { Deferred, Effect, Scope } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import { isOverflow } from "./overflow"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionSummary } from "./summary"
import { SessionStatus } from "./status"
import type { Provider } from "@/provider"
import * as Session from "./session"
import type { ProcessorToolCall } from "./processor-tool-calls"

const DOOM_LOOP_THRESHOLD = 3

export interface ProcessorContext {
  assistantMessage: MessageV2.Assistant
  sessionID: SessionID
  model: Provider.Model
  toolcalls: Record<string, ProcessorToolCall>
  shouldBreak: boolean
  snapshot: string | undefined
  blocked: boolean
  needsCompaction: boolean
  currentText: MessageV2.TextPart | undefined
  reasoningMap: Record<string, MessageV2.ReasoningPart>
}

type UpdateToolCall = (
  toolCallID: string,
  update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
) => Effect.Effect<MessageV2.ToolPart | undefined>

type CompleteToolCall = (
  toolCallID: string,
  output: {
    title: string
    metadata: Record<string, any>
    output: string
    attachments?: MessageV2.FilePart[]
  },
) => Effect.Effect<void>

type FailToolCall = (toolCallID: string, error: unknown) => Effect.Effect<boolean>

export class ProcessorEventHandler {
  constructor(
    private readonly deps: {
      context: ProcessorContext
      session: Session.Interface
      status: SessionStatus.Interface
      snapshot: Snapshot.Interface
      agents: Agent.Interface
      permission: Permission.Interface
      summary: SessionSummary.Interface
      config: Config.Interface
      plugin: Plugin.Interface
      scope: Scope.Scope
      log: { info: (message: string, data?: Record<string, unknown>) => void }
      updateToolCall: UpdateToolCall
      completeToolCall: CompleteToolCall
      failToolCall: FailToolCall
    },
  ) {}

  handle(value: LLM.Event): Effect.Effect<void, unknown, never> {
    const deps = this.deps
    const ctx = deps.context
    return Effect.gen(function* () {
      switch (value.type) {
        case "start":
          yield* deps.status.set(ctx.sessionID, { type: "busy" })
          return

        case "reasoning-start":
          if (value.id in ctx.reasoningMap) return
          ctx.reasoningMap[value.id] = {
            id: PartID.ascending(),
            messageID: ctx.assistantMessage.id,
            sessionID: ctx.assistantMessage.sessionID,
            type: "reasoning",
            text: "",
            time: { start: Date.now() },
            metadata: value.providerMetadata,
          }
          yield* deps.session.updatePart(ctx.reasoningMap[value.id])
          return

        case "reasoning-delta":
          if (!(value.id in ctx.reasoningMap)) return
          ctx.reasoningMap[value.id].text += value.text
          if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
          yield* deps.session.updatePartDelta({
            sessionID: ctx.reasoningMap[value.id].sessionID,
            messageID: ctx.reasoningMap[value.id].messageID,
            partID: ctx.reasoningMap[value.id].id,
            field: "text",
            delta: value.text,
          })
          return

        case "reasoning-end":
          if (!(value.id in ctx.reasoningMap)) return
          ctx.reasoningMap[value.id].time = { ...ctx.reasoningMap[value.id].time, end: Date.now() }
          if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
          yield* deps.session.updatePart(ctx.reasoningMap[value.id])
          delete ctx.reasoningMap[value.id]
          return

        case "tool-input-start":
          if (ctx.assistantMessage.summary) {
            throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
          }
          const part = yield* deps.session.updatePart({
            id: ctx.toolcalls[value.id]?.partID ?? PartID.ascending(),
            messageID: ctx.assistantMessage.id,
            sessionID: ctx.assistantMessage.sessionID,
            type: "tool",
            tool: value.toolName,
            callID: value.id,
            state: { status: "pending", input: {}, raw: "" },
            metadata: value.providerExecuted ? { providerExecuted: true } : undefined,
          } satisfies MessageV2.ToolPart)
          ctx.toolcalls[value.id] = {
            done: yield* Deferred.make<void>(),
            partID: part.id,
            messageID: part.messageID,
            sessionID: part.sessionID,
          }
          return

        case "tool-input-delta":
          return

        case "tool-input-end":
          return

        case "tool-call": {
          if (ctx.assistantMessage.summary) {
            throw new Error(`Tool call not allowed while generating summary: ${value.toolName}`)
          }
          yield* deps.updateToolCall(value.toolCallId, (match) => ({
            ...match,
            tool: value.toolName,
            state: {
              ...match.state,
              status: "running",
              input: value.input,
              time: { start: Date.now() },
            },
            metadata: match.metadata?.providerExecuted
              ? { ...value.providerMetadata, providerExecuted: true }
              : value.providerMetadata,
          }))

          const parts = MessageV2.parts(ctx.assistantMessage.id)
          const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)

          if (
            recentParts.length !== DOOM_LOOP_THRESHOLD ||
            !recentParts.every(
              (part) =>
                part.type === "tool" &&
                part.tool === value.toolName &&
                part.state.status !== "pending" &&
                JSON.stringify(part.state.input) === JSON.stringify(value.input),
            )
          ) {
            return
          }

          const agent = yield* deps.agents.get(ctx.assistantMessage.agent)
          yield* deps.permission.ask({
            permission: "doom_loop",
            patterns: [value.toolName],
            sessionID: ctx.assistantMessage.sessionID,
            metadata: { tool: value.toolName, input: value.input },
            always: [value.toolName],
            ruleset: agent.permission,
          })
          return
        }

        case "tool-result": {
          yield* deps.completeToolCall(value.toolCallId, value.output)
          return
        }

        case "tool-error": {
          yield* deps.failToolCall(value.toolCallId, value.error)
          return
        }

        case "error": {
          const handled = yield* Effect.all(
            Object.keys(ctx.toolcalls).map((toolCallID) => deps.failToolCall(toolCallID, value.error)),
            { concurrency: "unbounded" },
          )
          if (handled.some(Boolean)) return
          throw value.error
        }

        case "start-step":
          if (!ctx.assistantMessage.summary && !ctx.snapshot) ctx.snapshot = yield* deps.snapshot.track()
          yield* deps.session.updatePart({
            id: PartID.ascending(),
            messageID: ctx.assistantMessage.id,
            sessionID: ctx.sessionID,
            snapshot: ctx.snapshot,
            type: "step-start",
          })
          return

        case "finish-step": {
          const usage = Session.getUsage({
            model: ctx.model,
            usage: value.usage,
            metadata: value.providerMetadata,
          })
          ctx.assistantMessage.finish = value.finishReason
          ctx.assistantMessage.cost += usage.cost
          ctx.assistantMessage.tokens = usage.tokens
          yield* deps.session.updatePart({
            id: PartID.ascending(),
            reason: value.finishReason,
            snapshot: ctx.assistantMessage.summary ? undefined : yield* deps.snapshot.track(),
            messageID: ctx.assistantMessage.id,
            sessionID: ctx.assistantMessage.sessionID,
            type: "step-finish",
            tokens: usage.tokens,
            cost: usage.cost,
          })
          yield* deps.session.updateMessage(ctx.assistantMessage)
          if (ctx.snapshot) {
            const patch = yield* deps.snapshot.patch(ctx.snapshot)
            if (patch.files.length) {
              yield* deps.session.updatePart({
                id: PartID.ascending(),
                messageID: ctx.assistantMessage.id,
                sessionID: ctx.sessionID,
                type: "patch",
                hash: patch.hash,
                files: patch.files,
              })
            }
            ctx.snapshot = undefined
          }
          yield* deps.summary
            .summarize({
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.parentID,
            })
            .pipe(Effect.ignore, Effect.forkIn(deps.scope))
          if (
            !ctx.assistantMessage.summary &&
            isOverflow({ cfg: yield* deps.config.get(), tokens: usage.tokens, model: ctx.model })
          ) {
            ctx.needsCompaction = true
          }
          return
        }

        case "text-start":
          ctx.currentText = {
            id: PartID.ascending(),
            messageID: ctx.assistantMessage.id,
            sessionID: ctx.assistantMessage.sessionID,
            type: "text",
            text: "",
            time: { start: Date.now() },
            metadata: value.providerMetadata,
          }
          yield* deps.session.updatePart(ctx.currentText)
          return

        case "text-delta":
          if (!ctx.currentText) return
          ctx.currentText.text += value.text
          if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
          yield* deps.session.updatePartDelta({
            sessionID: ctx.currentText.sessionID,
            messageID: ctx.currentText.messageID,
            partID: ctx.currentText.id,
            field: "text",
            delta: value.text,
          })
          return

        case "text-end":
          if (!ctx.currentText) return
          ctx.currentText.text = (yield* deps.plugin.trigger(
            "experimental.text.complete",
            {
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              partID: ctx.currentText.id,
            },
            { text: ctx.currentText.text },
          )).text
          {
            const end = Date.now()
            ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          }
          if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
          yield* deps.session.updatePart(ctx.currentText)
          ctx.currentText = undefined
          return

        case "finish":
          return

        default:
          deps.log.info("unhandled", { event: value.type, value })
          return
      }
    })
  }
}
