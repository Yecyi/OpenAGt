// Manages SystemPrompt cache keys, entries, and expiration.
// It does not parse prompt content, load files, or assemble prompt text.
import type { SystemPromptCache } from "./system-prompt-contracts"

const cache = new Map<string, SystemPromptCache>()

export function getCacheKey(model?: string, agentName?: string): string {
  return `${model ?? "default"}:${agentName ?? "default"}`
}

export function getCache(model?: string, agentName?: string): SystemPromptCache | undefined {
  return cache.get(getCacheKey(model, agentName))
}

export function setCache(model: string | undefined, agentName: string | undefined, data: SystemPromptCache): void {
  cache.set(getCacheKey(model, agentName), data)
}

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
