// Builds tool compatibility helpers for LLM requests.
// It does not stream model output, resolve providers, or ask permissions.
import { Record } from "effect"
import { jsonSchema, tool, type ModelMessage, type Tool } from "ai"
import { Permission } from "@/permission"
import type { Provider } from "@/provider"
import type { StreamInput } from "./llm"

export function resolveTools(
  input: Pick<StreamInput, "tools" | "agent" | "permission" | "user">,
): Record<string, Tool> {
  const disabled = Permission.disabled(
    Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []),
  )
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
}

export function isLiteLLMProxy(input: { model: Provider.Model; providerOptions?: Record<string, unknown> }): boolean {
  return (
    input.providerOptions?.["litellmProxy"] === true ||
    input.model.providerID.toLowerCase().includes("litellm") ||
    input.model.api.id.toLowerCase().includes("litellm")
  )
}

export function shouldInjectNoopTool(input: {
  model: Provider.Model
  providerOptions?: Record<string, unknown>
  tools: Record<string, Tool>
  messages: ModelMessage[]
}): boolean {
  return (
    (isLiteLLMProxy(input) || input.model.providerID.includes("github-copilot")) &&
    Object.keys(input.tools).length === 0 &&
    hasToolCalls(input.messages)
  )
}

export function createNoopTool(): Tool {
  return tool({
    description: "Do not call this tool. It exists only for API compatibility and must never be invoked.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        reason: { type: "string", description: "Unused" },
      },
    }),
    execute: async () => ({
      output: "",
      title: "",
      metadata: {},
    }),
  })
}

// Check if messages contain any tool-call content.
// Used to determine if a dummy tool should be added for LiteLLM proxy compatibility.
export function hasToolCalls(messages: ModelMessage[]): boolean {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === "tool-call" || part.type === "tool-result") return true
    }
  }
  return false
}
