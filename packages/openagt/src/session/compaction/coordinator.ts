/**
 * Three-Layer Compaction Coordinator
 *
 * Simplified coordinator that integrates with existing SessionCompaction.
 * Provides decision logic for which compaction layer to run.
 *
 * Reference: CC Source Code session compaction logic
 */

import { Effect } from "effect"
import { MessageV2 } from "../message-v2"
import { Token, Log } from "@/util"
import { Provider } from "@/provider"
import {
  MICRO_COMPACT_TIME_THRESHOLD_MS,
  applyMicroCompact,
  summarizeToolResult,
} from "./micro"
import {
  DEFAULT_AUTO_COMPACT_CONFIG,
  needsAutoCompact,
  findToolPartsToCompact,
  calculateTokenWarningState,
  calculateTokenBudget,
  type AutoCompactConfig,
} from "./auto"
import {
  buildCompactContext,
  formatCompactPrompt,
  DEFAULT_FULL_COMPACT_CONFIG,
  stripImagesFromMessages,
  findExistingSummary,
} from "./full"
import { semanticPreserver } from "./semantic"
import { compressionTracker } from "./metrics"

const log = Log.create({ service: "compaction.coordinator" })

// ============================================================
// Types
// ============================================================

export type CompactionLayer = "micro" | "auto" | "full"

export interface CompactionDecision {
  layer: CompactionLayer | "none"
  reason: string
  targetTokens?: number
  shouldCompact: boolean
}

export interface CompactionResult {
  layer: CompactionLayer | "none"
  compactedCount: number
  tokensSaved: number
  success: boolean
  error?: string
}

export interface CompactionCoordinatorConfig {
  microTimeThresholdMs: number
  microPreserveRecentN: number
  microCompactableTools: Set<string>
  autoConfig: AutoCompactConfig
  enableThreeLayer: boolean
  preferMicroOverAuto: boolean
  aggressiveCompression: boolean
}

export const DEFAULT_COORDINATOR_CONFIG: CompactionCoordinatorConfig = {
  microTimeThresholdMs: MICRO_COMPACT_TIME_THRESHOLD_MS,
  microPreserveRecentN: 3,
  microCompactableTools: new Set(["bash", "read", "grep", "glob", "webfetch", "codesearch", "websearch"]),
  autoConfig: DEFAULT_AUTO_COMPACT_CONFIG,
  enableThreeLayer: true,
  preferMicroOverAuto: true,
  aggressiveCompression: false,
}

// ============================================================
// Compaction Coordinator
// ============================================================

export class CompactionCoordinator {
  private config: CompactionCoordinatorConfig

  constructor(config: Partial<CompactionCoordinatorConfig> = {}) {
    this.config = { ...DEFAULT_COORDINATOR_CONFIG, ...config }
  }

  /**
   * Decide which compaction layer to run
   */
  decide(
    messages: MessageV2.WithParts[],
    model: Provider.Model,
  ): CompactionDecision {
    if (!this.config.enableThreeLayer) {
      return { layer: "none", reason: "three-layer compaction disabled", shouldCompact: false }
    }

    const budget = calculateTokenBudget(messages, model.limit.context, this.config.autoConfig)
    const warningState = calculateTokenWarningState(
      budget.used,
      model.limit.context,
      model.limit.output,
      this.config.autoConfig,
    )

    // Layer 1: Check if MicroCompact can help
    const microCandidates = this.countMicroCandidates(messages)
    if (microCandidates > 0 && this.config.preferMicroOverAuto) {
      return {
        layer: "micro",
        reason: `found ${microCandidates} micro-compactable tools (time-based)`,
        shouldCompact: true,
      }
    }

    // Layer 2: Check if AutoCompact is needed
    if (warningState.isAboveAutoCompactThreshold) {
      const targetTokens = Math.floor(model.limit.context * 0.2)
      return {
        layer: "auto",
        reason: `token budget exceeded (${budget.used}/${model.limit.context})`,
        targetTokens,
        shouldCompact: true,
      }
    }

    // Layer 3: Check if FullCompact is required
    if (warningState.isAtBlockingLimit || budget.compressionRatio > 1.5) {
      return {
        layer: "full",
        reason: `context limit exceeded (${budget.used}/${model.limit.context})`,
        shouldCompact: true,
      }
    }

    // Aggressive mode: be more conservative
    if (this.config.aggressiveCompression) {
      const recentErrors = this.countRecentErrors(messages)
      if (recentErrors > 0 && microCandidates > 0) {
        return {
          layer: "micro",
          reason: `aggressive mode: ${recentErrors} recent errors, compacting ${microCandidates} tools`,
          shouldCompact: true,
        }
      }
    }

    return { layer: "none", reason: "no compaction needed", shouldCompact: false }
  }

