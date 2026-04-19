import { Effect, Layer, Context } from "effect"
import { Log } from "@/util"
import { ToolCallItem, ToolSchedulerContext } from "./scheduler"
import { scanForInjection, sanitizeContent } from "@/security/injection"

const log = Log.create({ service: "tool.executor" })

// Minimum hook duration (ms) to show inline timing summary
export const HOOK_TIMING_DISPLAY_THRESHOLD_MS = 500
// Log warning when hooks/permission block for this long
const SLOW_PHASE_LOG_THRESHOLD_MS = 2000

export interface ToolExecutorResult {
  toolCallId: string
  toolName: string
  output: unknown
  error?: string
  durationMs: number
  metadata?: {
    inputTokens?: number
    outputTokens?: number
    cacheRead?: number
    cacheWrite?: number
  }
}

export interface ToolExecutionOptions {
  toolImplementations: Map<string, ToolImplementation>
  permissionChecker?: PermissionChecker
  preToolHooks?: PreToolHook[]
  postToolHooks?: PostToolHook[]
}

export interface ToolImplementation {
  readonly name: string
  readonly validateInput?: (input: unknown) => ValidationResult
  readonly execute: (
    input: Record<string, unknown>,
    context: ToolSchedulerContext
  ) => Effect.Effect<ToolExecutionResult>
  readonly isSafe?: (input: Record<string, unknown>) => boolean
  readonly maxResultSizeChars?: number
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export type PermissionChecker = (
  toolName: string,
  input: Record<string, unknown>
) => Effect.Effect<PermissionDecision>

export type PermissionDecision =
  | { allowed: true }
  | { allowed: false; reason: string; message?: string }

export interface PreToolHook {
  readonly name: string
  readonly run: (
    context: ToolSchedulerContext,
    tool: ToolImplementation,
    input: Record<string, unknown>
  ) => Effect.Effect<PreToolHookResult>
}

export type PreToolHookResult =
  | { type: "continue"; updatedInput?: Record<string, unknown> }
  | { type: "stop"; reason: string; message?: string }
  | { type: "modified"; input: Record<string, unknown> }

export interface PostToolHook {
  readonly name: string
  readonly run: (
    context: ToolSchedulerContext,
    tool: ToolImplementation,
    input: Record<string, unknown>,
    result: ToolExecutionResult
  ) => Effect.Effect<PostToolHookResult>
}

export type PostToolHookResult =
  | { type: "continue" }
  | { type: "modified"; output: unknown }
  | { type: "stop"; reason: string }

export interface ToolExecutorInterface {
  readonly executeTool: (
    call: ToolCallItem,
    context: ToolSchedulerContext
  ) => Effect.Effect<{ result: ToolExecutionResult; newContext: ToolSchedulerContext }>
  readonly validateToolInput: (
    toolName: string,
    input: unknown
  ) => Effect.Effect<ValidationResult>
}

export class Service extends Context.Service<Service, ToolExecutorInterface>()("@opencode/ToolExecutor") {
  constructor(
    private options: ToolExecutionOptions
  ) {
    super()
  }
}

export const layer: Layer.Layer<Service, never, ToolExecutorInterface> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const options: ToolExecutionOptions = yield* Effect.context<ToolExecutorInterface>()
    const log = Log.create({ service: "tool.executor" })

    const validateToolInput: ToolExecutorInterface["validateToolInput"] = (toolName, input) => {
      const tool = options.toolImplementations.get(toolName)
      if (!tool) {
        return Effect.succeed({ valid: false, error: `Unknown tool: ${toolName}` })
      }

      if (tool.validateInput) {
        return Effect.succeed(tool.validateInput(input))
      }

      return Effect.succeed({ valid: true })
    }

    const executeTool: ToolExecutorInterface["executeTool"] = (call, context) => {
      return Effect.gen(function* () {
        const startTime = Date.now()
        const tool = options.toolImplementations.get(call.toolName)

        if (!tool) {
          const durationMs = Date.now() - startTime
          return {
            result: {
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              output: undefined,
              error: `Unknown tool: ${call.toolName}`,
              durationMs
            },
            newContext: context
          }
        }

        // Run pre-tool hooks
        let currentInput = call.input
        if (options.preToolHooks) {
          for (const hook of options.preToolHooks) {
            const hookResult = yield* hook.run(context, tool, currentInput)
            if (hookResult.type === "stop") {
              const durationMs = Date.now() - startTime
              return {
                result: {
                  toolCallId: call.toolCallId,
                  toolName: call.toolName,
                  output: undefined,
                  error: hookResult.message ?? hookResult.reason,
                  durationMs
                },
                newContext: context
              }
            }
            if (hookResult.type === "modified") {
              currentInput = hookResult.input
            }
            if (hookResult.type === "continue" && hookResult.updatedInput) {
              currentInput = hookResult.updatedInput
            }
          }
        }

        // Check permissions
        if (options.permissionChecker) {
          const decision = yield* options.permissionChecker(call.toolName, currentInput)
          if (!decision.allowed) {
            const durationMs = Date.now() - startTime
            return {
              result: {
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                output: undefined,
                error: decision.message ?? `Permission denied: ${decision.reason}`,
                durationMs
              },
              newContext: context
            }
          }
        }

        // Validate input
        if (tool.validateInput) {
          const validation = tool.validateInput(currentInput)
          if (!validation.valid) {
            const durationMs = Date.now() - startTime
            return {
              result: {
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                output: undefined,
                error: `Input validation failed: ${validation.error}`,
                durationMs
              },
              newContext: context
            }
          }
        }

        // Execute tool
        const execResult = yield* tool.execute(currentInput, context)

        // Run post-tool hooks
        if (options.postToolHooks) {
          for (const hook of options.postToolHooks) {
            const hookResult = yield* hook.run(context, tool, currentInput, execResult)
            if (hookResult.type === "modified") {
              execResult.output = hookResult.output
            }
            if (hookResult.type === "stop") {
              log.warn("post-tool hook stopped execution", {
                tool: call.toolName,
                hook: hook.name,
                reason: hookResult.reason
              })
            }
          }
        }

        return {
          result: {
            ...execResult,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            durationMs: Date.now() - startTime
          },
          newContext: context
        }
      })
    }

    return new Service(
      {
        executeTool,
        validateToolInput
      },
      "@opencode/ToolExecutor"
    )
  })
)

// Helper to classify tool execution errors
export function classifyToolError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name && error.name !== "Error" && error.name.length > 3) {
      return error.name.slice(0, 60)
    }
    return "Error"
  }
  return "UnknownError"
}

// Default permission checker that allows all tools
export const defaultPermissionChecker: PermissionChecker = (_toolName, _input) => {
  return Effect.succeed({ allowed: true })
}

// Create a simple tool executor layer with defaults
export const defaultLayer = Layer.succeed(
  Service,
  new Service(
    {
      executeTool: (call, context) => {
        return Effect.gen(function* () {
          return {
            result: {
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              output: undefined,
              error: `No tool implementation for: ${call.toolName}`,
              durationMs: 0
            },
            newContext: context
          }
        })
      },
      validateToolInput: (_toolName, _input) => {
        return Effect.succeed({ valid: true })
      }
    },
    "@opencode/ToolExecutor"
  )
)

export * as ToolExecutor from "./executor"
