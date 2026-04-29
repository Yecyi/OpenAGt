import type { MemoryScope as MemoryScopeType } from "./schema"

// Scope-weight ordering reflects retrieval-priority: session is the freshest
// context; semantic/procedural are long-lived knowledge so they outrank
// workspace/profile but stay below the live session.
export const scopeWeight = {
  session: 30,
  semantic: 25,
  procedural: 22,
  workspace: 20,
  profile: 10,
} as const satisfies Record<MemoryScopeType, number>

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function lexicalScore(text: string, query: string) {
  if (!query.trim()) return 0
  const haystack = text.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .reduce((score, token) => score + (haystack.includes(token) ? 3 : 0), 0)
}

export function recencyScore(updatedAt: number) {
  const ageHours = Math.max(0, (Date.now() - updatedAt) / 3_600_000)
  return clamp(10 - ageHours / 24, 0, 10)
}

export function escapeFts(query: string) {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" ")
}

export function tagScore(
  tags: string[],
  input: {
    workflow?: string
    expertID?: string
    role?: string
    artifactType?: string
    includeFailurePatterns?: boolean
  },
) {
  return (
    (input.expertID && tags.includes(`expert:${input.expertID}`) ? 40 : 0) +
    (input.workflow && tags.includes(`workflow:${input.workflow}`) ? 30 : 0) +
    (input.role && tags.includes(`role:${input.role}`) ? 20 : 0) +
    (input.artifactType && tags.includes(`artifact:${input.artifactType}`) ? 15 : 0) +
    (input.includeFailurePatterns && tags.includes("failure-pattern") ? 12 : 0)
  )
}
