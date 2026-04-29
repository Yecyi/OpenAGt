import { Bus } from "@/bus"
import * as Session from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "../provider"
import { MessageV2 } from "./message-v2"
import { Log } from "../util"
import { SessionProcessor } from "./processor"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config"
import { NotFoundError } from "@/storage"
import { ModelID, ProviderID } from "@/provider/schema"
import { Effect, Layer, Context, Option } from "effect"
import { InstanceState } from "@/effect"
import { isOverflow as overflow } from "./overflow"
import { summarizeToolResult } from "./compaction/micro"
import { buildCompactContext, formatCompactPrompt, DEFAULT_FULL_COMPACT_CONFIG } from "./compaction/full"
import { compactionCoordinator } from "./compaction/coordinator"
import { compressionTracker } from "./compaction/metrics"
import { autoContinueText, replayPartForCompaction, selectOverflowReplay } from "./compaction-replay"
import {
  COMPACTION_CIRCUIT_FAILURES,
  Event,
  PRUNE_MINIMUM,
  PRUNE_PROTECTED_TOOLS,
  type Interface,
} from "./compaction-contracts"
export * from "./compaction-contracts"

const log = Log.create({ service: "session.compaction" })

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

export const layer: Layer.Layer<
  Service,
  never,
  | Bus.Service
  | Config.Service
  | Session.Service
  | Agent.Service
  | Plugin.Service
  | SessionProcessor.Service
  | Provider.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const plugin = yield* Plugin.Service
    const processors = yield* SessionProcessor.Service
    const provider = yield* Provider.Service
    const compactionEpoch = new Map<SessionID, number>()
    const compactionFailures = new Map<SessionID, number>()

    const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
      tokens: MessageV2.Assistant["tokens"]
      model: Provider.Model
    }) {
      return overflow({ cfg: yield* config.get(), tokens: input.tokens, model: input.model })
    })

    // Three-layer compaction:
    // Layer 1: MicroCompact - time-based pruning of old tool results (no LLM call)
    // Layer 2: AutoCompact - token-based pruning when approaching context limit (no LLM call)
    // Layer 3: Full Compact - LLM summarization when context is exceeded (LLM call)
    const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
      const cfg = yield* config.get()
      if (cfg.compaction?.prune === false) return
      log.info("pruning (three-layer)")

      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs) return

      // Get model info for coordinator decision
      const currentUser = msgs.findLast((item) => item.info.role === "user")
      if (!currentUser) return
      const currentUserInfo = currentUser.info as MessageV2.User
      const modelResult = yield* provider
        .getModel(currentUserInfo.model.providerID, currentUserInfo.model.modelID)
        .pipe(Effect.option)
      if (Option.isNone(modelResult)) return

      // Use coordinator to decide which layer to run
      const decision = compactionCoordinator.decide(msgs, modelResult.value)
      log.info("compaction decision", { layer: decision.layer, reason: decision.reason })

      if (!decision.shouldCompact) {
        let legacyCompacted = 0
        const now = Date.now()
        for (let index = 0; index < msgs.length; index++) {
          const msg = msgs[index]
          const trailingUsers = msgs.slice(index + 1).filter((item) => item.info.role === "user").length
          if (trailingUsers < 2) continue
          for (const part of msg.parts) {
            if (part.type !== "tool") continue
            if (part.state.status !== "completed") continue
            if (part.state.time.compacted) continue
            if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
            if ((part.state.output?.length ?? 0) < PRUNE_MINIMUM) continue

            const summary = summarizeToolResult(part.state.output ?? "", part.tool)
            yield* session.updatePart({
              ...part,
              state: {
                ...part.state,
                output: summary.summary,
                time: {
                  ...part.state.time,
                  compacted: now,
                },
                metadata: {
                  ...part.state.metadata,
                  legacy_pruned: true,
                  original_length: summary.originalLength,
                },
              },
            })
            legacyCompacted++
          }
        }
        if (legacyCompacted > 0) {
          log.info("legacy prune applied", { compacted: legacyCompacted })
          return
        }
        log.info("no compaction needed", { reason: decision.reason })
        return
      }

      // LAYER 1: MicroCompact - time-based compaction
      if (decision.layer === "micro") {
        const { updatedMessages, compactedCount, tokensSaved } = compactionCoordinator.applyMicroCompact(msgs)

        for (const msg of updatedMessages) {
          for (const part of msg.parts) {
            yield* session.updatePart(part)
          }
        }

        log.info("layer-1 micro-compacted", { count: compactedCount, tokensSaved })
        compressionTracker.recordCompression("micro", tokensSaved, Math.floor(tokensSaved * 0.5))
        return
      }

      // LAYER 2: AutoCompact - token-based pruning
      if (decision.layer === "auto" && decision.targetTokens) {
        const { updatedMessages, compactedCount, tokensSaved } = compactionCoordinator.applyAutoCompact(
          msgs,
          decision.targetTokens,
        )

        for (const msg of updatedMessages) {
          for (const part of msg.parts) {
            yield* session.updatePart(part)
          }
        }

        log.info("layer-2 auto-compacted", { count: compactedCount, tokensSaved })
        compressionTracker.recordCompression("auto", tokensSaved, Math.floor(tokensSaved * 0.3))
        return
      }

      // LAYER 3: Full Compact is handled by process() method, not here
      // Log that full compaction is needed
      if (decision.layer === "full") {
        log.info("layer-3 full-compact needed", { reason: decision.reason })
      }
    })

    const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
      parentID: MessageID
      messages: MessageV2.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
    }) {
      if ((compactionFailures.get(input.sessionID) ?? 0) >= COMPACTION_CIRCUIT_FAILURES) {
        log.error("compaction circuit open", { sessionID: input.sessionID })
        return "stop"
      }
      const epoch = (compactionEpoch.get(input.sessionID) ?? 0) + 1
      compactionEpoch.set(input.sessionID, epoch)
      const parent = input.messages.findLast((m) => m.info.id === input.parentID)
      if (!parent || parent.info.role !== "user") {
        throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
      }
      const userMessage = parent.info

      const replaySelection = selectOverflowReplay(input)
      const messages = replaySelection.messages
      const replay = replaySelection.replay

      const agent = yield* agents.get("compaction")
      const model = agent.model
        ? yield* provider.getModel(agent.model.providerID, agent.model.modelID)
        : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
      // Allow plugins to inject context or replace compaction prompt.
      const compacting = yield* plugin.trigger(
        "experimental.session.compacting",
        { sessionID: input.sessionID },
        { context: [], prompt: undefined },
      )
      const compactContext = buildCompactContext(messages, DEFAULT_FULL_COMPACT_CONFIG)
      const defaultPrompt = formatCompactPrompt(compactContext, DEFAULT_FULL_COMPACT_CONFIG)
      const prompt = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")
      const msgs = structuredClone(messages)
      yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
      const modelMessages = yield* MessageV2.toModelMessagesEffect(msgs, model, { stripMedia: true })
      const ctx = yield* InstanceState.context
      const msg: MessageV2.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        parentID: input.parentID,
        sessionID: input.sessionID,
        mode: "compaction",
        agent: "compaction",
        variant: userMessage.model.variant,
        summary: true,
        path: {
          cwd: ctx.directory,
          root: ctx.worktree,
        },
        cost: 0,
        tokens: {
          output: 0,
          input: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: model.id,
        providerID: model.providerID,
        time: {
          created: Date.now(),
        },
      }
      yield* session.updateMessage(msg)
      const processor = yield* processors.create({
        assistantMessage: msg,
        sessionID: input.sessionID,
        model,
      })
      const noToolSystem =
        "You are in a conversation summarization mode. Do not call any tools. Respond only with the requested summary text."

      const result = yield* processor.process({
        user: userMessage,
        agent,
        sessionID: input.sessionID,
        tools: {},
        system: [noToolSystem],
        messages: [
          ...modelMessages,
          {
            role: "user",
            content: [{ type: "text", text: prompt }],
          },
        ],
        model,
        toolChoice: "none",
      })

      if (compactionEpoch.get(input.sessionID) !== epoch) {
        log.warn("compaction epoch superseded", { sessionID: input.sessionID, epoch })
        return "stop"
      }

      if (result === "compact") {
        compactionFailures.set(input.sessionID, (compactionFailures.get(input.sessionID) ?? 0) + 1)
        processor.message.error = new MessageV2.ContextOverflowError({
          message: replay
            ? "Conversation history too large to compact - exceeds model context limit"
            : "Session too large to compact - context exceeds model limit even after stripping media",
        }).toObject()
        processor.message.finish = "error"
        yield* session.updateMessage(processor.message)
        return "stop"
      }

      if (result === "continue" && input.auto) {
        if (replay) {
          const original = replay.info
          const replayMsg = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: input.sessionID,
            time: { created: Date.now() },
            agent: original.agent,
            model: original.model,
            format: original.format,
            tools: original.tools,
            system: original.system,
          })
          for (const part of replay.parts) {
            if (part.type === "compaction") continue
            const replayPart = replayPartForCompaction(part)
            yield* session.updatePart({
              ...replayPart,
              id: PartID.ascending(),
              messageID: replayMsg.id,
              sessionID: input.sessionID,
            })
          }
        }

        if (!replay) {
          const info = yield* provider.getProvider(userMessage.model.providerID)
          if (
            (yield* plugin.trigger(
              "experimental.compaction.autocontinue",
              {
                sessionID: input.sessionID,
                agent: userMessage.agent,
                model: yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID),
                provider: {
                  source: info.source,
                  info,
                  options: info.options,
                },
                message: userMessage,
                overflow: input.overflow === true,
              },
              { enabled: true },
            )).enabled
          ) {
            const continueMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: userMessage.agent,
              model: userMessage.model,
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: continueMsg.id,
              sessionID: input.sessionID,
              type: "text",
              // Internal marker for auto-compaction followups so provider plugins
              // can distinguish them from manual post-compaction user prompts.
              // This is not a stable plugin contract and may change or disappear.
              metadata: { compaction_continue: true },
              synthetic: true,
              text: autoContinueText(input.overflow === true),
              time: {
                start: Date.now(),
                end: Date.now(),
              },
            })
          }
        }
      }

      if (processor.message.error) {
        compactionFailures.set(input.sessionID, (compactionFailures.get(input.sessionID) ?? 0) + 1)
        return "stop"
      }
      if (result === "continue") {
        compactionFailures.delete(input.sessionID)
        yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
      }
      return result
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderID; modelID: ModelID }
      auto: boolean
      overflow?: boolean
    }) {
      const msg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
      })
    })

    return Service.of({
      isOverflow,
      prune,
      process: processCompaction,
      create,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
  ),
)

export * as SessionCompaction from "./compaction"
