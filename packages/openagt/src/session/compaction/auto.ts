import { Effect } from "effect"
import { MessageV2 } from "../message-v2"
import { Token } from "@/util"
import { Log } from "@/util"
import { calculateToolImportance, getContentPreservationWeight } from "./importance"

const log = Log.create({ service: "compaction.auto" })

// Thresholds from Claude Code reference
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000

// Reserve this many tokens for output during compaction
// Based on p99.99 of compact summary output being 17,387 tokens
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000

// Stop trying autocompact after this many consecutive failures
// Prevents hammering the API with doomed compaction attempts when context is irrecoverably over limit
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

export interface AutoCompactConfig {
  bufferTokens: number
  maxOutputTokens: number
  circuitBreakerThreshold: number
  targetCompressionRatio: number
  // Additional config from Claude Code reference
  warningBufferTokens?: number
  errorBufferTokens?: number
  manualCompactBufferTokens?: number
  enabled?: boolean
}

export const DEFAULT_AUTO_COMPACT_CONFIG: AutoCompactConfig = {
  bufferTokens: AUTOCOMPACT_BUFFER_TOKENS,
  maxOutputTokens: MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  circuitBreakerThreshold: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  targetCompressionRatio: 0.4,
  warningBufferTokens: WARNING_THRESHOLD_BUFFER_TOKENS,
  errorBufferTokens: ERROR_THRESHOLD_BUFFER_TOKENS,
  manualCompactBufferTokens: MANUAL_COMPACT_BUFFER_TOKENS,
  enabled: true,
}

/**
 * Auto-compact tracking state for circuit breaker
 */
export interface AutoCompactTrackingState {
  compacted: boolean
  turnCounter: number
  turnId: string
  consecutiveFailures: number
}

/**
 * Token warning state for UI feedback
 */
export interface TokenWarningState {
  percentLeft: number
  isAboveWarningThreshold: boolean
  isAboveErrorThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
}

/**
 * Calculate effective context window size for a model
 * Subtracts max output tokens reserved for summary
 */
export function getEffectiveContextWindowSize(
  modelContextLimit: number,
  modelMaxOutput: number = MAX_OUTPUT_TOKENS_FOR_SUMMARY,
): number {
  const reservedTokensForSummary = Math.min(modelMaxOutput, MAX_OUTPUT_TOKENS_FOR_SUMMARY)
  return modelContextLimit - reservedTokensForSummary
}

/**
 * Get auto compact threshold for a model
 * Returns context window size minus buffer tokens
 */
export function getAutoCompactThreshold(
  modelContextLimit: number,
  modelMaxOutput: number = MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  config: AutoCompactConfig = DEFAULT_AUTO_COMPACT_CONFIG,
): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(modelContextLimit, modelMaxOutput)
  return effectiveContextWindow - (config.bufferTokens ?? AUTOCOMPACT_BUFFER_TOKENS)
}

/**
 * Calculate token warning state for UI feedback
 * From Claude Code reference
 */
export function calculateTokenWarningState(
  tokenUsage: number,
  modelContextLimit: number,
  modelMaxOutput: number = MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  config: AutoCompactConfig = DEFAULT_AUTO_COMPACT_CONFIG,
): TokenWarningState {
  const autoCompactThreshold = getAutoCompactThreshold(modelContextLimit, modelMaxOutput, config)

  const threshold =
    (config.enabled ?? true) ? autoCompactThreshold : getEffectiveContextWindowSize(modelContextLimit, modelMaxOutput)

  const percentLeft = Math.max(0, Math.round(((threshold - tokenUsage) / threshold) * 100))

  const warningThreshold = threshold - (config.warningBufferTokens ?? WARNING_THRESHOLD_BUFFER_TOKENS)
  const errorThreshold = threshold - (config.errorBufferTokens ?? ERROR_THRESHOLD_BUFFER_TOKENS)

  const isAboveWarningThreshold = tokenUsage >= warningThreshold
  const isAboveErrorThreshold = tokenUsage >= errorThreshold
  const isAboveAutoCompactThreshold = (config.enabled ?? true) && tokenUsage >= autoCompactThreshold

  const actualContextWindow = getEffectiveContextWindowSize(modelContextLimit, modelMaxOutput)
  const defaultBlockingLimit = actualContextWindow - (config.manualCompactBufferTokens ?? MANUAL_COMPACT_BUFFER_TOKENS)
  const blockingLimit = defaultBlockingLimit

  const isAtBlockingLimit = tokenUsage >= blockingLimit

  return {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  }
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
        // Count non-compacted tool outputs
        if (
          part.state.status === "completed" &&
          !part.state.metadata?.micro_compacted &&
          !part.state.metadata?.auto_compacted
        ) {
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
  if (config.enabled === false) return false

  const budget = calculateTokenBudget(messages, modelContextLimit, config)
  const warningState = calculateTokenWarningState(budget.used, modelContextLimit, config.maxOutputTokens, config)
  return warningState.isAboveAutoCompactThreshold
}

export function findToolPartsToCompact(
  messages: MessageV2.WithParts[],
  targetTokens: number,
): Array<MessageV2.ToolPart & { state: MessageV2.ToolStateCompleted }> {
  const candidates: Array<{
    part: MessageV2.ToolPart & { state: MessageV2.ToolStateCompleted }
    age: number
    priority: number
  }> = []

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      if (part.state.metadata?.micro_compacted) continue
      if (part.state.metadata?.auto_compacted) continue
      if (part.state.time.compacted) continue

      const age = Date.now() - (part.state.time.end ?? part.state.time.start)
      const importance = calculateToolImportance(part.tool)
      const contentWeight = getContentPreservationWeight(part.state.output ?? "")

      // Calculate priority score:
      // - Age is weighted logarithmically (older = higher priority to compress)
      // - Tool importance reduces priority (high importance = lower compress priority)
      // - Content weight increases priority (critical content = lower compress priority)
      const ageWeight = Math.log2(age / (60 * 1000) + 1) // log of age in minutes + 1
      const importanceFactor = Math.max(1, 11 - importance) // 10 = highest importance -> factor 1
      const contentBonus = contentWeight > 0 ? contentWeight * 0.5 : 0

      // Higher priority = better candidate for compression
      const priority = ageWeight * importanceFactor + contentBonus

      candidates.push({
        part: part as MessageV2.ToolPart & { state: MessageV2.ToolStateCompleted },
        age,
        priority,
      })
    }
  }

  // Sort by priority (highest priority first = best compression candidates)
  candidates.sort((a, b) => b.priority - a.priority)

  const toCompact: Array<MessageV2.ToolPart & { state: MessageV2.ToolStateCompleted }> = []
  let saved = 0

  for (const { part, priority } of candidates) {
    if (saved >= targetTokens) break
    toCompact.push(part)
    saved += Token.estimate(part.state.output)
  }

  log.info("auto-compact targets", {
    count: toCompact.length,
    estimatedTokens: saved,
    target: targetTokens,
    candidatesAnalyzed: candidates.length,
  })
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

  constructor(
    private threshold: number = MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
    private cooldownMs: number = 30_000,
  ) {}

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
    return Date.now() - this.lastSuccess > this.cooldownMs
  }

  getState(): { failures: number; isOpen: boolean } {
    return { failures: this.failures, isOpen: this.isOpen() }
  }

  /**
   * Create tracking state for auto-compact loop
   */
  static createTrackingState(turnId: string): AutoCompactTrackingState {
    return {
      compacted: false,
      turnCounter: 0,
      turnId,
      consecutiveFailures: 0,
    }
  }
}
