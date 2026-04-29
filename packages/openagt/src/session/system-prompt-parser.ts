// Parses system prompt segments and estimates token costs.
// It does not read prompt files, build full prompts, or mutate cache state.
import { Token } from "@/util"
import { DYNAMIC_BOUNDARY_MARKER, type PromptSegment } from "./system-prompt-contracts"

function estimateTokens(text: string): number {
  return Token.estimate(text)
}

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

export function estimatePromptTokens(prompt: string): number {
  return estimateTokens(prompt)
}

export function estimateSavings(staticTokens: number, fullTokens: number): number {
  if (fullTokens === 0) return 0
  return Math.round(((fullTokens - staticTokens) / fullTokens) * 100)
}
