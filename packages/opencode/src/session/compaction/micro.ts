import { Effect, Context } from "effect"
import { MessageV2 } from "../message-v2"
import { Log, Token } from "@/util"

const log = Log.create({ service: "compaction.micro" })

// Time-based MC cleared message (from Claude Code reference)
export const TIME_BASED_MC_CLEARED_MESSAGE = "[Old tool result content cleared]"

// Image/document token size estimate (from Claude Code reference)
const IMAGE_MAX_TOKEN_SIZE = 2000

export const MICRO_COMPACT_TIME_THRESHOLD_MS = 5 * 60 * 1000

export interface MicroCompactConfig {
  timeThresholdMs: number
  preserveRecentN: number
  compactableTools: Set<string>
  // Environment-based config
  enabled?: boolean
  gapThresholdMinutes?: number
}

export const DEFAULT_MICRO_COMPACT_CONFIG: MicroCompactConfig = {
  timeThresholdMs: MICRO_COMPACT_TIME_THRESHOLD_MS,
  preserveRecentN: 3,
  compactableTools: new Set(["read", "grep", "glob", "webfetch", "codesearch", "websearch"]),
}

export interface MicroCompactResult {
  messages: MessageV2.WithParts[]
  tokensSaved: number
  toolsCleared: number
  toolsKept: number
}

export interface ToolResultSummary {
  originalLength: number
  summary: string
  timestamp: number
}

/**
 * Estimate token count for a tool result
 */
export function estimateToolResultTokens(output: string | undefined, hasMedia: boolean = false): number {
  if (!output) return 0

  if (hasMedia) {
    // Images/documents are approximately 2000 tokens regardless of format
    return IMAGE_MAX_TOKEN_SIZE
  }

  return Token.estimate(output)
}

/**
 * Collect compactable tool IDs from messages (in encounter order)
 */
export function collectCompactableToolIds(
  messages: MessageV2.WithParts[],
  compactableTools: Set<string>
): string[] {
  const ids: string[] = []

  for (const msg of messages) {
    if (msg.info.role !== "assistant") continue

    for (const part of msg.parts) {
      if (part.type === "tool" && compactableTools.has(part.tool)) {
        ids.push(part.id)
      }
    }
  }

  return ids
}

/**
 * Evaluate time-based trigger - check if the gap since last assistant message
 * exceeds the threshold (from Claude Code reference)
 */
export function evaluateTimeBasedTrigger(
  messages: MessageV2.WithParts[],
  config: MicroCompactConfig = DEFAULT_MICRO_COMPACT_CONFIG
): { gapMinutes: number; config: MicroCompactConfig } | null {
  if (config.enabled === false) return null

  // Find last assistant message
  const lastAssistant = messages.findLast(m => m.info.role === "assistant")
  if (!lastAssistant) return null

  const gapMinutes = (Date.now() - lastAssistant.info.time.created) / 60_000
  const threshold = (config.gapThresholdMinutes ?? 5) // Default 5 minutes

  if (!Number.isFinite(gapMinutes) || gapMinutes < threshold) {
    return null
  }

  return { gapMinutes, config }
}

/**
 * Apply time-based microcompaction to messages
 * Clears all but the most recent N compactable tool results
 */
