import { MessageV2 } from "../message-v2"

export interface ApiRound {
  userMessage: MessageV2.WithParts
  assistantMessages: MessageV2.Assistant[]
  roundIndex: number
}

/**
 * Group messages by API round
 * Each round consists of a user message followed by one or more assistant messages
 * (in case of tool use interleaving)
 */
export function groupMessagesByApiRound(
  messages: MessageV2.WithParts[]
): ApiRound[] {
  const rounds: ApiRound[] = []
  let currentUser: MessageV2.WithParts | null = null
  let currentAssistant: MessageV2.Assistant[] = []

  for (const msg of messages) {
    if (msg.info.role === "user") {
      // Save previous round if exists
      if (currentUser) {
        rounds.push({
          userMessage: currentUser,
          assistantMessages: currentAssistant,
          roundIndex: rounds.length,
        })
      }

      // Start new round
      currentUser = msg
      currentAssistant = []
    } else if (msg.info.role === "assistant" && currentUser) {
      currentAssistant.push(msg as MessageV2.Assistant)
    }
    // Skip other roles (system, etc.)
  }

  // Don't forget the last round
  if (currentUser) {
    rounds.push({
      userMessage: currentUser,
      assistantMessages: currentAssistant,
      roundIndex: rounds.length,
    })
  }

  return rounds
}

/**
 * Get messages within a specific round
 */
export function getMessagesInRound(
  messages: MessageV2.WithParts[],
  roundIndex: number
): MessageV2.WithParts[] {
  const rounds = groupMessagesByApiRound(messages)
  const round = rounds[roundIndex]

  if (!round) return []

  return [round.userMessage, ...round.assistantMessages]
}

/**
 * Find the round that contains a specific message
 */
export function findMessageRound(
  messages: MessageV2.WithParts[],
  messageId: string
): number {
  const rounds = groupMessagesByApiRound(messages)

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i]
    if (round.userMessage.info.id === messageId) {
      return i
    }
    if (round.assistantMessages.some(m => m.info.id === messageId)) {
      return i
    }
  }

  return -1
}

/**
 * Count total rounds in a message sequence
 */
export function countRounds(messages: MessageV2.WithParts[]): number {
  return groupMessagesByApiRound(messages).length
}

/**
 * Get round boundaries (start and end indices)
 */
export function getRoundBoundaries(
  messages: MessageV2.WithParts[]
): Array<{ roundIndex: number; startIndex: number; endIndex: number }> {
  const rounds = groupMessagesByApiRound(messages)
  const boundaries: Array<{ roundIndex: number; startIndex: number; endIndex: number }> = []

  let index = 0
  for (const round of rounds) {
    const startIndex = index
    // User message
    index++
    // Assistant messages
    index += round.assistantMessages.length

    boundaries.push({
      roundIndex: round.roundIndex,
      startIndex,
      endIndex: index - 1,
    })
  }

  return boundaries
}
