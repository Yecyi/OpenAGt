import { Effect, Layer, Context } from "effect"

export const CONCURRENCY_SAFE_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "webfetch",
  "codesearch",
  "websearch",
  "lsp",
  "question",
  "skill",
])

export const UNSAFE_PATTERNS = new Set([
  "bash",
  "edit",
  "write",
  "task",
  "todo",
  "plan",
  "apply_patch",
])

export function isConcurrencySafe(toolId: string): boolean {
  if (CONCURRENCY_SAFE_TOOLS.has(toolId)) return true
  if (UNSAFE_PATTERNS.has(toolId)) return false
  return false
}

export interface ToolBatch {
  type: "safe" | "unsafe"
  tools: ToolCallItem[]
}

export interface ToolCallItem {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

export function partitionToolCalls(calls: ToolCallItem[]): ToolBatch[] {
  if (calls.length === 0) return []

  const batches: ToolBatch[] = []
  let currentSafeBatch: ToolCallItem[] = []

  for (const call of calls) {
    const safe = isConcurrencySafe(call.toolName)

    if (safe) {
      currentSafeBatch.push(call)
    } else {
      if (currentSafeBatch.length > 0) {
        batches.push({ type: "safe", tools: currentSafeBatch })
        currentSafeBatch = []
      }
      batches.push({ type: "unsafe", tools: [call] })
    }
  }

  if (currentSafeBatch.length > 0) {
    batches.push({ type: "safe", tools: currentSafeBatch })
  }

  return batches
}

export function groupConsecutiveSafeTools(calls: ToolCallItem[]): ToolBatch[] {
  return partitionToolCalls(calls)
}