export function applyTimeBasedMicroCompact(
  messages: MessageV2.WithParts[],
  config: MicroCompactConfig = DEFAULT_MICRO_COMPACT_CONFIG
): MicroCompactResult | null {
  const trigger = evaluateTimeBasedTrigger(messages, config)
  if (!trigger) return null

  const { gapMinutes, config: triggerConfig } = trigger
  const compactableTools = triggerConfig.compactableTools ?? DEFAULT_MICRO_COMPACT_CONFIG.compactableTools

  const compactableIds = collectCompactableToolIds(messages, compactableTools)

  // Floor at 1: always keep at least the last tool result
  const keepRecent = Math.max(1, triggerConfig.preserveRecentN ?? 3)
  const keepSet = new Set(compactableIds.slice(-keepRecent))
  const clearSet = new Set(compactableIds.filter(id => !keepSet.has(id)))

  if (clearSet.size === 0) return null

  let tokensSaved = 0
  let toolsCleared = 0
  let toolsKept = 0

  const result = messages.map(msg => {
    if (msg.info.role !== "user") return msg

    const updatedParts = msg.parts.map(part => {
      if (part.type !== "tool") return part
      if (!clearSet.has(part.id)) {
        if (msg.info.role === "assistant" || part.type === "tool") toolsKept++
        return part
      }

      // Check if already cleared
      if (part.state.output === TIME_BASED_MC_CLEARED_MESSAGE) {
        return part
      }

      // Estimate tokens saved
      tokensSaved += estimateToolResultTokens(part.state.output)
      toolsCleared++

      // Return cleared version
      return {
        ...part,
        state: {
          ...part.state,
          output: TIME_BASED_MC_CLEARED_MESSAGE,
          metadata: {
            ...part.state.metadata,
            time_based_mc_cleared: true,
            original_length: part.state.output?.length ?? 0,
          },
        },
      } as MessageV2.ToolPart
    })

    return { ...msg, parts: updatedParts }
  })

  log.info("time-based microcompact", {
    gapMinutes: Math.round(gapMinutes),
    toolsCleared,
    toolsKept,
    tokensSaved,
  })

  return { messages: result, tokensSaved, toolsCleared, toolsKept }
}

export function summarizeToolResult(output: string, toolName: string): ToolResultSummary {
  const lines = output.split("\n").filter((l) => l.trim())
  const originalLength = output.length

  if (lines.length <= 3) {
    return { originalLength, summary: output, timestamp: Date.now() }
  }

  const firstFew = lines.slice(0, 2)
  const lastFew = lines.slice(-2)
  const summary = [...firstFew, `... (${lines.length - 4} more lines) ...`, ...lastFew].join("\n")

  return { originalLength, summary, timestamp: Date.now() }
}

export function shouldMicroCompact(
  parts: MessageV2.Part[],
  config: MicroCompactConfig = DEFAULT_MICRO_COMPACT_CONFIG,
): MessageV2.ToolPart[] {
  const now = Date.now()
  const toCompact: MessageV2.ToolPart[] = []

  for (const part of parts) {
    if (part.type !== "tool") continue
    if (part.state.status !== "completed") continue
    if (!config.compactableTools.has(part.tool)) continue
    if (part.state.time.compacted) continue

    const age = now - (part.state.time.end ?? part.state.time.start)
    if (age < config.timeThresholdMs) continue

    toCompact.push(part)
  }

  return toCompact
}

export function applyMicroCompact(
  parts: MessageV2.Part[],
  config: MicroCompactConfig = DEFAULT_MICRO_COMPACT_CONFIG,
) {
  const now = Date.now()
  const result: MessageV2.Part[] = []

  for (const part of parts) {
    if (part.type !== "tool") {
      result.push(part)
      continue
    }

    if (part.state.status !== "completed") {
      result.push(part)
      continue
    }

    if (!config.compactableTools.has(part.tool)) {
      result.push(part)
      continue
    }

    if (part.state.time.compacted) {
      result.push(part)
      continue
    }

    const age = now - (part.state.time.end ?? part.state.time.start)
    if (age < config.timeThresholdMs) {
      result.push(part)
      continue
    }

    const summary = summarizeToolResult(part.state.output, part.tool)
    const compacted: MessageV2.ToolPart = {
      ...part,
      state: {
        ...part.state,
        output: summary.summary,
        compacted: true,
        time: {
          ...part.state.time,
          compacted: now,
        },
        metadata: {
          ...part.state.metadata,
          micro_compacted: true,
          original_length: summary.originalLength,
        },
      },
    }

    result.push(compacted)
    log.info("micro-compacted", { tool: part.tool, original: summary.originalLength, now: summary.summary.length })
  }

  return result
}
