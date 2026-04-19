/**
 * Semantic Preservation Module
 *
 * Determines which tool results should be preserved based on semantic
 * importance rather than just age. This helps maintain critical information
 * during compression.
 */

import { calculateToolImportance, getContentPreservationWeight } from "./importance"

// ============================================================
// Types
// ============================================================

export interface SemanticPreserveConfig {
  /** Patterns that indicate content should be preserved */
  preservePatterns: RegExp[]
  /** Maximum length for auto-preservation of small outputs */
  preserveSmallOutput: number
  /** Number of recent outputs to preserve per tool type */
  preserveRecentPerTool: Record<string, number>
  /** Whether to preserve error/warning content */
  preserveErrors: boolean
  /** Whether to preserve git operation results */
  preserveGitOps: boolean
}

export interface PreserveDecision {
  /** Whether to preserve the content */
  preserve: boolean
  /** Reason for the decision */
  reason: string
  /** Confidence level of the decision */
  confidence: "high" | "medium" | "low"
}

// ============================================================
// Default Configuration
// ============================================================

export const DEFAULT_SEMANTIC_CONFIG: SemanticPreserveConfig = {
  preservePatterns: [
    // Error patterns
    /\berror\b.*(?:failed|cannot|unable|denied)/i,
    /(?<!\w)Error(?!\w):/i,
    /(?<!\w)Exception(?!\w)/i,
    /(?<!\w)FAILED(?!\w)/i,
    /(?<!\w)CRITICAL(?!\w)/i,

    // Warning patterns
    /(?<!\w)WARNING(?!\w)/i,
    /(?<!\w)WARN(?!\w)/i,

    // Failure patterns
    /(?<!\w)FAILED(?!\w)/i,
    /(?<!\w)FAILURE(?!\w)/i,

    // Git important operations
    /git\s+(?:commit|push|pull|merge|checkout)/i,
    /\[master|main\].*\|\s*\d+\s+deletion/i,

    // Test results
    /test\s+(?:passed|failed|error)/i,
    /\d+\s+passing|\d+\s+failing/i,

    // Build results
    /build\s+(?:success|failed|error)/i,
    /compilation\s+error/i,
  ],
  preserveSmallOutput: 200,
  preserveRecentPerTool: {
    edit: 3,
    write: 3,
    apply_patch: 2,
    apply_diff: 2,
    git_commit: 5,
    bash_commit: 5,
    bash: 2,
  },
  preserveErrors: true,
  preserveGitOps: true,
}

// ============================================================
// Semantic Preserver
// ============================================================

export class SemanticPreserver {
  constructor(private config: SemanticPreserveConfig = DEFAULT_SEMANTIC_CONFIG) {}

  /**
   * Determine if content should be preserved based on semantic analysis
   */
  shouldPreserve(
    toolName: string,
    content: string,
    context: {
      recentEdits?: string[]
      currentTask?: string
      recentErrors?: number
      isDebugging?: boolean
    } = {},
  ): PreserveDecision {
    const importance = calculateToolImportance(toolName)
    const contentWeight = getContentPreservationWeight(content)

    // High content weight from patterns = high confidence preserve
    if (contentWeight >= 8) {
      return {
        preserve: true,
        reason: `critical content pattern matched (weight: ${contentWeight})`,
        confidence: "high",
      }
    }

    // Small outputs can be preserved cheaply
    if (content.length <= this.config.preserveSmallOutput) {
      return {
        preserve: true,
        reason: `small output (${content.length} chars)`,
        confidence: "high",
      }
    }

    // High importance tools should generally be preserved
    if (importance >= 9) {
      return {
        preserve: true,
        reason: `high importance tool: ${toolName}`,
        confidence: "high",
      }
    }

    // Error patterns
    if (this.config.preserveErrors && contentWeight >= 5) {
      return {
        preserve: true,
        reason: "error/warning content detected",
        confidence: "medium",
      }
    }

    // If debugging, preserve more
    if (context.isDebugging && importance >= 5) {
      return {
        preserve: true,
        reason: "debugging context - preserving medium importance tool",
        confidence: "medium",
      }
    }

    // Recent errors make us more conservative
    if ((context.recentErrors ?? 0) > 0 && importance >= 6) {
      return {
        preserve: true,
        reason: "recent errors - preserving tool with context",
        confidence: "medium",
      }
    }

    // Check pattern matching
    for (const pattern of this.config.preservePatterns) {
      if (pattern.test(content)) {
        return {
          preserve: true,
          reason: `matches preserve pattern: ${pattern.toString()}`,
          confidence: "medium",
        }
      }
    }

    // Default: can compress
    return {
      preserve: false,
      reason: "no semantic preservation needed",
      confidence: "low",
    }
  }

  /**
   * Get compression intensity for a specific tool
   */
  getCompressionIntensity(
    toolName: string,
    context: { recentErrors?: number; isDebugging?: boolean } = {},
  ): "aggressive" | "normal" | "conservative" {
    const importance = calculateToolImportance(toolName)

    // High importance = conservative
    if (importance >= 8) return "conservative"

    // Debugging = conservative
    if (context.isDebugging && importance >= 5) return "conservative"

    // Recent errors = conservative
    if ((context.recentErrors ?? 0) > 0 && importance >= 5) return "conservative"

    // Low importance = aggressive
    if (importance <= 2) return "aggressive"

    return "normal"
  }

  /**
   * Get the compression ratio based on intensity
   */
  getCompressionRatio(intensity: "aggressive" | "normal" | "conservative"): number {
    switch (intensity) {
      case "aggressive":
        return 0.1
      case "normal":
        return 0.3
      case "conservative":
        return 0.5
    }
  }

  /**
   * Update configuration
   */
  updateConfig(partial: Partial<SemanticPreserveConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  /**
   * Get current configuration
   */
  getConfig(): SemanticPreserveConfig {
    return { ...this.config }
  }
}

// ============================================================
// Singleton Instance
// ============================================================

export const semanticPreserver = new SemanticPreserver()

// ============================================================
// Utility Functions
// ============================================================

/**
 * Quick check if content matches error patterns
 */
export function isErrorContent(content: string): boolean {
  return /\berror\b|\bexception\b|\bfailed\b|\bcritical\b/i.test(content)
}

/**
 * Quick check if content matches warning patterns
 */
export function isWarningContent(content: string): boolean {
  return /\bwarning\b|\bwarn\b/i.test(content)
}

/**
 * Check if content is related to git operations
 */
export function isGitOperationContent(content: string): boolean {
  return /git\s+(?:commit|push|pull|merge|checkout|branch)/i.test(content)
}

/**
 * Check if content contains test results
 */
export function isTestResultContent(content: string): boolean {
  return /test\s+(?:passed|failed|error)|\d+\s+(?:passing|failing)/i.test(content)
}

/**
 * Generate a summary for compressed content
 */
export function generateCompressionSummary(
  toolName: string,
  originalLength: number,
  compressedLength: number,
  reason?: string,
): string {
  const ratio = originalLength > 0 ? ((originalLength - compressedLength) / originalLength * 100).toFixed(0) : 0
  const summary = `[Compressed ${toolName} output: ${originalLength} -> ${compressedLength} chars (${ratio}% reduction)]`

  if (reason) {
    return `${summary} Reason: ${reason}`
  }

  return summary
}
