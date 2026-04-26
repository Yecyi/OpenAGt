/**
 * System Prompt Module
 *
 * Implements static/dynamic prompt boundary separation for cache optimization.
 * Static parts (base instructions, conventions) are cached.
 * Dynamic parts (context, reminders) are regenerated per request.
 */

import fs from "fs"
import path from "path"

export const DYNAMIC_BOUNDARY_MARKER = "// SYSTEM_PROMPT_DYNAMIC_BOUNDARY"

// ============================================================
// Types
// ============================================================

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

// ============================================================
// Prompt File Paths
// ============================================================

const PROMPT_DIR = path.join(import.meta.dirname, "prompt")

const PROMPT_FILES: Record<string, string> = {
  default: "default.txt",
  anthropic: "anthropic.txt",
  gpt: "gpt.txt",
  gemini: "gemini.txt",
  kimi: "kimi.txt",
  beast: "beast.txt",
  codex: "codex.txt",
  trinity: "trinity.txt",
  copilot: "copilot-gpt-5.txt",
  plan: "plan.txt",
  common: "common.txt",
}

// ============================================================
// Cache Implementation
// ============================================================

const cache = new Map<string, SystemPromptCache>()

function getCacheKey(model?: string, agentName?: string): string {
  return `${model ?? "default"}:${agentName ?? "default"}`
}

function getCache(model?: string, agentName?: string): SystemPromptCache | undefined {
  return cache.get(getCacheKey(model, agentName))
}

