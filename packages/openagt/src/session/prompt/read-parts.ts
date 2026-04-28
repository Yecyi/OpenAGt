// Builds synthetic Read tool transcript parts for resolved prompt file inputs.
// It does not read files, sanitize content, publish errors, or assign part IDs.
import type { MessageID, SessionID } from "../schema"
import type { MessageV2 } from "../message-v2"

type DraftTextPart = Omit<MessageV2.TextPart, "id"> & { id?: string }

type PartScope = {
  messageID: MessageID
  sessionID: SessionID
}

export function syntheticTextPart(scope: PartScope, text: string): DraftTextPart {
  return {
    messageID: scope.messageID,
    sessionID: scope.sessionID,
    type: "text",
    synthetic: true,
    text,
  }
}

export function readToolCallPart(
  scope: PartScope,
  args: { filePath: string | undefined; offset?: number; limit?: number },
): DraftTextPart {
  return syntheticTextPart(scope, `Called the Read tool with the following input: ${JSON.stringify(args)}`)
}

export function readToolFailurePart(scope: PartScope, filepath: string, message: string): DraftTextPart {
  return syntheticTextPart(scope, `Read tool failed to read ${filepath} with the following error: ${message}`)
}
