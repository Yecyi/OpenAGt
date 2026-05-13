// Builds synthetic transcript text for MCP resource file parts.
// It does not call MCP clients, sanitize resource text, or attach original file parts.
import type { MessageID, SessionID } from "../schema"
import type { MessageV2 } from "../message-v2"

type DraftTextPart = Omit<MessageV2.TextPart, "id"> & { id?: string }

type PartScope = {
  messageID: MessageID
  sessionID: SessionID
}

function textPart(scope: PartScope, text: string): DraftTextPart {
  return {
    messageID: scope.messageID,
    sessionID: scope.sessionID,
    type: "text",
    synthetic: true,
    text,
  }
}

export function mcpResourceReadPart(scope: PartScope, filename: string | undefined, uri: string): DraftTextPart {
  return textPart(scope, `Reading MCP resource: ${filename} (${uri})`)
}

export function mcpResourceBinaryPart(scope: PartScope, mime: string | undefined): DraftTextPart {
  return textPart(scope, `[Binary content: ${mime}]`)
}

export function mcpResourceFailurePart(scope: PartScope, filename: string | undefined, message: string): DraftTextPart {
  return textPart(scope, `Failed to read MCP resource ${filename}: ${message}`)
}
