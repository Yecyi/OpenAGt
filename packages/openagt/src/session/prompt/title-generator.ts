// Generates a session title from the first real user message.
// It does not change run-loop flow, message persistence rules, or title agent/model selection.

import { Cause, Effect } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider"
import type { ModelID, ProviderID } from "../../provider/schema"
import { LLM } from "../llm"
import { MessageV2 } from "../message-v2"
import * as Session from "../session"

export type PromptTitleGeneratorInput = {
  session: Session.Info
  history: MessageV2.WithParts[]
  providerID: ProviderID
  modelID: ModelID
}

type PromptTitleGeneratorLog = {
  error: (message?: unknown, data?: Record<string, unknown>) => Effect.Effect<void>
}

export class PromptTitleGenerator {
  constructor(
    private readonly deps: {
      agents: Agent.Interface
      llm: LLM.Interface
      provider: Provider.Interface
      sessions: Session.Interface
      log: PromptTitleGeneratorLog
    },
  ) {}

  run(input: PromptTitleGeneratorInput): Effect.Effect<void> {
    const deps = this.deps
    return Effect.gen(function* () {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: MessageV2.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return
      if (input.history.filter(real).length !== 1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is MessageV2.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* deps.agents.get("title")
      if (!ag) return
      const mdl = ag.model
        ? yield* deps.provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* deps.provider.getSmallModel(input.providerID)) ??
          (yield* deps.provider.getModel(input.providerID, input.modelID)))
      const msgs = onlySubtasks
        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
        : yield* MessageV2.toModelMessagesEffect(context, mdl)
      const text = yield* deps.llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
        })
        .pipe(
          Stream.filter((e): e is Extract<LLM.Event, { type: "text-delta" }> => e.type === "text-delta"),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
        )
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* deps.sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => deps.log.error("failed to generate title", { error: Cause.squash(cause) })))
    })
  }
}
