// Resolves AI SDK tool definitions for a single prompt step.
// It does not stream providers, create messages, or change tool contracts.
import z from "zod"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import { ulid } from "ulid"
import { Cause, Effect, Exit } from "effect"
import { EffectBridge } from "../../effect"
import { MCP } from "../../mcp"
import { Permission } from "../../permission"
import { Plugin } from "../../plugin"
import { Provider, ProviderTransform } from "../../provider"
import { ModelID } from "../../provider/schema"
import { Tool, ToolRegistry, Truncate } from "../../tool"
import type { TaskPromptOps } from "../../tool/task"
import { Agent } from "../../agent/agent"
import * as Session from "../session"
import { MessageV2 } from "../message-v2"
import { SessionProcessor } from "../processor"
import { PartID } from "../schema"
import { mcpToolOutputParts } from "./mcp-output"
import { createToolScheduler } from "./tool-resolution"
import { diagnosticRepairPlanFromMetadata, diagnosticRepairReminder } from "../../lsp/feedback"
import { addReminder } from "./reminder"

export type PromptToolResolverInput = {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  tools?: Record<string, boolean>
  processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "failToolCall" | "completeToolCall">
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
}

const normalizeToolInput = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

export class PromptToolResolver {
  constructor(
    private readonly deps: {
      mcp: MCP.Interface
      permission: Permission.Interface
      plugin: Plugin.Interface
      registry: ToolRegistry.Interface
      run: EffectBridge.Shape
      truncate: Truncate.Interface
      promptOps: TaskPromptOps
    },
    private readonly input: PromptToolResolverInput,
  ) {}

  resolve(): Effect.Effect<Record<string, AITool>> {
    const input = this.input
    const deps = this.deps
    const context = (args: any, options: ToolExecutionOptions) => this.context(args, options)
    return Effect.gen(function* () {
      const tools: Record<string, AITool> = {}
      const lastUserRuntime = input.messages.findLast(
        (message): message is MessageV2.WithParts & { info: MessageV2.User } => message.info.role === "user",
      )?.info.runtime
      const scheduler = createToolScheduler({ maxParallelSafeTasks: lastUserRuntime?.maxParallelSubagents })

      for (const item of yield* deps.registry.tools({
        modelID: ModelID.make(input.model.api.id),
        providerID: input.model.providerID,
        agent: input.agent,
      })) {
        const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
        tools[item.id] = tool({
          description: item.description,
          inputSchema: jsonSchema(schema),
          execute(args, options) {
            const call = {
              toolCallId: options.toolCallId ?? ulid(),
              toolName: item.id,
              input: normalizeToolInput(args),
            }
            return scheduler.schedule(call, () =>
              deps.run.promise(
                Effect.gen(function* () {
                  const ctx = context(args, { ...options, toolCallId: call.toolCallId })
                  yield* deps.plugin.trigger(
                    "tool.execute.before",
                    { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
                    { args },
                  )
                  const exit = yield* item.execute(args, ctx).pipe(Effect.exit)
                  if (Exit.isFailure(exit)) {
                    const error = Cause.squash(exit.cause)
                    const toolError = error instanceof Error ? error : new Error(String(error))
                    yield* input.processor.failToolCall(call.toolCallId, toolError)
                    return {
                      title: item.id,
                      metadata: { toolError: true },
                      output: toolError.message,
                    }
                  }
                  const result = exit.value
                  const output = {
                    ...result,
                    attachments: result.attachments?.map((attachment) => ({
                      ...attachment,
                      id: PartID.ascending(),
                      sessionID: ctx.sessionID,
                      messageID: input.processor.message.id,
                    })),
                  }
                  yield* deps.plugin.trigger(
                    "tool.execute.after",
                    { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
                    output,
                  )
                  const repairReminder = diagnosticRepairReminder(
                    diagnosticRepairPlanFromMetadata(output.metadata?.lsp_repair),
                  )
                  if (repairReminder) addReminder(repairReminder, 10, String(ctx.sessionID))
                  yield* input.processor.completeToolCall(call.toolCallId, output)
                  return output
                }),
              ),
            )
          },
        })
      }

      for (const [key, item] of Object.entries(yield* deps.mcp.tools())) {
        const execute = item.execute
        if (!execute) continue

        const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
        const transformed = ProviderTransform.schema(input.model, schema)
        item.inputSchema = jsonSchema(transformed)
        item.execute = (args, opts) => {
          const toolCallId = opts.toolCallId ?? ulid()
          return scheduler.schedule(
            {
              toolCallId,
              toolName: key,
              input: normalizeToolInput(args),
            },
            () =>
              deps.run.promise(
                Effect.gen(function* () {
                  const ctx = context(args, { ...opts, toolCallId })
                  yield* deps.plugin.trigger(
                    "tool.execute.before",
                    { tool: key, sessionID: ctx.sessionID, callID: ctx.callID },
                    { args },
                  )
                  yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
                  const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.promise(() =>
                    execute(args, opts),
                  )
                  yield* deps.plugin.trigger(
                    "tool.execute.after",
                    { tool: key, sessionID: ctx.sessionID, callID: ctx.callID, args },
                    result,
                  )

                  const { textParts, attachments } = mcpToolOutputParts(result.content)

                  const truncated = yield* deps.truncate.output(textParts.join("\n\n"), {}, input.agent)
                  const metadata = {
                    ...result.metadata,
                    truncated: truncated.truncated,
                    ...(truncated.truncated && { outputPath: truncated.outputPath }),
                  }

                  const output = {
                    title: "",
                    metadata,
                    output: truncated.content,
                    attachments: attachments.map((attachment) => ({
                      ...attachment,
                      id: PartID.ascending(),
                      sessionID: ctx.sessionID,
                      messageID: input.processor.message.id,
                    })),
                    content: result.content,
                  }
                  yield* input.processor.completeToolCall(toolCallId, output)
                  return output
                }),
              ),
          )
        }
        tools[key] = item
      }

      return tools
    })
  }

  private context(args: any, options: ToolExecutionOptions): Tool.Context {
    return {
      sessionID: this.input.session.id,
      abort: options.abortSignal ?? AbortSignal.abort(new Error("abortSignal is required for tool execution")),
      messageID: this.input.processor.message.id,
      callID: options.toolCallId,
      extra: { model: this.input.model, bypassAgentCheck: this.input.bypassAgentCheck, promptOps: this.deps.promptOps },
      agent: this.input.agent.name,
      messages: this.input.messages,
      metadata: (val) =>
        this.input.processor.updateToolCall(options.toolCallId, (match) => {
          if (!["running", "pending"].includes(match.state.status)) return match
          return {
            ...match,
            state: {
              title: val.title,
              metadata: val.metadata,
              status: "running",
              input: args,
              time: { start: Date.now() },
            },
          }
        }),
      ask: (req) =>
        this.deps.permission
          .ask({
            ...req,
            sessionID: this.input.session.id,
            tool: { messageID: this.input.processor.message.id, callID: options.toolCallId },
            ruleset: Permission.merge(this.input.agent.permission, this.input.session.permission ?? []),
          })
          .pipe(Effect.orDie),
    }
  }
}
