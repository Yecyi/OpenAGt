import { EffectLogger } from "@/effect"
import type { Provider } from "@/provider"
import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai"
import { Effect } from "effect"
import type { WithParts } from "./message-v2"
import {
  convertAssistantMessage,
  convertUserMessage,
  supportsMediaInToolResults,
  synthesizeMediaMessage,
  toModelOutput,
} from "./to-model-messages"

export const toModelMessagesEffect = Effect.fnUntraced(function* (
  input: WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean },
) {
  const result: UIMessage[] = []
  const toolNames = new Set<string>()
  const supportsMedia = supportsMediaInToolResults(model)

  for (const msg of input) {
    if (msg.parts.length === 0) continue

    if (msg.info.role === "user") {
      const userMessage = convertUserMessage(msg, options)
      if (userMessage) result.push(userMessage)
    }

    if (msg.info.role === "assistant") {
      const converted = convertAssistantMessage(msg, model, supportsMedia, options)
      if (converted) {
        result.push(converted.uiMessage)
        for (const t of converted.addedTools) toolNames.add(t)
        if (converted.media.length > 0) {
          result.push(synthesizeMediaMessage(converted.media))
        }
      }
    }
  }

  const tools = Object.fromEntries(Array.from(toolNames).map((toolName) => [toolName, { toModelOutput }]))

  return yield* Effect.promise(() =>
    convertToModelMessages(
      result.filter((msg) => msg.parts.some((part) => part.type !== "step-start")),
      {
        // @ts-expect-error -- convertToModelMessages expects ToolSet but only actually needs tools[name]?.toModelOutput
        tools,
      },
    ),
  )
})

export function toModelMessages(
  input: WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean },
): Promise<ModelMessage[]> {
  return Effect.runPromise(toModelMessagesEffect(input, model, options).pipe(Effect.provide(EffectLogger.layer)))
}
