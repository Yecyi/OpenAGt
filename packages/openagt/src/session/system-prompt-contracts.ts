// Defines SystemPrompt data contracts and boundary markers.
// It does not load prompt files, estimate tokens, or mutate cache state.

export const DYNAMIC_BOUNDARY_MARKER = "// SYSTEM_PROMPT_DYNAMIC_BOUNDARY"

export interface PromptSegment {
  content: string
  isStatic: boolean
  cacheKey?: string
  lastUpdated?: number
}

export interface SystemPromptCache {
  static: string
  dynamic: string
  full: string
  lastUpdated: number
  tokenEstimate?: number
}

export interface SystemPromptOptions {
  sessionID?: string
  agentName?: string
  model?: string
  includeDynamic?: boolean
  maxPromptTokens?: number
}

export interface SystemPromptResult {
  prompt: string
  truncated: boolean
  skippedSegments: string[]
  tokenEstimate: number
}

export interface DynamicContext {
  sessionID?: string
  workingDirectory?: string
  recentErrors?: string[]
  fileChanges?: string[]
  toolUsage?: string[]
}
