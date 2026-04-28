// Runs one slash command by resolving its template, model, agent, and prompt parts.
// It does not own command registration, prompt persistence, or model provider execution.
import { Effect } from "effect"
import { NamedError } from "@openagt/shared/util/error"
import { Agent } from "../../agent/agent"
import { Bus } from "../../bus"
import { Command } from "../../command"
import { Plugin } from "../../plugin"
import { Provider } from "../../provider"
import type { ModelID, ProviderID } from "../../provider/schema"
import * as Session from "../session"
import type { MessageV2 } from "../message-v2"
import type { SessionID } from "../schema"
import type { CommandInput, PromptInput } from "../prompt"
import { expandCommandShellBlocks, renderCommandTemplate } from "./command-template"

type ModelRef = {
  providerID: ProviderID
  modelID: ModelID
}

export class PromptCommandRunner {
  constructor(
    private readonly deps: {
      agents: Agent.Interface
      bus: Bus.Interface
      commands: Command.Interface
      getModel: (providerID: ProviderID, modelID: ModelID, sessionID: SessionID) => Effect.Effect<Provider.Model>
      lastModel: (sessionID: SessionID) => Effect.Effect<ModelRef>
      log: { info: (message?: unknown, data?: Record<string, unknown>) => Effect.Effect<void> }
      plugin: Plugin.Interface
      prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts>
      resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
    },
    private readonly input: CommandInput,
  ) {}

  run(): Effect.Effect<MessageV2.WithParts> {
    const deps = this.deps
    const input = this.input
    const commandModel = (cmd: Command.Info) => this.commandModel(cmd)
    return Effect.gen(function* () {
      yield* deps.log.info("command", { sessionID: input.sessionID, command: input.command, agent: input.agent })
      const cmd = yield* deps.commands.get(input.command)
      if (!cmd) {
        const available = (yield* deps.commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* deps.bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const agentName = cmd.agent ?? input.agent ?? (yield* deps.agents.defaultAgent())
      const templateCommand = yield* Effect.promise(async () => cmd.template)
      const template = yield* expandCommandShellBlocks(
        renderCommandTemplate({ template: templateCommand, arguments: input.arguments }),
      )
      const taskModel = yield* commandModel(cmd)
      yield* deps.getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = yield* deps.agents.get(agentName)
      if (!agent) {
        const available = (yield* deps.agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* deps.bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const templateParts = yield* deps.resolvePromptParts(template)
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      const parts: PromptInput["parts"] = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...templateParts, ...(input.parts ?? [])]
      const userAgent = isSubtask ? (input.agent ?? (yield* deps.agents.defaultAgent())) : agentName
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* deps.lastModel(input.sessionID)
        : taskModel

      yield* deps.plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* deps.prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
      })
      yield* deps.bus.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })
  }

  private commandModel(cmd: Command.Info): Effect.Effect<ModelRef> {
    const deps = this.deps
    const input = this.input
    return Effect.gen(function* () {
      if (cmd.model) return Provider.parseModel(cmd.model)
      if (cmd.agent) {
        const cmdAgent = yield* deps.agents.get(cmd.agent)
        if (cmdAgent?.model) return cmdAgent.model
      }
      if (input.model) return Provider.parseModel(input.model)
      return yield* deps.lastModel(input.sessionID)
    })
  }
}
