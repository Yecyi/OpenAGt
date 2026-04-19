import { Effect } from "effect"
import { MessageV2 } from "./message-v2"
import { Log } from "@/util"

const log = Log.create({ service: "session.recovery" })

export interface SerializedMessage {
  id: string
  role: string
  content: string
  timestamp: number
  parentId?: string
  metadata?: Record<string, unknown>
}

export interface DeserializedSession {
  messages: MessageV2.WithParts[]
  metadata: {
    createdAt: number
    lastUpdatedAt: number
    messageCount: number
  }
}

/**
 * Deserialize messages from storage format
 * Used for session recovery and resumption
 */
export function deserializeMessages(serialized: SerializedMessage[]): MessageV2.WithParts[] {
  return serialized.map(msg => deserializeMessage(msg))
}

function deserializeMessage(serialized: SerializedMessage): MessageV2.WithParts {
  const role = serialized.role as MessageV2.Role

  const base = {
    id: serialized.id,
    info: {
      id: serialized.id,
      role,
      time: {
        created: serialized.timestamp,
      },
      model: {
        providerID: "unknown",
        modelID: "unknown",
        variant: undefined,
      },
      agent: "recovery",
      format: "text" as const,
    },
    parts: [] as MessageV2.Part[],
    sessionID: "recovered",
  }

  if (role === "user") {
    return {
      ...base,
      info: {
        ...base.info,
        model: serialized.metadata?.model as MessageV2.ModelInfo | undefined ?? base.info.model,
      },
      parts: serialized.content
        ? [{ type: "text" as const, text: serialized.content, id: "recovered-part", time: { start: serialized.timestamp, end: serialized.timestamp } }]
        : [],
    }
  }

  if (role === "assistant") {
    return {
      ...base,
      info: {
        ...base.info,
        summary: serialized.metadata?.summary as boolean | undefined,
      },
      parts: serialized.content
        ? [{ type: "text" as const, text: serialized.content, id: "recovered-part", time: { start: serialized.timestamp, end: serialized.timestamp } }]
        : [],
    }
  }

  return base as MessageV2.WithParts
}

/**
 * Serialize messages for storage
 */
export function serializeMessages(messages: MessageV2.WithParts[]): SerializedMessage[] {
  return messages.map(msg => serializeMessage(msg))
}

function serializeMessage(msg: MessageV2.WithParts): SerializedMessage {
  const content = msg.parts
    .filter(p => p.type === "text")
    .map(p => (p as MessageV2.TextPart).text)
    .join("\n")

  return {
    id: msg.info.id,
    role: msg.info.role,
    content,
    timestamp: msg.info.time.created,
    parentId: msg.info.parentID,
    metadata: {
      model: msg.info.model,
      summary: msg.info.summary,
      agent: msg.info.agent,
    },
  }
}

/**
 * Load conversation for resumption
 * Reconstructs a session from serialized storage
 */
export function loadConversationForResume(
  serialized: SerializedMessage[]
): Effect.Effect<DeserializedSession> {
  return Effect.gen(function* () {
    const messages = deserializeMessages(serialized)

    log.info("loaded conversation for resume", {
      messageCount: messages.length,
    })

    return {
      messages,
      metadata: {
        createdAt: messages[0]?.info.time.created ?? Date.now(),
        lastUpdatedAt: messages[messages.length - 1]?.info.time.created ?? Date.now(),
        messageCount: messages.length,
      },
    }
  })
}

/**
 * Rebuild conversation chain from compacted messages
 * Used after full compaction to restore context
 */
export function rebuildConversationChain(
  summaryMessage: MessageV2.Assistant,
  remainingMessages: MessageV2.WithParts[],
  replayMessage?: MessageV2.User
): MessageV2.WithParts[] {
  const result: MessageV2.WithParts[] = []

  // Add summary as the first assistant message
  result.push({
    ...summaryMessage,
    info: {
      ...summaryMessage.info,
      summary: true,
    },
  })

  // Add replay message if provided (user message that triggered compaction)
  if (replayMessage) {
    result.push(replayMessage)
  }

  // Add remaining messages (typically the last user message)
  result.push(...remainingMessages)

  return result
}

/**
 * Validate that a session can be recovered
 */
export function validateRecoverableSession(
  serialized: SerializedMessage[]
): { valid: boolean; error?: string } {
  if (!serialized || !Array.isArray(serialized)) {
    return { valid: false, error: "Invalid session format" }
  }

  if (serialized.length === 0) {
    return { valid: false, error: "Empty session" }
  }

  // Check that we have at least one user message
  const hasUserMessage = serialized.some(m => m.role === "user")
  if (!hasUserMessage) {
    return { valid: false, error: "No user messages found" }
  }

  // Check for required fields
  for (const msg of serialized) {
    if (!msg.id || !msg.role) {
      return { valid: false, error: `Invalid message: missing required fields` }
    }
  }

  return { valid: true }
}
