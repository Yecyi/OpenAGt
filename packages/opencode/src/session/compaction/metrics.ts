/**
 * Compression Metrics Module
 *
 * Tracks compression effectiveness and quality to enable data-driven
 * threshold adjustments and compression optimization.
 */

import { calculateToolImportance } from "./importance"

// ============================================================
// Types
// ============================================================

export interface CompressionRecord {
  timestamp: number
  toolName: string
  originalTokens: number
  compressedTokens: number
  qualityFeedback?: "good" | "acceptable" | "bad"
  taskCompleted?: boolean
}

export interface ToolTypeStats {
  compressed: number
  avgTokensSaved: number
  maxTokensSaved: number
  totalOriginalTokens: number
  totalCompressedTokens: number
}

export interface CompressionMetrics {
  totalCompressed: number
  totalTokensSaved: number
  byToolType: Record<string, ToolTypeStats>
  qualityScore: number
  recentRecords: CompressionRecord[]
}

export interface ThresholdAdjustment {
  action: "increase" | "decrease" | "stable"
  reason: string
  confidence: "low" | "medium" | "high"
}

// ============================================================
// Compression Tracker
// ============================================================

export class CompressionTracker {
  private metrics: CompressionMetrics = {
    totalCompressed: 0,
    totalTokensSaved: 0,
    byToolType: {},
    qualityScore: 0.8, // Default to acceptable
    recentRecords: [],
  }

  private readonly maxRecentRecords = 100
  private readonly qualityFeedbackWindow = 20

  /**
   * Record a compression event
   */
  recordCompression(
    toolName: string,
    originalTokens: number,
    compressedTokens: number,
  ): void {
    const tokensSaved = originalTokens - compressedTokens

    this.metrics.totalCompressed++
    this.metrics.totalTokensSaved += tokensSaved

    // Update tool-specific stats
    if (!this.metrics.byToolType[toolName]) {
      this.metrics.byToolType[toolName] = {
        compressed: 0,
        avgTokensSaved: 0,
        maxTokensSaved: 0,
        totalOriginalTokens: 0,
        totalCompressedTokens: 0,
      }
    }

    const stats = this.metrics.byToolType[toolName]
    stats.compressed++
    stats.totalOriginalTokens += originalTokens
    stats.totalCompressedTokens += compressedTokens
    stats.avgTokensSaved =
      (stats.avgTokensSaved * (stats.compressed - 1) + tokensSaved) / stats.compressed
    stats.maxTokensSaved = Math.max(stats.maxTokensSaved, tokensSaved)

    // Add to recent records
    this.metrics.recentRecords.push({
      timestamp: Date.now(),
      toolName,
      originalTokens,
      compressedTokens,
    })

    // Trim if over limit
    if (this.metrics.recentRecords.length > this.maxRecentRecords) {
      this.metrics.recentRecords.shift()
    }

    // Recalculate quality score
    this.updateQualityScore()
  }

  /**
   * Record quality feedback for a compression event
   */
  recordQualityFeedback(index: number, feedback: "good" | "acceptable" | "bad"): void {
    if (index >= 0 && index < this.metrics.recentRecords.length) {
      this.metrics.recentRecords[index].qualityFeedback = feedback
      this.updateQualityScore()
    }
  }

