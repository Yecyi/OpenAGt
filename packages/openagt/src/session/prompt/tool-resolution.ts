/**
 * Tool Resolution Module
 *
 * Extracted from session/prompt.ts
 * Handles AI SDK tool creation and scheduling
 */

import { Effect, Stream, Context } from "effect"
import { Provider } from "@/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import {
  isConcurrencySafe as checkConcurrencySafe,
  partitionToolCalls,
  type ToolCallItem as PartitionToolCallItem,
  type ToolBatch,
} from "@/tool/partition"
import {
  extractPathsFromInput as extractPaths,
  pathsOverlap,
  detectPathConflicts,
} from "@/tool/path-overlap"
import { MCP } from "@/mcp"
import { Plugin } from "@/plugin"
import { Agent } from "@/agent/agent"
import { MessageV2 } from "@/session/message-v2"
import { SessionID, PartID } from "@/session/schema"
import { Session } from "@/session"
import { SessionProcessor } from "@/session/processor"
import { Permission } from "@/permission"
import { ProviderTransform } from "@/provider"
import { Log } from "@/util"
import { ulid } from "ulid"
import z from "zod"
import { tool, jsonSchema, type Tool as AITool, asSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"

const log = Log.create({ service: "tool-resolution" })

/**
 * Running tool call with execution state
 */
export interface RunningToolCall {
  safe: boolean
  paths: string[]
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  done: Promise<unknown>
}

/**
 * Options for tool resolution
 */
export interface ToolResolutionContext {
  session: Session.Info
  agent: Agent.Info
  model: Provider.Model
  processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
}

/**
 * Tool execution context passed to tool handlers
 */
export interface ToolContext {
  sessionID: SessionID
  callID: string
  extra: {
    model: Provider.Model
    bypassAgentCheck: boolean
    promptOps: any
  }
  agent: string
  messages: MessageV2.WithParts[]
  metadata: (val: { title?: string; metadata?: Record<string, any> }) => Effect.Effect<void>
  ask: (req: { permission: string; metadata: Record<string, any>; patterns: string[]; always: string[] }) => Effect.Effect<void>
}

/**
 * Create a tool scheduler with path conflict detection
 */
export function createToolScheduler() {
  let running: RunningToolCall[] = []
  let unsafeTail = Promise.resolve()

  const normalizeToolInput = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

  const hasPathConflict = (left: Record<string, unknown>, right: Record<string, unknown>) =>
    detectPathConflicts([
      { toolName: "left", input: left },
      { toolName: "right", input: right },
    ]).length > 0

  const schedule = <T>(
    call: PartitionToolCallItem,
    execute: () => Promise<T>,
  ) => {
    const safe = isConcurrencySafe(call.toolName)
    const paths = extractPaths(call.input)
    const blockers = running
      .filter((active) => {
        if (!safe) return true
        if (!active.safe) return true
        if (!paths.length || !active.paths.length) return false
        return hasPathConflict(call.input, active.input)
      })
      .map((active) => active.done.catch(() => undefined))
    const start = () => Promise.all(blockers).then(() => execute())
    const pending = safe ? start() : unsafeTail.then(start, start)
    if (!safe) unsafeTail = pending.then(() => undefined, () => undefined)

    const done = pending.finally(() => {
      running = running.filter((active) => active.toolCallId !== call.toolCallId)
    })
    partitionToolCalls([
      ...running.map((active) => ({
        toolCallId: active.toolCallId,
        toolName: active.toolName,
        input: active.input,
      })),
      call,
    ])
    running.push({
      safe,
      paths,
      done,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
    })

    return pending
  }

  return { schedule }
}

/**
 * Check if a tool is concurrency-safe
 */
export function isConcurrencySafe(toolName: string): boolean {
  return checkConcurrencySafe(toolName)
}

/**
 * Extract paths from tool input for conflict detection
 */
export function extractPathsFromInput(input: Record<string, unknown>): string[] {
  return extractPaths(input)
}
