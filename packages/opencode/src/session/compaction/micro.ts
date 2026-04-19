import { Effect, Context } from "effect"
import { MessageV2 } from "../message-v2"
import { Log } from "@/util"

const log = Log.create({ service: "compaction.micro" })

export const MICRO_COMPACT_TIME_THRESHOLD_MS = 5 * 60 * 1000

export interface MicroCompactConfig {
  timeThresholdMs: number
  preserveRecentN: number
  compactableTools: Set<string>
}

export const DEFAULT_MICRO_COMPACT_CONFIG: MicroCompactConfig = {
  timeThresholdMs: MICRO_COMPACT_TIME_THRESHOLD_MS,
  preserveRecentN: 3,
  compactableTools: new Set(["read", "grep", "glob", "webfetch", "codesearch", "websearch"]),
}

export interface ToolResultSummary {
  originalLength: number
  summary: string
  timestamp: number
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
  parts: MessageV2.ToolPart[],
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
  parts: MessageV2.ToolPart[],
  config: MicroCompactConfig = DEFAULT_MICRO_COMPACT_CONFIG,
): MessageV2.ToolPart[] {
  const now = Date.now()
  const result: MessageV2.ToolPart[] = []

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
