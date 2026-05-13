import os from "os"
import z from "zod"
import { CommandInput, LoopInput, PromptInput, ShellInput } from "./prompt-inputs"
export { CommandInput, LoopInput, PromptInput, ShellInput } from "./prompt-inputs"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Log } from "../util"
import { SessionRevert } from "./revert"
import * as Session from "./session"
import { Agent } from "../agent/agent"
import { Provider, ProviderFallback } from "../provider"
import { ModelID, ProviderID } from "../provider/schema"
import { SessionCompaction } from "./compaction"
import { Bus } from "../bus"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import { ToolRegistry } from "../tool"
import { MCP } from "../mcp"
import { LSP } from "../lsp"
import { ChildProcessSpawner } from "effect/unstable/process"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { Command } from "../command"
import { ConfigMarkdown } from "../config"
import { SessionSummary } from "./summary"
import { NamedError } from "@openagt/shared/util/error"
import { SessionProcessor } from "./processor"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { Truncate } from "@/tool"
import { Cause, Effect, Exit, Layer, Option, Scope, Context } from "effect"
import { EffectLogger } from "@/effect"
import { InstanceState } from "@/effect"
import { attachWith } from "@/effect/run-service"
import type { TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { EffectBridge } from "@/effect"
import { PromptCommandRunner } from "./prompt/command-runner"
import { PromptPartResolver, type PromptPartDraft } from "./prompt/part-resolver"
import { promptReferenceFilePart, promptReferencePath } from "./prompt/reference-parts"
import { PromptShellRunner, type PromptShellRunnerInput } from "./prompt/shell-runner"
import { PromptSubtaskRunner, type PromptSubtaskRunnerInput } from "./prompt/subtask-runner"
import { PromptToolResolver, type PromptToolResolverInput } from "./prompt/tool-resolver"
import { PromptTitleGenerator, type PromptTitleGeneratorInput } from "./prompt/title-generator"
import { PromptReminderInserter, type PromptReminderInserterInput } from "./prompt/reminder-inserter"
import { PromptRunLoopController } from "./prompt/run-loop-controller"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const log = Log.create({ service: "session.prompt" })
const elog = EffectLogger.create({ service: "session.prompt" })

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts>
  readonly loop: (input: z.infer<typeof LoopInput>) => Effect.Effect<MessageV2.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts>
  readonly command: (input: CommandInput) => Effect.Effect<MessageV2.WithParts>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const providerFallback = yield* ProviderFallback.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const permission = yield* Permission.Service
    const fsys = yield* AppFileSystem.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const runner = Effect.fn("SessionPrompt.runner")(function* () {
      return yield* EffectBridge.make()
    })
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      const run = yield* runner()
      return {
        cancel: (sessionID: SessionID) => run.fork(cancel(sessionID)),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input),
      } satisfies TaskPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* elog.info("cancel", { sessionID })
      yield* state.cancel(sessionID)
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: PromptInput["parts"] = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (seen.has(name)) return
          seen.add(name)
          const filepath = promptReferencePath({ name, worktree: ctx.worktree, homeDir: os.homedir })

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push(promptReferenceFilePart({ name, filepath, fileType: stat.type }))
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const titleGenerator = new PromptTitleGenerator({ agents, llm, provider, sessions, log: elog })
    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: PromptTitleGeneratorInput) {
      yield* titleGenerator.run(input)
    })

    const reminderInserter = new PromptReminderInserter({ fsys, sessions })
    const insertReminders = Effect.fn("SessionPrompt.insertReminders")(function* (input: PromptReminderInserterInput) {
      return yield* reminderInserter.run(input)
    })

    const resolveTools = Effect.fn("SessionPrompt.resolveTools")(function* (input: PromptToolResolverInput) {
      using _ = log.time("resolveTools")
      const run = yield* runner()
      const promptOps = yield* ops()
      return yield* new PromptToolResolver(
        { mcp, permission, plugin, registry, run, truncate, promptOps },
        input,
      ).resolve()
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: PromptSubtaskRunnerInput) {
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops()
      return yield* new PromptSubtaskRunner(
        {
          agents,
          bus,
          getModel,
          instance: ctx,
          log,
          permission,
          plugin,
          promptOps,
          registry,
          sessions,
        },
        input,
      ).run()
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: PromptShellRunnerInput) {
      const ctx = yield* InstanceState.context
      const run = yield* runner()
      return yield* new PromptShellRunner(
        { agents, bus, instance: ctx, lastModel, plugin, revert, run, sessions, spawner },
        input,
      ).run()
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderID,
      modelID: ModelID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.data.suggestions?.length ? ` Did you mean: ${err.data.suggestions.join(", ")}?` : ""
        yield* bus.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.data.providerID}/${err.data.modelID}.${hint}`,
          }).toObject(),
        })
      }
      return yield* Effect.failCause(exit.cause)
    })

    const lastModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel()
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent || (yield* agents.defaultAgent())
      const ag = yield* agents.get(agentName)
      if (!ag) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const model = input.model ?? ag.model ?? (yield* lastModel(input.sessionID))
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider
              .getModel(model.providerID, model.modelID)
              .pipe(Effect.option)
              .pipe(Effect.map(Option.getOrUndefined))
          : undefined
      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

      const info: MessageV2.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        format: input.format,
        runtime: input.runtime,
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      const assign = (part: PromptPartDraft): MessageV2.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const resolver = new PromptPartResolver(
        { bus, fsys, log, lsp, mcp, provider, registry },
        {
          agent: ag,
          inputAgent: input.agent,
          messageID: info.id,
          model: info.model,
          sessionID: input.sessionID,
        },
      )
      const resolvePart = (part: PromptInput["parts"][number]) => resolver.resolve(part)

      const parts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts },
      )

      const parsed = MessageV2.Info.safeParse(info)
      if (!parsed.success) {
        log.error("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          issues: parsed.error.issues,
        })
      }
      parts.forEach((part, index) => {
        const p = MessageV2.Part.safeParse(part)
        if (p.success) return
        log.error("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          issues: p.error.issues,
          part,
        })
      })

      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)

      return { info, parts }
    }, Effect.scoped)

    const prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.prompt")(
      function* (input: PromptInput) {
        const session = yield* sessions.get(input.sessionID)
        yield* revert.cleanup(session)
        const message = yield* createUserMessage(input)
        yield* sessions.touch(input.sessionID)

        const permissions: Permission.Ruleset = []
        for (const [t, enabled] of Object.entries(input.tools ?? {})) {
          permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
        }
        if (permissions.length > 0) {
          session.permission = permissions
          yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
        }

        if (input.noReply === true) return message
        return yield* loop({ sessionID: input.sessionID })
      },
    )

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user")
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 })
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    const runLoopController = new PromptRunLoopController({
      agents,
      bus,
      compaction,
      getModel,
      handleSubtask,
      insertReminders,
      instruction,
      lastAssistant,
      log: elog,
      plugin,
      processor,
      providerFallback,
      resolveTools,
      scope,
      sessions,
      status,
      summary,
      sys,
      title,
    })
    const runLoop: (sessionID: SessionID) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.run")(
      (sessionID: SessionID) => runLoopController.run(sessionID),
    )

    const loop: (input: z.infer<typeof LoopInput>) => Effect.Effect<MessageV2.WithParts> = Effect.fn(
      "SessionPrompt.loop",
    )(function* (input: z.infer<typeof LoopInput>) {
      const instance = yield* InstanceState.context
      const workspace = yield* InstanceState.workspaceID
      return yield* state.ensureRunning(
        input.sessionID,
        attachWith(lastAssistant(input.sessionID), { instance, workspace }),
        attachWith(runLoop(input.sessionID), { instance, workspace }),
      )
    })

    const shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.shell")(
      function* (input: ShellInput) {
        const instance = yield* InstanceState.context
        const workspace = yield* InstanceState.workspaceID
        const fallback = attachWith(lastAssistant(input.sessionID), { instance, workspace })
        return yield* state
          .startShell(input.sessionID, fallback, attachWith(shellImpl(input), { instance, workspace }))
          .pipe(
            Effect.catchCauseIf(
              (cause) => {
                const error = Cause.squash(cause)
                const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
                return Cause.hasInterrupts(cause) || /abort|cancel|interrupt/i.test(message)
              },
              () => fallback,
            ),
          )
      },
    )

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      return yield* new PromptCommandRunner(
        {
          agents,
          bus,
          commands,
          getModel,
          lastModel,
          log: elog,
          plugin,
          prompt,
          resolvePromptParts,
        },
        input,
      ).run()
    })

    return Service.of({
      cancel,
      prompt,
      loop,
      shell,
      command,
      resolvePromptParts,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(SessionCompaction.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(ToolRegistry.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(ProviderFallback.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(
      Layer.mergeAll(
        Agent.defaultLayer,
        SystemPrompt.defaultLayer,
        LLM.defaultLayer,
        Bus.layer,
        CrossSpawnSpawner.defaultLayer,
      ),
    ),
  ),
)
export { parseFilePartRange } from "./prompt/file-range"
export { createStructuredOutputTool } from "./prompt/structured-output"
export * as SessionPrompt from "./prompt"
