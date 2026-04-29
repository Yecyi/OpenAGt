import { type UIMessage } from "ai"
import { MessageID } from "./schema"
import { isMedia } from "@/util/media"
import { iife } from "@/util/iife"
import type { Provider } from "@/provider"
import { AbortedError } from "./message-errors"
import type { WithParts } from "./message-v2"
import { SYNTHETIC_ATTACHMENT_PROMPT } from "./message-v2"

export function supportsMediaInToolResults(model: Provider.Model): boolean {
  if (model.api.npm === "@ai-sdk/anthropic") return true
  if (model.api.npm === "@ai-sdk/openai") return true
  if (model.api.npm === "@ai-sdk/amazon-bedrock") return true
  if (model.api.npm === "@ai-sdk/google-vertex/anthropic") return true
  if (model.api.npm === "@ai-sdk/google") {
    const id = model.api.id.toLowerCase()
    return id.includes("gemini-3") && !id.includes("gemini-2")
  }
  return false
}

export function toModelOutput(options: { toolCallId: string; input: unknown; output: unknown }) {
  const output = options.output
  if (typeof output === "string") {
    return { type: "text", value: output }
  }

  if (typeof output === "object") {
    const outputObject = output as {
      text: string
      attachments?: Array<{ mime: string; url: string }>
    }
    const attachments = (outputObject.attachments ?? []).filter((attachment) => {
      return attachment.url.startsWith("data:") && attachment.url.includes(",")
    })

    return {
      type: "content",
      value: [
        { type: "text", text: outputObject.text },
        ...attachments.map((attachment) => ({
          type: "media",
          mediaType: attachment.mime,
          data: iife(() => {
            const commaIndex = attachment.url.indexOf(",")
            return commaIndex === -1 ? attachment.url : attachment.url.slice(commaIndex + 1)
          }),
        })),
      ],
    }
  }

  return { type: "json", value: output as never }
}

function providerMeta(metadata: Record<string, any> | undefined) {
  if (!metadata) return undefined
  const { providerExecuted: _, ...rest } = metadata
  return Object.keys(rest).length > 0 ? rest : undefined
}

export function convertUserMessage(msg: WithParts, options?: { stripMedia?: boolean }): UIMessage | null {
  if (msg.info.role !== "user") return null
  if (msg.parts.length === 0) return null

  const userMessage: UIMessage = {
    id: msg.info.id,
    role: "user",
    parts: [],
  }
  for (const part of msg.parts) {
    if (part.type === "text" && !part.ignored)
      userMessage.parts.push({
        type: "text",
        text: part.text,
      })
    // text/plain and directory files are converted into text parts, ignore them
    if (part.type === "file" && part.mime !== "text/plain" && part.mime !== "application/x-directory") {
      if (options?.stripMedia && isMedia(part.mime)) {
        userMessage.parts.push({
          type: "text",
          text: `[Attached ${part.mime}: ${part.filename ?? "file"}]`,
        })
      } else {
        userMessage.parts.push({
          type: "file",
          url: part.url,
          mediaType: part.mime,
          filename: part.filename,
        })
      }
    }

    if (part.type === "compaction") {
      userMessage.parts.push({
        type: "text",
        text: "What did we do so far?",
      })
    }
    if (part.type === "subtask") {
      userMessage.parts.push({
        type: "text",
        text: "The following tool was executed by the user",
      })
    }
  }
  return userMessage
}

export function convertAssistantMessage(
  msg: WithParts,
  model: Provider.Model,
  supportsMedia: boolean,
  options?: { stripMedia?: boolean },
): { uiMessage: UIMessage; media: Array<{ mime: string; url: string }>; addedTools: string[] } | null {
  if (msg.info.role !== "assistant") return null
  if (msg.parts.length === 0) return null

  const differentModel = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
  const media: Array<{ mime: string; url: string }> = []
  const addedTools: string[] = []

  if (
    msg.info.error &&
    !(
      AbortedError.isInstance(msg.info.error) &&
      msg.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
    )
  ) {
    return null
  }

  const assistantMessage: UIMessage = {
    id: msg.info.id,
    role: "assistant",
    parts: [],
  }
  for (const part of msg.parts) {
    if (part.type === "text")
      assistantMessage.parts.push({
        type: "text",
        text: part.text,
        ...(differentModel ? {} : { providerMetadata: part.metadata }),
      })
    if (part.type === "step-start")
      assistantMessage.parts.push({
        type: "step-start",
      })
    if (part.type === "tool") {
      addedTools.push(part.tool)
      if (part.state.status === "completed") {
        const outputText = part.state.time.compacted ? "[Old tool result content cleared]" : part.state.output
        const attachments = part.state.time.compacted || options?.stripMedia ? [] : (part.state.attachments ?? [])

        // For providers that don't support media in tool results, extract media files
        // (images, PDFs) to be sent as a separate user message
        const mediaAttachments = attachments.filter((a) => isMedia(a.mime))
        const nonMediaAttachments = attachments.filter((a) => !isMedia(a.mime))
        if (!supportsMedia && mediaAttachments.length > 0) {
          media.push(...mediaAttachments)
        }
        const finalAttachments = supportsMedia ? attachments : nonMediaAttachments

        const output =
          finalAttachments.length > 0
            ? {
                text: outputText,
                attachments: finalAttachments,
              }
            : outputText

        assistantMessage.parts.push({
          type: ("tool-" + part.tool) as `tool-${string}`,
          state: "output-available",
          toolCallId: part.callID,
          input: part.state.input,
          output,
          ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
          ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
        })
      }
      if (part.state.status === "error") {
        const output = part.state.metadata?.interrupted === true ? part.state.metadata.output : undefined
        if (typeof output === "string") {
          assistantMessage.parts.push({
            type: ("tool-" + part.tool) as `tool-${string}`,
            state: "output-available",
            toolCallId: part.callID,
            input: part.state.input,
            output,
            ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
            ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
          })
        } else {
          assistantMessage.parts.push({
            type: ("tool-" + part.tool) as `tool-${string}`,
            state: "output-error",
            toolCallId: part.callID,
            input: part.state.input,
            errorText: part.state.error,
            ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
            ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
          })
        }
      }
      // Handle pending/running tool calls to prevent dangling tool_use blocks
      // Anthropic/Claude APIs require every tool_use to have a corresponding tool_result
      if (part.state.status === "pending" || part.state.status === "running")
        assistantMessage.parts.push({
          type: ("tool-" + part.tool) as `tool-${string}`,
          state: "output-error",
          toolCallId: part.callID,
          input: part.state.input,
          errorText: "[Tool execution was interrupted]",
          ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
          ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
        })
    }
    if (part.type === "reasoning") {
      assistantMessage.parts.push({
        type: "reasoning",
        text: part.text,
        ...(differentModel ? {} : { providerMetadata: part.metadata }),
      })
    }
  }

  if (assistantMessage.parts.length === 0) return null
  return { uiMessage: assistantMessage, media, addedTools }
}

export function synthesizeMediaMessage(media: Array<{ mime: string; url: string }>): UIMessage {
  return {
    id: MessageID.ascending(),
    role: "user",
    parts: [
      {
        type: "text" as const,
        text: SYNTHETIC_ATTACHMENT_PROMPT,
      },
      ...media.map((attachment) => ({
        type: "file" as const,
        url: attachment.url,
        mediaType: attachment.mime,
      })),
    ],
  }
}
