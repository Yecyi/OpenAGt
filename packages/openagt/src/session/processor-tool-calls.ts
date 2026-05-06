// Manages tool-call part lifecycle for one assistant message stream.
// It does not consume LLM events, retry streams, or decide session completion.
import { Cause, Deferred, Effect } from "effect"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { Log } from "@/util"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { MessageV2 } from "./message-v2"
import * as Session from "./session"
import { completeInterruptedBashFor, isAbortLikeError, isShellRunnerBash } from "./processor-helpers"
import * as Bus from "@/bus"
import { Event as BehaviorEvent } from "@/bus/behavior-events"

const log = Log.create({ service: "session.processor-tool-calls" })

export type ProcessorToolCall = {
  partID: MessageV2.ToolPart["id"]
  messageID: MessageV2.ToolPart["messageID"]
  sessionID: MessageV2.ToolPart["sessionID"]
  done: Deferred.Deferred<void>
}

export interface ProcessorToolCallContext {
  toolcalls: Record<string, ProcessorToolCall>
  shouldBreak: boolean
  blocked: boolean
}

export class ProcessorToolCalls {
  private readonly completeInterruptedBash: ReturnType<typeof completeInterruptedBashFor>

  constructor(
    private readonly deps: {
      context: ProcessorToolCallContext
      isAborted: () => boolean
      session: Session.Interface
    },
  ) {
    this.completeInterruptedBash = completeInterruptedBashFor({ updatePart: deps.session.updatePart })
  }

  settle(toolCallID: string): Effect.Effect<void> {
    const deps = this.deps
    return Effect.gen(function* () {
      const done = deps.context.toolcalls[toolCallID]?.done
      delete deps.context.toolcalls[toolCallID]
      if (done) yield* Deferred.succeed(done, undefined).pipe(Effect.ignore)
    })
  }

  read(toolCallID: string): Effect.Effect<{ call: ProcessorToolCall; part: MessageV2.ToolPart } | undefined> {
    const deps = this.deps
    return Effect.gen(function* () {
      const call = deps.context.toolcalls[toolCallID]
      if (!call) return
      const part = yield* deps.session.getPart({
        partID: call.partID,
        messageID: call.messageID,
        sessionID: call.sessionID,
      })
      if (!part || part.type !== "tool") {
        delete deps.context.toolcalls[toolCallID]
        return
      }
      return { call, part }
    })
  }

  update(
    toolCallID: string,
    update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
  ): Effect.Effect<MessageV2.ToolPart | undefined> {
    const deps = this.deps
    const read = (id: string) => this.read(id)
    return Effect.gen(function* () {
      const match = yield* read(toolCallID)
      if (!match) return
      const part = yield* deps.session.updatePart(update(match.part))
      deps.context.toolcalls[toolCallID] = {
        ...match.call,
        partID: part.id,
        messageID: part.messageID,
        sessionID: part.sessionID,
      }
      return part
    })
  }

  complete(
    toolCallID: string,
    output: {
      title: string
      metadata: Record<string, any>
      output: string
      attachments?: MessageV2.FilePart[]
    },
  ): Effect.Effect<void> {
    const deps = this.deps
    const read = (id: string) => this.read(id)
    const settle = (id: string) => this.settle(id)
    return Effect.gen(function* () {
      const match = yield* read(toolCallID)
      if (!match) return
      if (match.part.state.status !== "running" && match.part.state.status !== "pending") return
      const end = Date.now()
      const start = match.part.state.status === "running" ? match.part.state.time.start : end
      yield* deps.session.updatePart({
        ...match.part,
        state: {
          status: "completed",
          input: match.part.state.input,
          output: output.output,
          metadata: output.metadata,
          title: output.title,
          time: { start, end },
          attachments: output.attachments,
        },
      })
      // Wave 6: emit behavior.tool.completed for the audit stream. Errors in
      // publish must not affect tool-call lifecycle, but we log them so
      // telemetry loss (e.g. inc.processor-effect-failures) is visible
      // instead of silently dropping behavior events.
      yield* Effect.promise(() =>
        Bus.publish(BehaviorEvent.ToolCompleted, {
          tool_id: match.part.tool,
          tool_call_id: toolCallID,
          session_id: match.part.sessionID,
          message_id: match.part.messageID,
          success: true,
          output_size: output.output.length,
          duration_ms: Math.max(0, end - start),
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            log.warn("behavior event publish failed", {
              event: "tool.completed",
              tool: match.part.tool,
              success: true,
              cause: Cause.pretty(cause),
            }),
          ),
        ),
      )
      yield* settle(toolCallID)
    })
  }