  /**
   * Count micro-compactable tools in messages
   */
  private countMicroCandidates(messages: MessageV2.WithParts[]): number {
    let count = 0
    const now = Date.now()

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (!this.config.microCompactableTools.has(part.tool)) continue
        if (part.state.status !== "completed") continue

        // Check if already compacted
        const state = part.state
        if ("metadata" in state && state.metadata) {
          if ((state.metadata as Record<string, unknown>).micro_compacted) continue
          if ((state.metadata as Record<string, unknown>).auto_compacted) continue
        }

        const age = now - (state.time?.end ?? state.time?.start ?? now)
        if (age > this.config.microTimeThresholdMs) {
          count++
        }
      }
    }

    return count
  }

  /**
   * Count recent errors in messages
   */
  private countRecentErrors(messages: MessageV2.WithParts[]): number {
    let count = 0
    const recentWindow = 5
    const recentMsgs = messages.slice(-recentWindow)

    for (const msg of recentMsgs) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (part.state.status !== "completed") continue
        if (!("output" in part.state)) continue

        const output = (part.state as MessageV2.ToolStateCompleted).output ?? ""
        if (/\berror\b|\bfailed\b|\bexception\b/i.test(output)) {
          count++
        }
      }
    }

    return count
  }

  /**
   * Apply micro-compaction to messages
   */
  applyMicroCompact(messages: MessageV2.WithParts[]): {
    updatedMessages: MessageV2.WithParts[]
    compactedCount: number
    tokensSaved: number
  } {
    let compactedCount = 0
    let tokensSaved = 0
    const updatedMessages: MessageV2.WithParts[] = []

    for (const msg of messages) {
      const updatedParts = applyMicroCompact(msg.parts, {
        timeThresholdMs: this.config.microTimeThresholdMs,
        preserveRecentN: this.config.microPreserveRecentN,
        compactableTools: this.config.microCompactableTools,
      })

      for (let i = 0; i < msg.parts.length; i++) {
        if (msg.parts[i] !== updatedParts[i]) {
          const part = updatedParts[i]
          if (part?.type === "tool") {
            const toolPart = part as MessageV2.ToolPart
            if (toolPart.state.status === "completed" && "output" in toolPart.state) {
              const originalTokens = Token.estimate(toolPart.state.output ?? "")
              compactedCount++
              tokensSaved += Math.floor(originalTokens * 0.5)
            }
          }
        }
      }

      updatedMessages.push({ ...msg, parts: updatedParts })
    }

    if (compactedCount > 0) {
      compressionTracker.recordCompression("micro", tokensSaved, Math.floor(tokensSaved * 0.5))
    }

    return { updatedMessages, compactedCount, tokensSaved }
  }

  /**
   * Apply auto-compaction to messages
   */
  applyAutoCompact(
    messages: MessageV2.WithParts[],
    targetTokens: number,
  ): {
    updatedMessages: MessageV2.WithParts[]
    compactedCount: number
    tokensSaved: number
  } {
    let compactedCount = 0
    let tokensSaved = 0
    const toCompact = findToolPartsToCompact(messages, targetTokens)

    // Create a map for quick lookup
    const compactMap = new Map<MessageV2.ToolPart, MessageV2.Part>()
    for (const part of toCompact) {
      compactMap.set(part, part)
    }

    const updatedMessages: MessageV2.WithParts[] = []

    for (const msg of messages) {
      const updatedParts = msg.parts.map((part) => {
        if (part.type !== "tool") return part
        const toolPart = part as MessageV2.ToolPart & { state: MessageV2.ToolStateCompleted }

        if (!compactMap.has(toolPart)) return part
        if (toolPart.state.status !== "completed") return part
        if (!("output" in toolPart.state)) return part

        // Check semantic preservation
        const preserveDecision = semanticPreserver.shouldPreserve(
          toolPart.tool,
          toolPart.state.output ?? "",
          {},
        )

        if (preserveDecision.preserve) {
          log.debug("skipping compaction for semantic preservation", {
            tool: toolPart.tool,
            reason: preserveDecision.reason,
          })
          return part
        }

        const originalTokens = Token.estimate(toolPart.state.output ?? "")
        const summary = summarizeToolResult(toolPart.state.output ?? "", toolPart.tool)

        compactedCount++
        tokensSaved += Math.max(0, originalTokens - Token.estimate(summary.summary))

        return {
          ...toolPart,
          state: {
            ...toolPart.state,
            output: summary.summary,
            metadata: {
              ...toolPart.state.metadata,
              auto_compacted: true,
              original_length: toolPart.state.output?.length ?? 0,
            },
            time: {
              ...toolPart.state.time,
              compacted: Date.now(),
            },
          },
        } as MessageV2.Part
      })

      updatedMessages.push({ ...msg, parts: updatedParts })
    }

    if (compactedCount > 0) {
      compressionTracker.recordCompression("auto", tokensSaved, Math.floor(tokensSaved * 0.3))
    }

    return { updatedMessages, compactedCount, tokensSaved }
  }

  /**
   * Prepare full compaction context
   */
  prepareFullCompact(
    messages: MessageV2.WithParts[],
  ): {
    prompt: string
    context: ReturnType<typeof buildCompactContext>
    existingSummary: ReturnType<typeof findExistingSummary>
    tokensSaved: number
  } {
    const strippedMessages = stripImagesFromMessages(messages)
    const originalTokens = Token.estimate(JSON.stringify(messages))
    const newTokens = Token.estimate(JSON.stringify(strippedMessages))
    const tokensSaved = Math.max(0, originalTokens - newTokens)

    const existingSummary = findExistingSummary(messages)
    const context = buildCompactContext(messages, DEFAULT_FULL_COMPACT_CONFIG)
    const prompt = formatCompactPrompt(context, DEFAULT_FULL_COMPACT_CONFIG)

    return {
      prompt,
      context,
      existingSummary,
      tokensSaved,
    }
  }

  /**
   * Get compression threshold adjustment recommendation
   */
  getThresholdAdjustment(): { action: "increase" | "decrease" | "stable"; reason: string } {
    return compressionTracker.shouldAdjustThreshold()
  }

  /**
   * Update configuration
   */
  updateConfig(partial: Partial<CompactionCoordinatorConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  /**
   * Get current configuration
   */
  getConfig(): CompactionCoordinatorConfig {
    return { ...this.config }
  }
}

// ============================================================
// Singleton Instance
// ============================================================

export const compactionCoordinator = new CompactionCoordinator()

// ============================================================
// Utility Functions
// ============================================================

export function needsCompaction(
  messages: MessageV2.WithParts[],
  model: Provider.Model,
  config?: Partial<CompactionCoordinatorConfig>,
): boolean {
  const coordinator = new CompactionCoordinator(config)
  return coordinator.decide(messages, model).shouldCompact
}

export function getRecommendedLayer(
  messages: MessageV2.WithParts[],
  model: Provider.Model,
): CompactionLayer | "none" {
  const coordinator = new CompactionCoordinator()
  return coordinator.decide(messages, model).layer
}
