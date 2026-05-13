import type { MessageID } from "./schema"
import { MessageV2 } from "./message-v2"

export type CompactionReplay = {
  info: MessageV2.User
  parts: MessageV2.Part[]
}

export function selectOverflowReplay(input: {
  messages: MessageV2.WithParts[]
  parentID: MessageID
  overflow?: boolean
}): { messages: MessageV2.WithParts[]; replay?: CompactionReplay } {
  if (!input.overflow) return { messages: input.messages }

  const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
  const candidate = (() => {
    for (let i = idx - 1; i >= 0; i--) {
      const msg = input.messages[i]
      if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
        return { replay: { info: msg.info, parts: msg.parts }, messages: input.messages.slice(0, i) }
      }
    }
  })()
  if (!candidate) return { messages: input.messages }

  const hasContent = candidate.messages.some(
    (m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"),
  )
  if (!hasContent) return { messages: input.messages }
  return candidate
}

export function replayPartForCompaction(part: MessageV2.Part): MessageV2.Part | { type: "text"; text: string } {
  if (part.type === "file" && MessageV2.isMedia(part.mime)) {
    return { type: "text", text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
  }
  return part
}

export function autoContinueText(overflow: boolean): string {
  return (
    (overflow
      ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
      : "") + "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
  )
}
