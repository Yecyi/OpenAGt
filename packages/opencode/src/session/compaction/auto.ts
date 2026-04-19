import { Effect } from "effect"
import { MessageV2 } from "../message-v2"
import { Token } from "@/util"
import { Log } from "@/util"

const log = Log.create({ service: "compaction.auto" })

export interface AutoCompactConfig {
  bufferTokens: number
  maxOutputTokens: number
  circuitBreakerThreshold: number
  targetCompressionRatio: number
}

export const DEFAULT_AUTO_COMPACT_CONFIG: AutoCompactConfig = {
  bufferTokens: 13_000,
  maxOutputTokens: 20_000,
  circuitBreakerThreshold: 3,
  targetCompressionRatio: 0.4,
}

export interface TokenBudget {
  total: number
  used: number
  available: number
  compressionRatio: number
}

export function calculateTokenBudget(
  messages: MessageV2.WithParts[],
  modelContextLimit: number,
  config: AutoCompactConfig = DEFAULT_AUTO_COMPACT_CONFIG,
): TokenBudget {
  let total = 0
  let used = 0

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "text") {
        used += Token.estimate(part.text)
      } else if (part.type === "reasoning") {
        used += Token.estimate(part.text)
      } else if (part.type === "tool") {
        if (part.state.status === "completed" && !part.state.metadata?.micro_compacted) {
          used += Token.estimate(part.state.output)
        }
      }
    }
  }

  const buffer = config.bufferTokens
  const maxOutput = config.maxOutputTokens
  const available = Math.max(0, modelContextLimit - buffer - maxOutput)
  const compressionRatio = available > 0 ? used / available : 1

  return {
    total: modelContextLimit,
    used,
    available,
    compressionRatio,
  }
}

export function needsAutoCompact(
  messages: MessageV2.WithParts[],
  modelContextLimit: number,
  config: AutoCompactConfig = DEFAULT_AUTO_COMPACT_CONFIG,
): boolean {
  const budget = calculateTokenBudget(messages, modelContextLimit, config)
  return budget.compressionRatio > 1
}

export function findToolPartsToCompact(
  messages: MessageV2.WithParts[],
  targetTokens: number,
): MessageV2.ToolPart[] {
  const candidates: Array<{ part: MessageV2.ToolPart; age: number }> = []

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      if (part.state.metadata?.micro_compacted) continue
      if (part.state.metadata?.auto_compacted) continue
      if (part.state.time.compacted) continue

      const age = Date.now() - (part.state.time.end ?? part.state.time.start)
      candidates.push({ part, age })
    }
  }

  candidates.sort((a, b) => a.age - b.age)

  const toCompact: MessageV2.ToolPart[] = []
  let saved = 0
  const target = targetTokens

  for (const { part } of candidates) {
    if (saved >= target) break
    toCompact.push(part)
    saved += Token.estimate(part.state.output)
  }

  log.info("auto-compact targets", { count: toCompact.length, estimatedTokens: saved, target })
  return toCompact
}

export interface CompactAttempt {
  attempt: number
  savedTokens: number
  success: boolean
}

export class CircuitBreaker {
  private failures: number = 0
  private lastSuccess: number = 0

  constructor(private threshold: number) {}

  recordSuccess(): void {
    this.failures = 0
    this.lastSuccess = Date.now()
  }

  recordFailure(): void {
    this.failures++
  }

  isOpen(): boolean {
    return this.failures >= this.threshold
  }

  canAttempt(): boolean {
    if (this.failures === 0) return true
    const cooldown = 30_000
    return Date.now() - this.lastSuccess > cooldown
  }

  getState(): { failures: number; isOpen: boolean } {
    return { failures: this.failures, isOpen: this.isOpen() }
  }
}
