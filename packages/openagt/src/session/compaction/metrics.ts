/**
 * Compression Metrics Module
 *
 * Tracks compression effectiveness and quality to enable data-driven
 * threshold adjustments and compression optimization.
 */

import path from "path"
import os from "os"
import fs from "fs"
import { calculateToolImportance } from "./importance"
import { Log } from "@/util"

const log = Log.create({ service: "compaction.metrics" })

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

export interface PromptCacheMetrics {
  staticHash: string | null
  staticHashStable: boolean
  cacheHitRatio: number
  dynamicBytes: number
}

export interface CompactionEvent {
  tier: "micro" | "auto" | "semantic" | "full"
  durationMs: number
  tokenReductionPct: number
  tokensSaved: number
}

export interface SecurityEvent {
  type: "permission_grant" | "compound_classification" | "symlink_correction" | "advisory_refusal" | "block"
  timestamp: number
  sessionID: string
  pattern?: string
  riskLevel?: "safe" | "low" | "medium" | "high"
  commandSample?: string
  findings?: string[]
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
    tier?: "micro" | "auto" | "semantic" | "full",
    durationMs?: number,
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

    // C-1: Emit compaction tier_chosen, duration_ms, token_reduction_pct metrics
    if (tier) {
      log.info("compaction.tier_chosen", { tier, toolName, tokensSaved })
    }
    if (durationMs !== undefined) {
      log.info("compaction.duration_ms", { tier, durationMs })
    }
    if (this.metrics.totalCompressed > 0 && originalTokens > 0) {
      const tokenReductionPct = (tokensSaved / originalTokens) * 100
      log.info("compaction.token_reduction_pct", { tier, tokenReductionPct })
    }
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
// Prompt Cache Metrics Tracker
// ============================================================

export class PromptCacheMetricsTracker {
  private previousStaticHash: string | null = null
  private cacheHits = 0
  private cacheMisses = 0
  private dynamicBytesTotal = 0

  recordStaticHash(hash: string): void {
    if (this.previousStaticHash !== null && this.previousStaticHash !== hash) {
      log.warn("prompt static hash changed within session", {
        previous: this.previousStaticHash,
        current: hash,
      })
    }
    this.previousStaticHash = hash

    // C-1: Emit static hash metric
    log.info("prompt.static_hash", { hash })
  }

  recordCacheHit(): void {
    this.cacheHits++
    // C-1: Emit cache hit ratio metric
    log.info("prompt.cache_hit_ratio", { ratio: this.getCacheHitRatio(), hits: this.cacheHits, misses: this.cacheMisses })
  }

  recordCacheMiss(): void {
    this.cacheMisses++
    // C-1: Emit cache hit ratio metric
    log.info("prompt.cache_hit_ratio", { ratio: this.getCacheHitRatio(), hits: this.cacheHits, misses: this.cacheMisses })
  }

  recordDynamicBytes(bytes: number): void {
    this.dynamicBytesTotal += bytes
    // C-1: Emit dynamic bytes metric
    log.info("prompt.dynamic_bytes", { bytes, total: this.dynamicBytesTotal })
  }

  getCacheHitRatio(): number {
    const total = this.cacheHits + this.cacheMisses
    if (total === 0) return 0
    return this.cacheHits / total
  }

  getMetrics(): PromptCacheMetrics {
    return {
      staticHash: this.previousStaticHash,
      staticHashStable: this.previousStaticHash !== null,
      cacheHitRatio: this.getCacheHitRatio(),
      dynamicBytes: this.dynamicBytesTotal,
    }
  }

  reset(): void {
    this.previousStaticHash = null
    this.cacheHits = 0
    this.cacheMisses = 0
    this.dynamicBytesTotal = 0
  }
}

export const promptCacheMetrics = new PromptCacheMetricsTracker()

// ============================================================
// Security Audit Event Tracker
// ============================================================

export class SecurityAuditTracker {
  private events: SecurityEvent[] = []
  private readonly maxEvents = 1000

  recordEvent(event: Omit<SecurityEvent, "timestamp">): void {
    const fullEvent: SecurityEvent = {
      ...event,
      timestamp: Date.now(),
    }
    this.events.push(fullEvent)
    if (this.events.length > this.maxEvents) {
      this.events.shift()
    }

    // C-2: Emit to unified security event stream
    const logEntry = {
      type: fullEvent.type,
      timestamp: fullEvent.timestamp,
      sessionID: fullEvent.sessionID,
      pattern: fullEvent.pattern,
      riskLevel: fullEvent.riskLevel,
      commandSample: fullEvent.commandSample ? this.truncateCommand(fullEvent.commandSample) : undefined,
      findings: fullEvent.findings,
    }
    log.info("security_audit_event", logEntry)

    // Write to persistent audit file (async, non-blocking)
    void this.writeToAuditFile(logEntry)
  }

  private async writeToAuditFile(entry: Record<string, unknown>): Promise<void> {
    try {
      const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
      const auditDir = path.join(stateHome, "opencode")
      const auditFile = path.join(auditDir, "security.audit.jsonl")

      // Ensure directory exists
      await fs.promises.mkdir(auditDir, { recursive: true })

      // Redact command strings >256 bytes
      if (entry.commandSample && typeof entry.commandSample === "string" && entry.commandSample.length > 256) {
        entry.commandSample = entry.commandSample.slice(0, 256) + "...[redacted]"
      }

      const line = JSON.stringify(entry) + "\n"
      await fs.promises.appendFile(auditFile, line, "utf-8")
    } catch (error) {
      // Non-blocking - don't fail on audit errors
      log.warn("failed to write security audit log", { error })
    }
  }

  private truncateCommand(cmd: string, maxLength = 256): string {
    if (cmd.length <= maxLength) return cmd
    return cmd.slice(0, maxLength) + "...[truncated]"
  }

  recordPermissionGrant(sessionID: string, pattern: string): void {
    this.recordEvent({ type: "permission_grant", sessionID, pattern })
  }

  recordCompoundClassification(sessionID: string, pattern: string, riskLevel: "safe" | "low" | "medium" | "high", findings: string[]): void {
    this.recordEvent({
      type: "compound_classification",
      sessionID,
      pattern,
      riskLevel,
      findings,
    })
  }

  recordSymlinkCorrection(sessionID: string, commandSample: string): void {
    this.recordEvent({ type: "symlink_correction", sessionID, commandSample })
  }

  recordAdvisoryRefusal(sessionID: string, commandSample: string, riskLevel: "medium" | "high"): void {
    this.recordEvent({
      type: "advisory_refusal",
      sessionID,
      commandSample,
      riskLevel,
    })
  }

  recordBlock(sessionID: string, commandSample: string, riskLevel: "medium" | "high", findings: string[]): void {
    this.recordEvent({
      type: "block",
      sessionID,
      commandSample,
      riskLevel,
      findings,
    })
  }

  getRecentEvents(count = 100): SecurityEvent[] {
    return this.events.slice(-count)
  }
}

export const securityAudit = new SecurityAuditTracker()

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
