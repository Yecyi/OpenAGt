/**
 * Prompt Constants Module
 *
 * A-P2-2: Static/Dynamic Prompt Boundary
 * Implements cache-safe prompt architecture similar to Claude Code.
 *
 * Key concepts:
 * - STATIC sections: Can be cached globally (don't change per session)
 * - DYNAMIC sections: Session-specific, cannot be cached
 * - BOUNDARY marker: Separates static from dynamic for cache optimization
 */

/**
 * Boundary marker that separates static (cacheable) from dynamic (session-specific) prompt sections.
 * Used by provider to optimize token usage when caching is supported.
 */
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"

/**
 * Prompt section types for cache optimization
 */
export const PROMPT_SECTION_TYPES = {
  /** Sections that don't change between sessions - can be cached globally */
  STATIC: "static",
  /** Sections that change per session but infrequently - semi-cacheable */
  SEMI_STATIC: "semiStatic",
  /** Sections that change every request - cannot be cached */
  DYNAMIC: "dynamic",
} as const

export type PromptSectionType = (typeof PROMPT_SECTION_TYPES)[keyof typeof PROMPT_SECTION_TYPES]

/**
 * Categorize prompt sections for cache optimization
 */
export interface PromptSection {
  name: string
  type: PromptSectionType
  content: string
}

/**
 * Default section categorization for OpenAGt
 * These guide cache decisions but actual categorization happens in SystemPrompt.Service
 */
export const DEFAULT_SECTION_CATEGORIES: Record<string, PromptSectionType> = {
  // Static: Can be cached globally
  static: PROMPT_SECTION_TYPES.STATIC,

  // Semi-static: Changes per session but not per request
  semiStatic: PROMPT_SECTION_TYPES.SEMI_STATIC,

  // Dynamic: Changes every request
  dynamic: PROMPT_SECTION_TYPES.DYNAMIC,
}

/**
 * Tool schema cache key components
 * Tool schemas participate in cache key to prevent mid-session schema drift
 */
export interface ToolCacheKeyParts {
  scope: string | null
  toolSchemas: Array<{ name: string; schema: string }>
}

/**
 * Generate cache key parts for tool schemas
 * Tool names and JSON schemas are sorted to ensure consistent keys
 */
export function generateToolCacheKeyParts(
  scope: string | null,
  tools: Array<{ name: string; inputJSONSchema?: string }>,
): ToolCacheKeyParts {
  const sortedTools = [...tools]
    .filter((t) => t.inputJSONSchema)
    .map((t) => ({
      name: t.name,
      schema: t.inputJSONSchema!,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    scope,
    toolSchemas: sortedTools,
  }
}

/**
 * Format tool cache key for logging/debugging
 */
export function formatToolCacheKey(parts: ToolCacheKeyParts): string {
  const scopePart = parts.scope ? `[${parts.scope}]` : ""
  const toolsPart = parts.toolSchemas.map((t) => `${t.name}:${t.schema.slice(0, 8)}`).join(",")
  return `${scopePart}${toolsPart}`
}

/**
 * Prompt cache configuration
 */
export interface PromptCacheConfig {
  /** Enable static/dynamic boundary separation */
  enabled: boolean
  /** Include tool schemas in cache key */
  includeToolSchemas: boolean
  /** Include session ID in cache key (for semi-static sections) */
  includeSessionId: boolean
}

export const DEFAULT_PROMPT_CACHE_CONFIG: PromptCacheConfig = {
  enabled: true,
  includeToolSchemas: true,
  includeSessionId: false,
}
