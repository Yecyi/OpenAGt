import { Effect, Layer, Context } from "effect"
import { Log } from "@/util"
import { isConcurrencySafe, CONCURRENCY_SAFE_TOOLS, UNSAFE_PATTERNS } from "./partition"
import { detectPathConflicts, extractPathsFromInput } from "./path-overlap"

const log = Log.create({ service: "tool.scheduler" })

// Default max concurrency for safe tools (from Claude Code reference)
const DEFAULT_MAX_TOOL_USE_CONCURRENCY = 10

function getMaxToolUseConcurrency(): number {
  const env = process.env.OPENCODE_MAX_TOOL_USE_CONCURRENCY
  if (env) {
    const parsed = parseInt(env, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_MAX_TOOL_USE_CONCURRENCY
}

export interface ToolCallItem {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

export interface ToolBatch {
  isConcurrencySafe: boolean
  tools: ToolCallItem[]
  contextModifiers?: Record<string, Array<(context: ToolSchedulerContext) => ToolSchedulerContext>>
}

export interface ToolSchedulerContext {
  inProgressToolUseIds: Set<string>
  directory: string
  worktree: string
  setInProgressToolUseIds: ( updater: (prev: Set<string>) => Set<string>) => void
}

export interface SchedulerResult {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  output: unknown
  error?: string
  durationMs?: number
}

export interface ToolExecutionUpdate {
  result: SchedulerResult
  newContext: ToolSchedulerContext
}

export interface ToolExecutor {
  readonly execute: (
    toolCall: ToolCallItem,
    context: ToolSchedulerContext
  ) => Effect.Effect<ToolExecutionUpdate>
}

export interface Interface {
  readonly partition: (calls: ToolCallItem[]) => ToolBatch[]
  readonly schedule: (
    batches: ToolBatch[],
    context: ToolSchedulerContext,
    executor: ToolExecutor
  ) => Effect.Effect<ToolSchedulerContext>
  readonly runTools: (
    calls: ToolCallItem[],
    context: ToolSchedulerContext,
    executor: ToolExecutor
  ) => Effect.Effect<ToolSchedulerContext>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolScheduler") {}

export const layer: Layer.Layer<Service, never> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const partition: Interface["partition"] = (calls: ToolCallItem[]) => {
      if (calls.length === 0) return []

      const batches: ToolBatch[] = []
      let currentSafeBatch: ToolCallItem[] = []

      for (const call of calls) {
        const safe = isConcurrencySafe(call.toolName)

        if (safe) {
          currentSafeBatch.push(call)
        } else {
          if (currentSafeBatch.length > 0) {
            batches.push({ isConcurrencySafe: true, tools: currentSafeBatch })
            currentSafeBatch = []
          }
          batches.push({ isConcurrencySafe: false, tools: [call] })
        }
      }

      if (currentSafeBatch.length > 0) {
        batches.push({ isConcurrencySafe: true, tools: currentSafeBatch })
      }

      // Detect path conflicts within unsafe batches
      for (const batch of batches) {
        if (!batch.isConcurrencySafe && batch.tools.length > 1) {
          const conflicts = detectPathConflicts(batch.tools.map(t => ({
            toolName: t.toolName,
            input: t.input
          })))
          if (conflicts.length > 0) {
            log.warn("path conflicts detected in unsafe batch", { conflicts })
          }
        }
      }

      return batches
    }

    // Run tools serially (for unsafe tools)
    const runSerially = (
      tools: ToolCallItem[],
      context: ToolSchedulerContext,
      executor: ToolExecutor
    ): Effect.Effect<ToolSchedulerContext> => {
      if (tools.length === 0) {
        return Effect.succeed(context)
      }

      return Effect.gen(function* () {
        let currentContext = context

        for (const toolCall of tools) {
          // Mark as in-progress
          currentContext.setInProgressToolUseIds(prev => {
            const next = new Set(prev)
            next.add(toolCall.toolCallId)
            return next
          })

          const update = yield* executor.execute(toolCall, currentContext)
          currentContext = update.newContext

          // Remove from in-progress
          currentContext.setInProgressToolUseIds(prev => {
            const next = new Set(prev)
            next.delete(toolCall.toolCallId)
            return next
          })
        }

        return currentContext
      })
    }

    // Run tools concurrently (for safe tools)
    const runConcurrently = (
      tools: ToolCallItem[],
      context: ToolSchedulerContext,
      executor: ToolExecutor
    ): Effect.Effect<ToolSchedulerContext> => {
      if (tools.length === 0) {
        return Effect.succeed(context)
      }

      const maxConcurrency = getMaxToolUseConcurrency()

      return Effect.gen(function* () {
        const results: ToolExecutionUpdate[] = []
        let currentContext = context

        // Process in chunks of maxConcurrency
        for (let i = 0; i < tools.length; i += maxConcurrency) {
          const chunk = tools.slice(i, i + maxConcurrency)

          // Mark all as in-progress
          for (const toolCall of chunk) {
            currentContext.setInProgressToolUseIds(prev => {
              const next = new Set(prev)
              next.add(toolCall.toolCallId)
              return next
            })
          }

          // Execute chunk concurrently
          const chunkResults = yield* Effect.all(
            chunk.map(toolCall =>
              executor.execute(toolCall, currentContext)
            ),
            { concurrency: "unbounded" }
          )

          results.push(...chunkResults)

          // Remove all from in-progress
          for (const toolCall of chunk) {
            currentContext.setInProgressToolUseIds(prev => {
              const next = new Set(prev)
              next.delete(toolCall.toolCallId)
              return next
            })
          }
        }

        // Apply context modifiers from results
        for (const update of results) {
          if (update.result.toolCallId && update.newContext !== currentContext) {
            currentContext = update.newContext
          }
        }

        return currentContext
      })
    }

    const schedule: Interface["schedule"] = (batches, context, executor) => {
      return Effect.gen(function* () {
        let currentContext = context

        for (const batch of batches) {
          if (batch.isConcurrencySafe) {
            currentContext = yield* runConcurrently(batch.tools, currentContext, executor)
          } else {
            currentContext = yield* runSerially(batch.tools, currentContext, executor)
          }
        }

        return currentContext
      })
    }

    const runTools: Interface["runTools"] = (calls, context, executor) => {
      return Effect.gen(function* () {
        const batches = partition(calls)
        log.info("scheduling tool calls", {
          total: calls.length,
          batches: batches.map(b => ({
            type: b.isConcurrencySafe ? "safe" : "unsafe",
            count: b.tools.length
          }))
        })
        const finalContext = yield* schedule(batches, context, executor)
        return finalContext
      })
    }

    return Service.of({ partition, schedule, runTools })
  })
)

export const defaultLayer = Layer.suspend(() => layer)

export * as ToolScheduler from "./scheduler"
