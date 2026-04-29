import type { Agent } from "@/agent/agent"
import { Provider, ProviderTransform } from "@/provider"
import type { ModelMessage } from "ai"
import { mergeDeep, pipe } from "remeda"
import type { MessageV2 } from "./message-v2"
import { SystemPrompt } from "./system"

async function computeSHA256(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8)
}

export function buildInitialSystemPrompt(input: {
  agent: Agent.Info
  model: Provider.Model
  system: string[]
  user: MessageV2.User
}): string[] {
  return [
    ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
    ...input.system,
    ...(input.user.system ? [input.user.system] : []),
  ].filter((x) => x)
}

export function collapseSystemPromptForCaching(system: string[], header: string | undefined): void {
  if (system.length <= 2 || system[0] !== header) return
  const rest = system.slice(1)
  system.length = 0
  system.push(header, rest.join("\n"))
}

export function staticBlocksHash(system: string[]): Promise<string> {
  return computeSHA256(system.join(""))
}

export function buildModelOptions(input: {
  model: Provider.Model
  agent: Agent.Info
  user: MessageV2.User
  sessionID: string
  small?: boolean
  providerOptions: Record<string, unknown>
  staticBlocksHash: string
}): Record<string, any> {
  return pipe(
    input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: input.providerOptions,
          staticBlocksHash: input.staticBlocksHash,
        }),
    mergeDeep(input.model.options),
    mergeDeep(input.agent.options),
    mergeDeep(
      !input.small && input.model.variants && input.user.model.variant
        ? input.model.variants[input.user.model.variant]
        : {},
    ),
  )
}

export function buildModelMessages(input: {
  messages: ModelMessage[]
  system: string[]
  isOpenaiOauth: boolean
  isWorkflow: boolean
}): ModelMessage[] {
  if (input.isOpenaiOauth) return input.messages
  if (input.isWorkflow) return input.messages
  return [
    ...input.system.map(
      (x, index): ModelMessage => ({
        role: "system",
        content: x,
        providerOptions: {
          openagt: {
            cacheZone: index <= 1 ? "static" : index === 2 ? "semiStatic" : "dynamic",
          },
        },
      }),
    ),
    ...input.messages,
  ]
}
