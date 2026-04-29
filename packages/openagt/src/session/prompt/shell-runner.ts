// Runs a user-requested shell command as a synthetic bash tool message.
// It does not route slash commands, resolve prompt parts, or apply bash tool permissions.
import path from "path"
import { ulid } from "ulid"
import { Cause, Effect, Exit } from "effect"
import * as Stream from "effect/Stream"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { NamedError } from "@openagt/shared/util/error"
import { Agent } from "../../agent/agent"
import { Bus } from "../../bus"
import { EffectBridge } from "../../effect"
import type { InstanceContext } from "../../project/instance"
import { Provider } from "../../provider"
import { ModelID, ProviderID } from "../../provider/schema"
import { Plugin } from "../../plugin"
import { Shell } from "../../shell/shell"
import * as Session from "../session"
import { SessionRevert } from "../revert"
import { MessageV2 } from "../message-v2"
import { MessageID, PartID, type SessionID } from "../schema"

export type PromptShellRunnerInput = {
  sessionID: SessionID
  messageID?: MessageID
  agent: string
  model?: {
    providerID: ProviderID
    modelID: ModelID
  }
  command: string
}

function shellInvocationArgs(shell: string, command: string): string[] {
  const shellName = (
    process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
  ).toLowerCase()
  const invocations: Record<string, { args: string[] }> = {
    nu: { args: ["-c", command] },
    fish: { args: ["-c", command] },
    zsh: {
      args: [
        "-l",
        "-c",
        `
              __oc_cwd=$PWD
              [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
              [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
              cd "$__oc_cwd"
              eval ${JSON.stringify(command)}
            `,
      ],
    },
    bash: {
      args: [
        "-l",
        "-c",
        `
              __oc_cwd=$PWD
              shopt -s expand_aliases
              [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
              cd "$__oc_cwd"
              eval ${JSON.stringify(command)}
            `,
      ],
    },
    cmd: { args: ["/c", command] },
    powershell: { args: ["-NoProfile", "-Command", command] },
    pwsh: { args: ["-NoProfile", "-Command", command] },
    "": { args: ["-c", command] },
  }
  return (invocations[shellName] ?? invocations[""]).args
}

function shellUserMessage(input: PromptShellRunnerInput, model: { providerID: ProviderID; modelID: ModelID }): MessageV2.User {
  return {
    id: input.messageID ?? MessageID.ascending(),
    sessionID: input.sessionID,
    time: { created: Date.now() },
    role: "user",
    agent: input.agent,
    model: { providerID: model.providerID, modelID: model.modelID },
  }
}

function shellUserPart(userMsg: MessageV2.User): MessageV2.Part {
  return {
    type: "text",
    id: PartID.ascending(),
    messageID: userMsg.id,
    sessionID: userMsg.sessionID,
    text: "The following tool was executed by the user",
    synthetic: true,
  }
}

function shellAssistantMessage(input: {
  userMsg: MessageV2.User
  agent: string
  model: { providerID: ProviderID; modelID: ModelID }
  instance: Pick<InstanceContext, "directory" | "worktree">
}): MessageV2.Assistant {
  return {
    id: MessageID.ascending(),
    sessionID: input.userMsg.sessionID,
    parentID: input.userMsg.id,
    mode: input.agent,
    agent: input.agent,
    cost: 0,
    path: { cwd: input.instance.directory, root: input.instance.worktree },
    time: { created: Date.now() },
    role: "assistant",
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: input.model.modelID,
    providerID: input.model.providerID,
  }
}

function shellToolPart(input: { msg: MessageV2.Assistant; command: string }): MessageV2.ToolPart {
  return {
    type: "tool",
    id: PartID.ascending(),
    messageID: input.msg.id,
    sessionID: input.msg.sessionID,
    tool: "bash",
    callID: ulid(),
    state: {
      status: "running",
      time: { start: Date.now() },
      input: { command: input.command },
    },
  }
}

export class PromptShellRunner {
  constructor(
    private readonly deps: {
      agents: Agent.Interface
      bus: Bus.Interface
      instance: Pick<InstanceContext, "directory" | "worktree">
      lastModel: (sessionID: SessionID) => Effect.Effect<{ providerID: ProviderID; modelID: ModelID }>
      plugin: Plugin.Interface
      revert: SessionRevert.Interface
      run: EffectBridge.Shape
      sessions: Session.Interface
      spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
    },
    private readonly input: PromptShellRunnerInput,
  ) {}

  run(): Effect.Effect<MessageV2.WithParts> {
    const deps = this.deps
    const input = this.input
    return Effect.gen(function* () {
      const session = yield* deps.sessions.get(input.sessionID)
      if (session.revert) {
        yield* deps.revert.cleanup(session)
      }
      const agent = yield* deps.agents.get(input.agent)
      if (!agent) {
        const available = (yield* deps.agents.list()).filter((item) => !item.hidden).map((item) => item.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
        yield* deps.bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const model = input.model ?? agent.model ?? (yield* deps.lastModel(input.sessionID))
      const userMsg = shellUserMessage(input, model)
      yield* deps.sessions.updateMessage(userMsg)
      yield* deps.sessions.updatePart(shellUserPart(userMsg))

      const msg = shellAssistantMessage({ userMsg, agent: input.agent, model, instance: deps.instance })
      yield* deps.sessions.updateMessage(msg)
      const part = shellToolPart({ msg, command: input.command })
      yield* deps.sessions.updatePart(part)

      const sh = Shell.preferred()
      const cwd = deps.instance.directory
      const shellEnv = yield* deps.plugin.trigger(
        "shell.env",
        { cwd, sessionID: input.sessionID, callID: part.callID },
        { env: {} },
      )

      const cmd = ChildProcess.make(sh, shellInvocationArgs(sh, input.command), {
        cwd,
        extendEnv: true,
        env: { ...shellEnv.env, TERM: "dumb" },
        stdin: "ignore",
        forceKillAfter: "3 seconds",
      })

      let output = ""
      let aborted = false
      let started = false

      const finish = Effect.uninterruptible(
        Effect.gen(function* () {
          if (aborted) {
            output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
          }
          if (!msg.time.completed) {
            msg.time.completed = Date.now()
            yield* deps.sessions.updateMessage(msg)
          }
          if (part.state.status === "running") {
            part.state = {
              status: "completed",
              time: { ...part.state.time, end: Date.now() },
              input: part.state.input,
              title: "",
              metadata: { output, description: "" },
              output,
            }
            yield* deps.sessions.updatePart(part)
          }
        }),
      )

      const exit = yield* Effect.gen(function* () {
        started = true
        const handle = yield* deps.spawner.spawn(cmd)
        yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
          Effect.sync(() => {
            output += chunk
            if (part.state.status === "running") {
              part.state.metadata = { output, description: "" }
              void deps.run.fork(deps.sessions.updatePart(part))
            }
          }),
        )
        yield* handle.exitCode
      }).pipe(
        Effect.scoped,
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            aborted = true
          }),
        ),
        Effect.orDie,
        Effect.ensuring(finish),
        Effect.exit,
      )

      if (Exit.isFailure(exit) && !started && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
        return yield* Effect.failCause(exit.cause)
      }

      return { info: msg, parts: [part] }
    })
  }
}