function setCache(model: string | undefined, agentName: string | undefined, data: SystemPromptCache): void {
  cache.set(getCacheKey(model, agentName), data)
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ============================================================
// Prompt Parsing
// ============================================================

export function parsePromptSegments(content: string): PromptSegment[] {
  if (!content || !content.trim()) {
    return []
  }

  const segments: PromptSegment[] = []
  const parts = content.split(DYNAMIC_BOUNDARY_MARKER)

  if (parts.length === 1) {
    segments.push({
      content: content.trim(),
      isStatic: true,
      cacheKey: `static:${estimateTokens(content)}`,
    })
  } else {
    parts.forEach((part, index) => {
      const trimmed = part.trim()
      if (trimmed) {
        segments.push({
          content: trimmed,
          isStatic: index === 0,
          cacheKey: `segment:${index}:${estimateTokens(trimmed)}`,
        })
      }
    })
  }

  return segments
}

export function isStaticSegment(segment: PromptSegment): boolean {
  return segment.isStatic
}

export function isDynamicSegment(segment: PromptSegment): boolean {
  return !segment.isStatic
}

// ============================================================
// Prompt Loading
// ============================================================

export async function loadPromptFile(filename: string): Promise<string> {
  const filepath = path.join(PROMPT_DIR, filename)
  try {
    return await fs.promises.readFile(filepath, "utf-8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return ""
    }
    throw error
  }
}

export function loadPromptFileSync(filename: string): string {
  const filepath = path.join(PROMPT_DIR, filename)
  try {
    return fs.readFileSync(filepath, "utf-8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return ""
    }
    throw error
  }
}

// ============================================================
// Static Prompt Cache
// ============================================================

export async function getStaticPrompt(model?: string): Promise<string> {
  const cacheKey = getCacheKey(model, undefined)
  const cached = cache.get(cacheKey)
  if (cached) return cached.static

  const filename = model ? (PROMPT_FILES[model.toLowerCase()] ?? PROMPT_FILES.default) : PROMPT_FILES.default
  const content = await loadPromptFile(filename)

  const segments = parsePromptSegments(content)
  const staticSegments = segments.filter(isStaticSegment)

  return staticSegments.map((s) => s.content).join("\n\n")
}

export function getStaticPromptSync(model?: string): string {
  const cacheKey = getCacheKey(model, undefined)
  const cached = cache.get(cacheKey)
  if (cached) return cached.static

  const filename = model ? (PROMPT_FILES[model.toLowerCase()] ?? PROMPT_FILES.default) : PROMPT_FILES.default
  const content = loadPromptFileSync(filename)

  const segments = parsePromptSegments(content)
  const staticSegments = segments.filter(isStaticSegment)

  return staticSegments.map((s) => s.content).join("\n\n")
}

// ============================================================
// Full Prompt with Dynamic Content
// ============================================================

export async function getSystemPrompt(
  model?: string,
  dynamicContent?: string,
  options?: SystemPromptOptions,
): Promise<SystemPromptResult> {
  const maxPromptTokens = options?.maxPromptTokens ?? 200000

  // Use cache only for static prompts (no dynamic content)
  if (!dynamicContent) {
    const cached = getCache(model, options?.agentName)
    if (cached) {
      return {
        prompt: cached.full,
        truncated: false,
        skippedSegments: [],
        tokenEstimate: cached.tokenEstimate ?? estimateTokens(cached.full),
      }
    }
  }

  const staticPrompt = await getStaticPrompt(model)
  const fullPrompt = dynamicContent
    ? `${staticPrompt}\n\n${DYNAMIC_BOUNDARY_MARKER}\n\n${dynamicContent}`
    : staticPrompt

  const tokenEstimate = estimateTokens(fullPrompt)
  let truncated = false
  let skippedSegments: string[] = []
  let resultPrompt = fullPrompt

  if (tokenEstimate > maxPromptTokens) {
    const segments = parsePromptSegments(fullPrompt)
    const dynamicSegs = segments.filter(isDynamicSegment)
    const staticSegs = segments.filter(isStaticSegment)

    let currentTokens = estimateTokens(staticSegs.map((s) => s.content).join("\n\n"))
    const keptDynamic: string[] = []

    for (const seg of dynamicSegs) {
      const segTokens = estimateTokens(seg.content)
      if (currentTokens + segTokens <= maxPromptTokens) {
        keptDynamic.push(seg.content)
        currentTokens += segTokens
      } else {
        skippedSegments.push(seg.content.slice(0, 50))
      }
    }

    if (keptDynamic.length < dynamicSegs.length) {
      truncated = true
      resultPrompt = [staticSegs.map((s) => s.content).join("\n\n"), keptDynamic.join("\n\n")]
        .filter(Boolean)
        .join(`\n\n${DYNAMIC_BOUNDARY_MARKER}\n\n`)
    }
  }

  const result: SystemPromptCache = {
    static: staticPrompt,
    dynamic: dynamicContent ?? "",
    full: resultPrompt,
    lastUpdated: Date.now(),
    tokenEstimate,
  }

  setCache(model, options?.agentName, result)
  return {
    prompt: resultPrompt,
    truncated,
    skippedSegments,
    tokenEstimate,
  }
}

export function getSystemPromptSync(
  model?: string,
  dynamicContent?: string,
  options?: SystemPromptOptions,
): SystemPromptResult {
  const staticPrompt = getStaticPromptSync(model)

  if (!dynamicContent) {
    const tokenEstimate = estimateTokens(staticPrompt)
    return {
      prompt: staticPrompt,
      truncated: false,
      skippedSegments: [],
      tokenEstimate,
    }
  }

  const fullPrompt = `${staticPrompt}\n\n${DYNAMIC_BOUNDARY_MARKER}\n\n${dynamicContent}`
  const maxPromptTokens = options?.maxPromptTokens ?? 200000
  const tokenEstimate = estimateTokens(fullPrompt)
  let truncated = false
  let skippedSegments: string[] = []
  let resultPrompt = fullPrompt

  if (tokenEstimate > maxPromptTokens) {
    const segments = parsePromptSegments(fullPrompt)
    const dynamicSegs = segments.filter(isDynamicSegment)
    const staticSegs = segments.filter(isStaticSegment)

    let currentTokens = estimateTokens(staticSegs.map((s) => s.content).join("\n\n"))
    const keptDynamic: string[] = []

    for (const seg of dynamicSegs) {
      const segTokens = estimateTokens(seg.content)
      if (currentTokens + segTokens <= maxPromptTokens) {
        keptDynamic.push(seg.content)
        currentTokens += segTokens
      } else {
        skippedSegments.push(seg.content.slice(0, 50))
      }
    }

    if (keptDynamic.length < dynamicSegs.length) {
      truncated = true
      resultPrompt = [staticSegs.map((s) => s.content).join("\n\n"), keptDynamic.join("\n\n")]
        .filter(Boolean)
        .join(`\n\n${DYNAMIC_BOUNDARY_MARKER}\n\n`)
    }
  }

  return {
    prompt: resultPrompt,
    truncated,
    skippedSegments,
    tokenEstimate,
  }
}

// ============================================================
// Cache Management
// ============================================================

export function invalidateCache(model?: string, agentName?: string): void {
  if (model && agentName) {
    cache.delete(getCacheKey(model, agentName))
  } else if (model) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${model}:`)) {
        cache.delete(key)
      }
    }
  } else {
    cache.clear()
  }
}

export function getCacheStats(): { size: number; entries: Array<{ key: string; age: number }> } {
  const now = Date.now()
  const entries = Array.from(cache.entries()).map(([key, value]) => ({
    key,
    age: now - value.lastUpdated,
  }))

  return {
    size: cache.size,
    entries,
  }
}

export function clearExpiredCache(maxAgeMs: number = 3600000): number {
  const now = Date.now()
  let cleared = 0

  for (const [key, value] of cache.entries()) {
    if (now - value.lastUpdated > maxAgeMs) {
      cache.delete(key)
      cleared++
    }
  }

  return cleared
}

// ============================================================
// Token Estimation
// ============================================================

export function estimatePromptTokens(prompt: string): number {
  return estimateTokens(prompt)
}

export function estimateSavings(staticTokens: number, fullTokens: number): number {
  if (fullTokens === 0) return 0
  return Math.round(((fullTokens - staticTokens) / fullTokens) * 100)
}

// ============================================================
// Dynamic Content Generation Helpers
// ============================================================

export interface DynamicContext {
  sessionID?: string
  workingDirectory?: string
  recentErrors?: string[]
  fileChanges?: string[]
  toolUsage?: string[]
}

export function formatDynamicContext(ctx: DynamicContext): string {
  const parts: string[] = []

  if (ctx.sessionID) {
    parts.push(`Session: ${ctx.sessionID}`)
  }

  if (ctx.workingDirectory) {
    parts.push(`Working Directory: ${ctx.workingDirectory}`)
  }

  if (ctx.recentErrors?.length) {
    parts.push("\n## Recent Errors")
    ctx.recentErrors.forEach((err) => parts.push(`- ${err}`))
  }

  if (ctx.fileChanges?.length) {
    parts.push("\n## Recent Changes")
    ctx.fileChanges.forEach((f) => parts.push(`- ${f}`))
  }

  if (ctx.toolUsage?.length) {
    parts.push("\n## Tool Usage Summary")
    ctx.toolUsage.forEach((t) => parts.push(`- ${t}`))
  }

  return parts.join("\n")
}

// ============================================================
// Exports
// ============================================================

export * as SystemPrompt from "./system-prompt"
