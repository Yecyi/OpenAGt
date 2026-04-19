import { Effect } from "effect"
import { Log, Token } from "@/util"

const log = Log.create({ service: "tool.summary" })

export interface ToolUseSummary {
  toolName: string
  summary: string
  tokens: number
  timestamp: number
}

/**
 * Generate a concise summary of tool use for display purposes
 * Similar to Claude Code's tool use summary generator
 */
export function generateToolUseSummary(
  toolName: string,
  input: Record<string, unknown>,
  output: string
): ToolUseSummary {
  const summary = buildSummary(toolName, input, output)
  return {
    toolName,
    summary,
    tokens: Token.estimate(output),
    timestamp: Date.now(),
  }
}

/**
 * Build a human-readable summary string for a tool execution
 */
function buildSummary(
  toolName: string,
  input: Record<string, unknown>,
  output: string
): string {
  switch (toolName) {
    case "read": {
      const path = input.path as string
      const lines = output.split("\n").length
      return `Read ${path} (${lines} lines)`
    }

    case "glob": {
      const pattern = input.pattern as string
      const matches = output.split("\n").filter(l => l.trim()).length
      return `Glob ${pattern} (${matches} matches)`
    }

    case "grep": {
      const pattern = input.pattern as string
      const matches = output.split("\n").filter(l => l.trim()).length
      return `Grep "${pattern}" (${matches} matches)`
    }

    case "bash": {
      const command = (input.command as string)?.slice(0, 50)
      const lines = output.split("\n").length
      return `Bash: ${command}... (${lines} lines output)`
    }

    case "write": {
      const path = input.path as string
      const content = input.content as string
      const lines = content.split("\n").length
      return `Write ${path} (${lines} lines)`
    }

    case "edit": {
      const path = input.path as string
      return `Edit ${path}`
    }

    case "websearch": {
      const query = input.query as string
      return `Web search: ${query}`
    }

    case "webfetch": {
      const url = input.url as string
      return `Fetch ${url}`
    }

    case "codesearch": {
      const pattern = input.pattern as string
      const matches = output.split("\n").filter(l => l.trim()).length
      return `Code search "${pattern}" (${matches} matches)`
    }

    case "todo": {
      const tasks = input.tasks as Array<{ content?: string; status?: string }> | undefined
      if (tasks) {
        const completed = tasks.filter(t => t.status === "completed").length
        return `Todo list: ${completed}/${tasks.length} completed`
      }
      return "Todo update"
    }

    case "plan": {
      const mode = input.mode as string
      return `Plan mode: ${mode ?? "update"}`
    }

    case "task": {
      const taskType = input.type as string
      return `Task: ${taskType ?? "run"}`
    }

    default:
      return `${toolName} executed`
  }
}

/**
 * Generate a compact summary for a batch of tool executions
 */
export function summarizeToolBatch(
  results: Array<{ toolName: string; input: Record<string, unknown>; output: string }>
): string {
  if (results.length === 0) return "No tools executed"

  const summaries = results.map(r => generateToolUseSummary(r.toolName, r.input, r.output).summary)
  const unique = [...new Set(summaries)]

  if (unique.length <= 3) {
    return unique.join(", ")
  }

  return `${unique.slice(0, 2).join(", ")} and ${unique.length - 2} more`
}

/**
 * Estimate tokens saved by compacting tool outputs
 */
export function estimateTokensSaved(
  originalOutput: string,
  compactedOutput: string
): number {
  return Token.estimate(originalOutput) - Token.estimate(compactedOutput)
}

/**
 * Generate a summary of compaction results
 */
export interface CompactionSummary {
  toolsCompacted: number
  tokensSaved: number
  originalMessages: number
  newMessages: number
  summaryLength: number
}

export function summarizeCompaction(
  originalMessages: unknown[],
  newMessages: unknown[],
  toolsCompacted: number,
  summaryLength: number
): CompactionSummary {
  // Estimate tokens - this is a rough calculation
  const originalTokens = originalMessages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
  const newTokens = newMessages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)

  return {
    toolsCompacted,
    tokensSaved: Math.max(0, originalTokens - newTokens - summaryLength),
    originalMessages: originalMessages.length,
    newMessages: newMessages.length,
    summaryLength,
  }
}

function estimateMessageTokens(message: unknown): number {
  if (!message || typeof message !== "object") return 0

  const msg = message as Record<string, unknown>

  // Simple estimation - count characters divided by 4 (rough token estimate)
  if (msg.text) {
    return Token.estimate(String(msg.text))
  }

  if (msg.output) {
    return Token.estimate(String(msg.output))
  }

  if (msg.content) {
    return Token.estimate(String(msg.content))
  }

  return 0
}
