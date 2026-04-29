// Converts MCP tool result content into prompt processor text and file attachments.
// It does not execute MCP tools, truncate output, or assign message/part IDs.
import type { MessageV2 } from "../message-v2"

export type McpToolContentItem =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "resource"; resource: { text?: string; blob?: string; mimeType?: string; uri: string } }

export function mcpToolOutputParts(content: readonly McpToolContentItem[]): {
  textParts: string[]
  attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
} {
  const textParts: string[] = []
  const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []
  for (const contentItem of content) {
    if (contentItem.type === "text") textParts.push(contentItem.text)
    else if (contentItem.type === "image") {
      attachments.push({
        type: "file",
        mime: contentItem.mimeType,
        url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
      })
    } else if (contentItem.type === "resource") {
      if (contentItem.resource.text) textParts.push(contentItem.resource.text)
      if (contentItem.resource.blob) {
        attachments.push({
          type: "file",
          mime: contentItem.resource.mimeType ?? "application/octet-stream",
          url: `data:${contentItem.resource.mimeType ?? "application/octet-stream"};base64,${contentItem.resource.blob}`,
          filename: contentItem.resource.uri,
        })
      }
    }
  }
  return { textParts, attachments }
}
