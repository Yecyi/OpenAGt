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

export const UNSAFE_PATTERNS = new Set(["bash", "edit", "write", "todo", "plan", "apply_patch"])

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function isReadOnlyTask(input: Record<string, unknown> | undefined) {
  if (!input) return false
  if (typeof input.task_id === "string") return false
  if (stringArray(input.write_scope).length > 0) return false
  if (stringArray(input.depends_on).length > 0) return false
  if (input.task_kind === "implement") return false
  if (input.task_kind === "research" || input.task_kind === "verify") return true
  return input.subagent_type === "explore"
}

export function isConcurrencySafe(toolId: string, input?: Record<string, unknown>): boolean {
  if (toolId === "task") return isReadOnlyTask(input)
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
    const safe = isConcurrencySafe(call.toolName, call.input)

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