  fail(toolCallID: string, error: unknown): Effect.Effect<boolean> {
    const deps = this.deps
    const completeInterruptedBash = this.completeInterruptedBash
    const read = (id: string) => this.read(id)
    const settle = (id: string) => this.settle(id)
    return Effect.gen(function* () {
      const match = yield* read(toolCallID)
      if (!match) return false
      if (match.part.state.status !== "running" && match.part.state.status !== "pending") return false
      const end = Date.now()
      const metadata =
        "metadata" in match.part.state && isRecord(match.part.state.metadata) ? match.part.state.metadata : undefined
      const metadataRecord = metadata ?? {}
      const output = typeof metadataRecord.output === "string" ? metadataRecord.output : ""
      if ((deps.isAborted() || isAbortLikeError(error)) && isShellRunnerBash(match.part, metadataRecord, output)) {
        yield* completeInterruptedBash(match.part, metadataRecord, output, end)
        yield* settle(toolCallID)
        return true
      }
      const start = match.part.state.status === "running" ? match.part.state.time.start : end
      yield* deps.session.updatePart({
        ...match.part,
        state: {
          status: "error",
          input: match.part.state.input,
          error: errorMessage(error),
          metadata,
          time: { start, end },
        },
      })
      // Wave 6: emit behavior.tool.completed with success: false. error_kind
      // is best-effort — Permission.RejectedError / Question.RejectedError
      // are the well-known failure classes here; everything else is "runtime".
      const errorKind =
        error instanceof Permission.RejectedError
          ? "permission"
          : error instanceof Question.RejectedError
            ? "question_rejected"
            : "runtime"
      yield* Effect.promise(() =>
        Bus.publish(BehaviorEvent.ToolCompleted, {
          tool_id: match.part.tool,
          tool_call_id: toolCallID,
          session_id: match.part.sessionID,
          message_id: match.part.messageID,
          success: false,
          output_size: output.length,
          duration_ms: Math.max(0, end - start),
          error_kind: errorKind,
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            log.warn("behavior event publish failed", {
              event: "tool.completed",
              tool: match.part.tool,
              success: false,
              error_kind: errorKind,
              cause: Cause.pretty(cause),
            }),
          ),
        ),
      )
      if (error instanceof Permission.RejectedError || error instanceof Question.RejectedError) {
        deps.context.blocked = deps.context.shouldBreak
      }
      yield* settle(toolCallID)
      return true
    })
  }

  waitForPending(): Effect.Effect<void> {
    const deps = this.deps
    return Effect.forEach(
      Object.values(deps.context.toolcalls),
      (call) => Deferred.await(call.done).pipe(Effect.timeout("5 seconds"), Effect.ignore),
      { concurrency: "unbounded" },
    ).pipe(Effect.asVoid)
  }

  cleanupInterrupted(): Effect.Effect<void> {
    const deps = this.deps
    const completeInterruptedBash = this.completeInterruptedBash
    const read = (id: string) => this.read(id)
    const settle = (id: string) => this.settle(id)
    return Effect.gen(function* () {
      for (const toolCallID of Object.keys(deps.context.toolcalls)) {
        const match = yield* read(toolCallID)
        if (!match) continue
        const part = match.part
        const end = Date.now()
        const metadata = "metadata" in part.state && isRecord(part.state.metadata) ? part.state.metadata : {}
        const output = typeof metadata.output === "string" ? metadata.output : ""
        if (isShellRunnerBash(part, metadata, output)) {
          yield* completeInterruptedBash(part, metadata, output, end)
          yield* settle(toolCallID)
          continue
        }
        yield* deps.session.updatePart({
          ...part,
          state: {
            ...part.state,
            status: "error",
            error: "Tool execution interrupted during session cleanup",
            metadata: {
              ...metadata,
              interrupted: true,
              interruption_origin: "session_cleanup",
              root_cause: "tool_result_missing_after_session_interrupt",
              active_tool: part.tool,
            },
            time: { start: "time" in part.state ? part.state.time.start : end, end },
          },
        })
      }
      deps.context.toolcalls = {}
    })
  }
}
