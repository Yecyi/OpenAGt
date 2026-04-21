/**
 * Tool Scheduler Module
 *
 * Extracted from session/prompt.ts
 * Manages tool execution ordering and concurrency
 */

import { Effect, Layer, Context } from "effect"
import { PathOverlap } from "@/tool/path-overlap"
import { ToolPartition } from "@/tool/partition"
import { Tool } from "@/tool"
import { ToolRegistry } from "@/tool/registry"
import { Log } from "@/util"

const log = Log.create({ service: "tool-scheduler" })

/**
 * Represents a running tool call with its metadata
 */
export interface RunningToolCall {
  id: string
  tool: string
  input: unknown
  partition: string
  path?: string
}

/**
 * Options for creating a tool scheduler
 */
export interface ToolSchedulerOptions {
  maxConcurrent?: number
  partitionStrategy?: "safe" | "unsafe" | "path-overlap"
}

/**
 * Result of scheduling tools - split into partitions that can run concurrently
 */
export interface ToolSchedule {
  partitions: RunningToolCall[][]
  conflicts: Array<{ tool1: RunningToolCall; tool2: RunningToolCall }>
}

/**
 * Check if two tool calls have path overlap
 */
export function hasPathOverlap(tool1: RunningToolCall, tool2: RunningToolCall): boolean {
  if (!tool1.path || !tool2.path) return false
  return PathOverlap.check(tool1.path, tool2.path)
}

/**
 * Detect conflicts between tool calls (same file/path modified)
 */
export function detectConflicts(tools: RunningToolCall[]): Array<{ tool1: RunningToolCall; tool2: RunningToolCall }> {
  const conflicts: Array<{ tool1: RunningToolCall; tool2: RunningToolCall }> = []

  for (let i = 0; i < tools.length; i++) {
    for (let j = i + 1; j < tools.length; j++) {
      const tool1 = tools[i]
      const tool2 = tools[j]

      // Check path overlap
      if (hasPathOverlap(tool1, tool2)) {
        // Only conflict if at least one is a write operation
        if (isWriteTool(tool1.tool) || isWriteTool(tool2.tool)) {
          conflicts.push({ tool1, tool2 })
        }
      }
    }
  }

  return conflicts
}

/**
 * Determine if a tool is a write operation
 */
export function isWriteTool(toolName: string): boolean {
  return ["Edit", "Write", "TodoWrite"].includes(toolName)
}

/**
 * Partition tools into groups that can run concurrently
 * Uses path overlap detection to prevent concurrent writes to the same file
 */
export function partitionTools(tools: RunningToolCall[]): RunningToolCall[][] {
  if (tools.length === 0) return []

  const partitions: RunningToolCall[][] = []
  const assigned = new Set<string>()

  for (const tool of tools) {
    if (assigned.has(tool.id)) continue

    // Find all tools that can run concurrently with this one
    const concurrentTools = tools.filter(
      (t) =>
        !assigned.has(t.id) &&
        (t.id === tool.id || (!hasPathOverlap(tool, t) || (!isWriteTool(tool.tool) && !isWriteTool(t.tool)))),
    )

    const partition = concurrentTools.filter((t) => !assigned.has(t.id))
    for (const t of partition) {
      assigned.add(t.id)
    }

    if (partition.length > 0) {
      partitions.push(partition)
    }
  }

  return partitions
}

/**
 * Schedule tools for execution with conflict detection
 */
export function scheduleTools(tools: RunningToolCall[], options?: ToolSchedulerOptions): ToolSchedule {
  const conflicts = detectConflicts(tools)
  const partitions = partitionTools(tools)

  if (conflicts.length > 0) {
    log.warn("tool conflicts detected", {
      count: conflicts.length,
      conflicts: conflicts.map((c) => `${c.tool1.tool}(${c.tool1.id}) <-> ${c.tool2.tool}(${c.tool2.id})`),
    })
  }

  return { partitions, conflicts }
}
