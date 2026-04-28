// Runs one task-tool subtask created from a model-emitted subtask part.
// It does not select prompt tools, stream providers, or alter task tool contracts.
import { ulid } from "ulid"
import { Cause, Effect, Exit } from "effect"
import { NamedError } from "@openagt/shared/util/error"
import { Agent } from "../../agent/agent"
import { Bus } from "../../bus"
import { Permission } from "../../permission"
import { Plugin } from "../../plugin"
import { Provider } from "../../provider"
import type { ModelID, ProviderID } from "../../provider/schema"
import { ToolRegistry } from "../../tool"
import { TaskTool, type TaskPromptOps } from "../../tool/task"
import type { InstanceContext } from "../../project/instance"
import * as Session from "../session"
import { MessageV2 } from "../message-v2"
import { MessageID, PartID, type SessionID } from "../schema"

export type PromptSubtaskRunnerInput = {
  task: MessageV2.SubtaskPart
  model: Provider.Model
  lastUser: MessageV2.User
  sessionID: SessionID
  session: Session.Info
  msgs: MessageV2.WithParts[]
}

type PromptSubtaskRunnerLog = {
  error: (message?: unknown, data?: Record<string, unknown>) => void
}

export class PromptSubtaskRunner {
  constructor(
    private readonly deps: {
      agents: Agent.Interface
      bus: Bus.Interface
      getModel: (providerID: ProviderID, modelID: ModelID, sessionID: SessionID) => Effect.Effect<Provider.Model>
      instance: Pick<InstanceContext, "directory" | "worktree">
      log: PromptSubtaskRunnerLog
      permission: Permission.Interface
      plugin: Plugin.Interface
      promptOps: TaskPromptOps
      registry: ToolRegistry.Interface
      sessions: Session.Interface
    },
    private readonly input: PromptSubtaskRunnerInput,
  ) {}

  run(): Effect.Effect<void> {
    const deps = this.deps
    const input = this.input
    return Effect.gen(function* () {
      const task = input.task
      const { task: taskTool } = yield* deps.registry.named()
      const requestedModel = task.model
        ? { providerID: task.model.providerID, modelID: task.model.modelID }
        : { providerID: input.model.providerID, modelID: input.model.id }
      const assistantMessage: MessageV2.Assistant = yield* deps.sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: input.lastUser.id,
        sessionID: input.sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: input.lastUser.model.variant,
        path: { cwd: deps.instance.directory, root: deps.instance.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: requestedModel.modelID,
        providerID: requestedModel.providerID,
        time: { created: Date.now() },
      })
      let part: MessageV2.ToolPart = yield* deps.sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          title: task.description,
          metadata: {
            sessionId: assistantMessage.sessionID,
            model: requestedModel,
          },
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* deps.plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID: input.sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* deps.agents.get(task.agent)
      if (!taskAgent) {
        const available = (yield* deps.agents.list()).filter((agent) => !agent.hidden).map((agent) => agent.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* deps.bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* Effect.gen(function* () {
        const taskModel = task.model
          ? yield* deps.getModel(task.model.providerID, task.model.modelID, input.sessionID)
          : input.model
        if (assistantMessage.modelID !== taskModel.id || assistantMessage.providerID !== taskModel.providerID) {
          assistantMessage.modelID = taskModel.id
          assistantMessage.providerID = taskModel.providerID
          yield* deps.sessions.updateMessage(assistantMessage)
        }
        const execution = taskTool.execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID: input.sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps: deps.promptOps },
          messages: input.msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              const baseMetadata = "metadata" in part.state && part.state.metadata ? part.state.metadata : {}
              const nextState =
                part.state.status === "pending"
                  ? {
                      status: "running" as const,
                      input: part.state.input,
                      title: val.title,
                      metadata: {
                        sessionId: assistantMessage.sessionID,
                        model: requestedModel,
                        ...baseMetadata,
                        ...val.metadata,
                      },
                      time: { start: Date.now() },
                    }
                  : {
                      ...part.state,
                      ...val,
                      metadata: {
                        sessionId: assistantMessage.sessionID,
                        model: requestedModel,
                        ...baseMetadata,
                        ...val.metadata,
                      },
                    }
              part = yield* deps.sessions.updatePart({
                ...part,
                type: "tool",
                state: nextState,
              } satisfies MessageV2.ToolPart)
            }),
          ask: (req: any) =>
            deps.permission
              .ask({
                ...req,
                sessionID: input.sessionID,
                ruleset: Permission.merge(taskAgent.permission, input.session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        const exit = yield* execution.pipe(Effect.exit)
        if (Exit.isSuccess(exit)) return exit.value
        const defect = Cause.squash(exit.cause)
        error = defect instanceof Error ? defect : new Error(String(defect))
        deps.log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
        return undefined
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            taskAbort.abort()
            assistantMessage.finish = "tool-calls"
            assistantMessage.time.completed = Date.now()
            yield* deps.sessions.updateMessage(assistantMessage)
            if (part.state.status === "running") {
              yield* deps.sessions.updatePart({
                ...part,
                state: {
                  status: "error",
                  error: "Cancelled",
                  time: { start: part.state.time.start, end: Date.now() },
                  metadata: part.state.metadata,
                  input: part.state.input,
                },
              } satisfies MessageV2.ToolPart)
            }
          }),
        ),
      )

      const attachments: MessageV2.FilePart[] | undefined = result?.attachments?.map((attachment) => ({
        id: PartID.ascending(),
        sessionID: input.sessionID,
        messageID: assistantMessage.id,
        type: "file" as const,
        mime: attachment.mime ?? "application/octet-stream",
        filename: attachment.filename,
        url: attachment.url ?? "",
      }))

      yield* deps.plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID: input.sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* deps.sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* deps.sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies MessageV2.ToolPart)
      }

      if (!result) {
        yield* deps.sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies MessageV2.ToolPart)
      }

      if (!task.command) return

      const summaryUserMsg: MessageV2.User = {
        id: MessageID.ascending(),
        sessionID: input.sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: input.lastUser.agent,
        model: input.lastUser.model,
      }
      yield* deps.sessions.updateMessage(summaryUserMsg)
      yield* deps.sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID: input.sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies MessageV2.TextPart)
    })
  }
}