  /**
   * Record task completion status after compression
   */
  recordTaskCompletion(index: number, completed: boolean): void {
    if (index >= 0 && index < this.metrics.recentRecords.length) {
      this.metrics.recentRecords[index].taskCompleted = completed
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): CompressionMetrics {
    return {
      ...this.metrics,
      byToolType: { ...this.metrics.byToolType },
      recentRecords: [...this.metrics.recentRecords],
    }
  }

  /**
   * Get metrics summary for logging
   */
  getSummary(): {
    totalCompressed: number
    totalTokensSaved: number
    qualityScore: number
    topToolTypes: Array<{ tool: string; count: number; avgSaved: number }>
  } {
    const topToolTypes = Object.entries(this.metrics.byToolType)
      .map(([tool, stats]) => ({
        tool,
        count: stats.compressed,
        avgSaved: Math.round(stats.avgTokensSaved),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    return {
      totalCompressed: this.metrics.totalCompressed,
      totalTokensSaved: this.metrics.totalTokensSaved,
      qualityScore: Math.round(this.metrics.qualityScore * 100) / 100,
      topToolTypes,
    }
  }

  /**
   * Determine if compression threshold should be adjusted based on historical data
   */
  shouldAdjustThreshold(): ThresholdAdjustment {
    const recentWithFeedback = this.getRecentWithFeedback()

    if (recentWithFeedback.length < 5) {
      return {
        action: "stable",
        reason: "insufficient feedback data",
        confidence: "low",
      }
    }

    const badCount = recentWithFeedback.filter((r) => r.qualityFeedback === "bad").length
    const goodCount = recentWithFeedback.filter((r) => r.qualityFeedback === "good").length
    const acceptableCount = recentWithFeedback.filter((r) => r.qualityFeedback === "acceptable").length

    const badRatio = badCount / recentWithFeedback.length
    const goodRatio = goodCount / recentWithFeedback.length

    // Too many bad compressions - decrease aggressiveness
    if (badRatio > 0.3) {
      return {
        action: "decrease",
        reason: `too many poor compressions: ${(badRatio * 100).toFixed(0)}% bad`,
        confidence: "high",
      }
    }

    // High quality compressions with good savings - can increase aggressiveness
    if (goodRatio > 0.6 && this.metrics.totalTokensSaved > 50000) {
      return {
        action: "increase",
        reason: "high quality compressions, can be more aggressive",
        confidence: "medium",
      }
    }

    // Mostly acceptable - stable
    return {
      action: "stable",
      reason: "compression quality is acceptable",
      confidence: "medium",
    }
  }

  /**
   * Get compression efficiency by tool type
   */
  getEfficiencyByToolType(): Array<{
    tool: string
    efficiency: number
    avgTokensSaved: number
  }> {
    return Object.entries(this.metrics.byToolType)
      .map(([tool, stats]) => ({
        tool,
        efficiency: stats.totalOriginalTokens > 0
          ? (stats.totalOriginalTokens - stats.totalCompressedTokens) / stats.totalOriginalTokens
          : 0,
        avgTokensSaved: Math.round(stats.avgTokensSaved),
      }))
      .sort((a, b) => b.efficiency - a.efficiency)
  }

  /**
   * Get recent records with quality feedback
   */
  private getRecentWithFeedback(): CompressionRecord[] {
    return this.metrics.recentRecords
      .slice(-this.qualityFeedbackWindow)
      .filter((r) => r.qualityFeedback !== undefined)
  }

  /**
   * Update quality score based on recent feedback
   */
  private updateQualityScore(): void {
    const withFeedback = this.getRecentWithFeedback()

    if (withFeedback.length === 0) {
      // Default quality when no feedback
      this.metrics.qualityScore = 0.8
      return
    }

    const scores: number[] = []
    for (const r of withFeedback) {
      switch (r.qualityFeedback) {
        case "good":
          scores.push(1.0)
          break
        case "acceptable":
          scores.push(0.7)
          break
        case "bad":
          scores.push(0.3)
          break
      }
    }

    this.metrics.qualityScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0.8
  }

  /**
   * Reset metrics (for testing)
   */
  reset(): void {
    this.metrics = {
      totalCompressed: 0,
      totalTokensSaved: 0,
      byToolType: {},
      qualityScore: 0.8,
      recentRecords: [],
    }
  }
}

// ============================================================
// Singleton Instance
// ============================================================

export const compressionTracker = new CompressionTracker()

// ============================================================
// Utility Functions
// ============================================================

/**
 * Estimate tokens from character count
 */
export function estimateTokens(chars: number): number {
  // Rough estimate: ~4 characters per token for English
  return Math.ceil(chars / 4)
}

/**
 * Calculate actual compression ratio
 */
export function calculateCompressionRatio(original: number, compressed: number): number {
  if (original === 0) return 0
  return (original - compressed) / original
}
