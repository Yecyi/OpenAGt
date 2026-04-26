/**
 * Tool Importance Module
 *
 * Defines importance weights for different tool types based on their impact
 * on task completion. Tools with higher importance should be preserved more
 * aggressively during compression.
 */

// ============================================================
// Tool Importance Weights (0-10 scale)
// ============================================================

/**
 * Tool importance weights based on impact to task completion.
 *
 * High importance (8-10): Direct code changes - must preserve details
 * Medium importance (4-7): Contextual information - preserve key parts
 * Low importance (1-3): Search/discovery - can be compressed aggressively
 */
export const TOOL_IMPORTANCE_WEIGHT: Record<string, number> = {
  // ===== Critical Importance (10) =====
  // These tools directly modify code and must preserve full details
  edit: 10, // File edits directly change code
  write: 10, // File writes directly create/modify code
  apply_patch: 10, // Patches directly modify code

  // ===== High Importance (8-9) =====
  // These tools have significant impact on the codebase state
  apply_diff: 9, // Diff application modifies code
  apply_plan: 9, // Plan execution modifies code
  bash_commit: 9, // Git commits are important milestones
  git_commit: 9, // Git commits are important milestones
  bash: 8, // Any bash can have important side effects

  // ===== Medium-High Importance (6-7) =====
  // These provide important context for current task
  read: 7, // Read content may be current task context
  todo_write: 6, // Todo tasks affect future planning
  ask: 5, // User questions affect direction

  // ===== Medium Importance (4-5) =====
  // These provide useful but not critical information
  grep: 4, // Search results can be summarized
  search: 4, // General search results
  ls: 3, // Directory listing is somewhat useful

  // ===== Low Importance (1-3) =====
  // These are typically discovery/exploration and can be compressed aggressively
  glob: 3, // File discovery is fairly generic
  websearch: 2, // Web search results can be summarized
  webfetch: 2, // Web fetch content is usually not critical
  codesearch: 3, // Code search results can be summarized
  lsp: 2, // LSP operations are technical details

  // ===== Minimal Importance (0-1) =====
  // These provide minimal value for task continuation
  ping: 0, // Connectivity check
  echo: 0, // Echo is for testing
}

// ============================================================
// Special Content Patterns
// ============================================================

export interface ContentPattern {
  pattern: RegExp
  weight: number
  reason: string
}

/**
 * Content patterns that should be preserved regardless of tool importance.
 * These patterns indicate critical information like errors or important outcomes.
 */
export const PRESERVE_CONTENT_PATTERNS: ContentPattern[] = [
  // Error patterns - must preserve to avoid repeating failed operations
  {
    pattern: /\berror\b.*(?:failed|cannot|unable|denied)/i,
    weight: 10,
    reason: "Error with actionable information",
  },
  {
    pattern: /(?<!\w)Error(?!\w):/i,
    weight: 10,
    reason: "Error message",
  },
  {
    pattern: /(?<!\w)Exception(?!\w)/i,
    weight: 9,
    reason: "Exception message",
  },
  {
    pattern: /(?<!\w)FAILED(?!\w)/i,
    weight: 9,
    reason: "Failure indication",
  },
  {
    pattern: /(?<!\w)CRITICAL(?!\w)/i,
    weight: 9,
    reason: "Critical issue",
  },

  // Warning patterns - should preserve for awareness
  {
    pattern: /(?<!\w)WARNING(?!\w)/i,
    weight: 7,
    reason: "Warning message",
  },
  {
    pattern: /(?<!\w)WARN(?!\w)/i,
    weight: 6,
    reason: "Warning abbreviation",
  },

  // Git operation results - important for understanding changes
  {
    pattern: /git\s+(?:commit|push|pull|merge|checkout|branch)/i,
    weight: 8,
    reason: "Git operation",
  },
  {
    pattern: /\[master|main\].*\|\s*\d+\s+deletion/i,
    weight: 7,
    reason: "Git file deletion",
  },

  // Test results - important for understanding current state
  {
    pattern: /test\s+(?:passed|failed|error)/i,
    weight: 7,
    reason: "Test result",
  },
  {
    pattern: /\d+\s+passing|\d+\s+failing/i,
    weight: 7,
    reason: "Test summary",
  },

  // Build results - important for understanding project state
  {
    pattern: /build\s+(?:success|failed|error)/i,
    weight: 7,
    reason: "Build result",
  },
  {
    pattern: /compilation\s+error/i,
    weight: 8,
    reason: "Compilation error",
  },
]

// ============================================================
// Helper Functions
// ============================================================

/**
 * Calculate the importance weight for a tool
 */
export function calculateToolImportance(toolName: string): number {
  return TOOL_IMPORTANCE_WEIGHT[toolName] ?? 1
}

/**
 * Get the preservation weight for content based on patterns
 * Returns the highest matching pattern's weight
 */
export function getContentPreservationWeight(content: string): number {
  let maxWeight = 0

  for (const { pattern, weight } of PRESERVE_CONTENT_PATTERNS) {
    if (pattern.test(content)) {
      maxWeight = Math.max(maxWeight, weight)
    }
  }

  return maxWeight
}

/**
 * Check if content should be preserved based on patterns
 */
export function shouldPreserveByContent(content: string): boolean {
  return getContentPreservationWeight(content) >= 7
}

/**
 * Get the reason for content preservation
 */
export function getPreservationReason(content: string): string | undefined {
  for (const { pattern, weight, reason } of PRESERVE_CONTENT_PATTERNS) {
    if (pattern.test(content) && weight >= 7) {
      return reason
    }
  }
  return undefined
}

/**
 * Calculate combined importance score for compression decisions
 *
 * @param toolName - The name of the tool
 * @param content - The output content of the tool
 * @param age - Age of the tool call in milliseconds
 * @returns A priority score where higher = more important to preserve
 */
export function calculateCompressionPriority(toolName: string, content: string, age: number): number {
  const toolImportance = calculateToolImportance(toolName)
  const contentWeight = getContentPreservationWeight(content)

  // Combined priority formula:
  // - Age is weighted logarithmically (older = higher priority to compress)
  // - Tool importance multiplies the base priority
  // - Content weight adds additional priority if content is critical
  const ageWeight = Math.log2(age / (60 * 1000) + 1) // log of age in minutes + 1
  const contentBonus = contentWeight > 0 ? contentWeight * 0.5 : 0

  return ageWeight * toolImportance + contentBonus
}

/**
 * Determine compression intensity level for a tool
 *
 * @param toolName - The name of the tool
 * @param context - Additional context like recent errors
 * @returns Compression intensity recommendation
 */
export type CompressionIntensity = "aggressive" | "normal" | "conservative"

export function getCompressionIntensity(
  toolName: string,
  context: { recentErrors?: number; isDebugging?: boolean } = {},
): CompressionIntensity {
  const importance = calculateToolImportance(toolName)

  // High importance tools should be conservative
  if (importance >= 8) return "conservative"

  // If debugging, be more conservative
  if (context.isDebugging && importance >= 5) return "conservative"

  // If recent errors, be more conservative with medium importance tools
  if ((context.recentErrors ?? 0) > 0 && importance >= 5) return "conservative"

  // Low importance tools can be aggressive
  if (importance <= 2) return "aggressive"

  // Default to normal
  return "normal"
}

/**
 * Get compression ratio based on intensity
 */
export function getCompressionRatio(intensity: CompressionIntensity): number {
  switch (intensity) {
    case "aggressive":
      return 0.1 // Keep only 10% of content
    case "normal":
      return 0.3 // Keep 30% of content
    case "conservative":
      return 0.5 // Keep 50% of content
  }
}
