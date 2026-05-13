/**
 * System Prompt Module
 *
 * Implements static/dynamic prompt boundary separation for cache optimization.
 * Static parts (base instructions, conventions) are cached.
 * Dynamic parts (context, reminders) are regenerated per request.
 */

import fs from "fs"
import path from "path"
import { Log } from "@/util"
import {
  DYNAMIC_BOUNDARY_MARKER,
  type DynamicContext,
  type SystemPromptCache,
  type SystemPromptOptions,
  type SystemPromptResult,
} from "./system-prompt-contracts"
import { getCache, setCache } from "./system-prompt-cache"
import { estimatePromptTokens, isDynamicSegment, isStaticSegment, parsePromptSegments } from "./system-prompt-parser"

const log = Log.create({ service: "system-prompt-loader" })

export * from "./system-prompt-contracts"
export { clearExpiredCache, getCacheStats, invalidateCache } from "./system-prompt-cache"
export {
  estimatePromptTokens,
  estimateSavings,
  isDynamicSegment,
  isStaticSegment,
  parsePromptSegments,
} from "./system-prompt-parser"

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
// Prompt Loading
// ============================================================

// A missing prompt file used to silently resolve to an empty string, which
// meant a typo in PROMPT_FILES would ship an empty system prompt without any
// signal in the logs. We now log loudly and rethrow so misconfigurations
// surface immediately. Callers that genuinely need optional fallback behavior
// should catch the error explicitly and decide what to do.
function reportMissing(filepath: string, error: NodeJS.ErrnoException): never {
  log.error("prompt file not found", { filepath, code: error.code })
  throw error
}

export async function loadPromptFile(filename: string): Promise<string> {
  const filepath = path.join(PROMPT_DIR, filename)
  try {
    return await fs.promises.readFile(filepath, "utf-8")
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === "ENOENT") return reportMissing(filepath, err)
    throw err
  }
}

export function loadPromptFileSync(filename: string): string {
  const filepath = path.join(PROMPT_DIR, filename)
  try {
    return fs.readFileSync(filepath, "utf-8")
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === "ENOENT") return reportMissing(filepath, err)
    throw err
  }
}

// ============================================================
// Static Prompt Cache
// ============================================================

export async function getStaticPrompt(model?: string): Promise<string> {
  const cached = getCache(model, undefined)
  if (cached) return cached.static

  const filename = model ? (PROMPT_FILES[model.toLowerCase()] ?? PROMPT_FILES.default) : PROMPT_FILES.default
  const content = await loadPromptFile(filename)

  const segments = parsePromptSegments(content)
  const staticSegments = segments.filter(isStaticSegment)

  return staticSegments.map((s) => s.content).join("\n\n")
}

export function getStaticPromptSync(model?: string): string {
  const cached = getCache(model, undefined)
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
        tokenEstimate: cached.tokenEstimate ?? estimatePromptTokens(cached.full),
      }
    }
  }

  const staticPrompt = await getStaticPrompt(model)
  const fullPrompt = dynamicContent
    ? `${staticPrompt}\n\n${DYNAMIC_BOUNDARY_MARKER}\n\n${dynamicContent}`
    : staticPrompt

  const tokenEstimate = estimatePromptTokens(fullPrompt)
  let truncated = false
  let skippedSegments: string[] = []
  let resultPrompt = fullPrompt

  if (tokenEstimate > maxPromptTokens) {
    const segments = parsePromptSegments(fullPrompt)
    const dynamicSegs = segments.filter(isDynamicSegment)
    const staticSegs = segments.filter(isStaticSegment)

    let currentTokens = estimatePromptTokens(staticSegs.map((s) => s.content).join("\n\n"))
    const keptDynamic: string[] = []

    for (const seg of dynamicSegs) {
      const segTokens = estimatePromptTokens(seg.content)
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
    const tokenEstimate = estimatePromptTokens(staticPrompt)
    return {
      prompt: staticPrompt,
      truncated: false,
      skippedSegments: [],
      tokenEstimate,
    }
  }

  const fullPrompt = `${staticPrompt}\n\n${DYNAMIC_BOUNDARY_MARKER}\n\n${dynamicContent}`
  const maxPromptTokens = options?.maxPromptTokens ?? 200000
  const tokenEstimate = estimatePromptTokens(fullPrompt)
  let truncated = false
  let skippedSegments: string[] = []
  let resultPrompt = fullPrompt

  if (tokenEstimate > maxPromptTokens) {
    const segments = parsePromptSegments(fullPrompt)
    const dynamicSegs = segments.filter(isDynamicSegment)
    const staticSegs = segments.filter(isStaticSegment)

    let currentTokens = estimatePromptTokens(staticSegs.map((s) => s.content).join("\n\n"))
    const keptDynamic: string[] = []

    for (const seg of dynamicSegs) {
      const segTokens = estimatePromptTokens(seg.content)
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
// Dynamic Content Generation Helpers
// ============================================================

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
