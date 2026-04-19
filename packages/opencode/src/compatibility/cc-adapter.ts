/**
 * Claude Code Compatibility Adapter
 *
 * Provides compatibility layer to use Claude Code tools and workflows
 * within OpenAG. This allows smoother migration and hybrid usage.
 */

import { Effect, Context } from "effect"
import { Log } from "@/util"
import { z } from "zod"

const log = Log.create({ service: "compat.cc" })

// CC tool name mappings
const CC_TOOL_MAPPINGS: Record<string, string> = {
  // File operations
  "BashTool": "bash",
  "FileReadTool": "read",
  "FileEditTool": "edit",
  "FileWriteTool": "write",
  "GlobTool": "glob",
  "GrepTool": "grep",

  // Agent operations
  "AgentTool": "agent",
  "TaskTool": "task",
  "TaskCreateTool": "task_create",
  "TaskListTool": "task_list",
  "TaskGetTool": "task_get",
  "TaskUpdateTool": "task_update",
  "TaskStopTool": "task_stop",
  "TeamCreateTool": "team_create",
  "TeamDeleteTool": "team_delete",
  "SendMessageTool": "message_send",

  // Web operations
  "WebFetchTool": "webfetch",
  "WebSearchTool": "websearch",

  // Code operations
  "LSPTool": "lsp",
  "NotebookEditTool": "notebook_edit",
}

// Reverse mapping (OpenAG -> CC)
const OPENAG_TO_CC_MAPPINGS: Record<string, string> = Object.fromEntries(
  Object.entries(CC_TOOL_MAPPINGS).map(([cc, openag]) => [openag, cc])
)

/**
 * Convert CC-style tool call to OpenAG format
 */
export function adaptCCToolCall(
  ccToolName: string,
  input: Record<string, unknown>
): { toolName: string; input: Record<string, unknown> } | null {
  const openagTool = CC_TOOL_MAPPINGS[ccToolName]
  if (!openagTool) {
    log.warn("unknown CC tool", { ccToolName })
    return null
  }

  // Adapt input schema differences
  const adaptedInput = adaptInput(openagTool, input)

  return {
    toolName: openagTool,
    input: adaptedInput,
  }
}

/**
 * Adapt CC tool input to OpenAG format
 */
function adaptInput(
  toolName: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  switch (toolName) {
    case "edit":
      return {
        file_path: input.file_path ?? input.path,
        old_string: input.old_string ?? input.original,
        new_string: input.new_string ?? input.replacement,
      }

    case "read":
      return {
        file_path: input.file_path ?? input.path,
        offset: input.offset,
        limit: input.limit,
      }

    case "write":
      return {
        file_path: input.file_path ?? input.path,
        content: input.content ?? input.text,
      }

    case "glob":
      return {
        pattern: input.pattern ?? input.glob,
        cwd: input.cwd,
      }

    case "grep":
      return {
        pattern: input.pattern ?? input.query,
        path: input.path ?? input.dir,
        regex: input.regex ?? input.isRegex,
        case_sensitive: input.case_sensitive,
        context: input.context,
      }

    case "bash":
      return {
        command: input.command ?? input.cmd,
        cwd: input.cwd,
        timeout: input.timeout,
        env: input.env,
      }

    case "task_create":
      return {
        subject: input.subject,
        description: input.description,
        activeForm: input.activeForm,
        metadata: input.metadata,
        blockedBy: input.blockedBy,
      }

    case "message_send":
      return {
        to: input.to,
        message: input.message,
        teamName: input.teamName,
      }

    default:
      return input
  }
}

/**
 * Convert OpenAG tool result to CC format
 */
export function adaptToolResultToCC(
  openagTool: string,
  result: unknown
): unknown {
  // Most results are compatible, but we may need special handling
  switch (openagTool) {
    case "read":
      return {
        content: result,
        // CC format includes these fields
        exists: true,
        type: "file",
      }

    case "task_list":
      return {
        tasks: result,
        // CC format expects specific fields
      }

    case "bash":
      return {
        stdout: result,
        stderr: "",
        exitCode: 0,
      }

    default:
      return result
  }
}

// ============================================================================
// Session Format Compatibility
// ============================================================================

/**
 * CC session message format
 */
export interface CCSessionMessage {
  id: string
  type: "user" | "assistant" | "system"
  role?: "user" | "assistant" | "system"
  content: string | Array<{ type: string; [key: string]: unknown }>
  timestamp: number
  tool_calls?: Array<{
    id: string
    name: string
    input: Record<string, unknown>
  }>
  tool_results?: Array<{
    tool_use_id: string
    content: unknown
  }>
}

/**
 * Convert CC session format to OpenAG format
 */
export function convertCCSessionToOpenAG(
  ccMessages: CCSessionMessage[]
): unknown[] {
  return ccMessages.map((msg) => ({
    id: msg.id,
    type: msg.type,
    role: msg.role ?? msg.type,
    content: msg.content,
    timestamp: msg.timestamp,
    toolCalls: msg.tool_calls,
    toolResults: msg.tool_results,
  }))
}

/**
 * Convert OpenAG session format to CC format
 */
export function convertOpenAGSessionToCC(
  openagMessages: unknown[]
): CCSessionMessage[] {
  return openagMessages.map((msg: any) => ({
    id: msg.id,
    type: msg.type,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
    tool_calls: msg.toolCalls,
    tool_results: msg.toolResults,
  }))
}

// ============================================================================
// System Prompt Compatibility
// ============================================================================

/**
 * CC system prompt components that need adaptation
 */
export interface CCSystemPromptComponents {
  basePrompt: string
  toolsSection?: string
  instructionsSection?: string
  coordinatorSection?: string
}

/**
 * Parse CC-style system prompt into components
 */
export function parseCCSystemPrompt(prompt: string): CCSystemPromptComponents {
  const sections: CCSystemPromptComponents = {
    basePrompt: prompt,
  }

  // Extract tools section
  const toolsMatch = prompt.match(/## Tools\n\n([\s\S]*?)(?=\n##|$)/)
  if (toolsMatch) {
    sections.toolsSection = toolsMatch[1]
  }

  // Extract instructions section
  const instructionsMatch = prompt.match(/## Instructions\n\n([\s\S]*?)(?=\n##|$)/)
  if (instructionsMatch) {
    sections.instructionsSection = instructionsMatch[1]
  }

  // Extract coordinator section
  const coordinatorMatch = prompt.match(/## Coordinator[\s\S]*?(?=\n##|$)/)
  if (coordinatorMatch) {
    sections.coordinatorSection = coordinatorMatch[0]
  }

  return sections
}

/**
 * Adapt CC system prompt to OpenAG format
 */
export function adaptCCSystemPrompt(
  ccPrompt: string,
  openagTools: string[]
): string {
  const sections = parseCCSystemPrompt(ccPrompt)

  // Build OpenAG-style system prompt
  let openagPrompt = sections.basePrompt

  // Add OpenAG tools section
  if (openagTools.length > 0) {
    const toolList = openagTools.map((t) => `- \`${t}\``).join("\n")
    openagPrompt += `\n\n## Available Tools\n\n${toolList}`
  }

  return openagPrompt
}

// ============================================================================
// Task Notification Compatibility
// ============================================================================

/**
 * CC task notification format
 */
export interface CCTaskNotification {
  taskId: string
  status: "completed" | "failed" | "interrupted" | "stopped"
  summary: string
  result?: string
  usage?: {
    totalTokens: number
    toolUses: number
    durationMs: number
  }
}

/**
 * Convert OpenAG internal task state to CC notification format
 */
export function toCCTaskNotification(
  task: {
    id: string
    status: string
    result?: string
    metadata?: Record<string, unknown>
  }
): CCTaskNotification {
  return {
    taskId: task.id,
    status: task.status as CCTaskNotification["status"],
    summary: `Task ${task.status}`,
    result: task.result,
    usage: task.metadata?.usage as CCTaskNotification["usage"],
  }
}

// ============================================================================
// Feature Flag Compatibility
// ============================================================================

/**
 * Map CC feature flags to OpenAG equivalents
 */
export const FEATURE_FLAG_MAP: Record<string, string | undefined> = {
  COORDINATOR_MODE: "OPENCODE_COORDINATOR_MODE",
  CLAUDE_CODE_SIMPLE: "OPENCODE_SIMPLE_MODE",
  BACKGROUNDCOMMAND: "OPENCODE_BACKGROUND_COMMANDS",
  BPM: "OPENCODE_BPM",
  TEN_GU: "OPENCODE_TEN_GU",
}

/**
 * Get OpenAG feature flag value from CC flag
 */
export function getOpenAGFeatureFlag(ccFlag: string): string | undefined {
  const openagFlag = FEATURE_FLAG_MAP[ccFlag]
  if (openagFlag) {
    return process.env[openagFlag]
  }
  return undefined
}

/**
 * Check if CC feature is enabled
 */
export function isCCFeatureEnabled(ccFlag: string): boolean {
  // CC uses bun:bundle feature() which we can't replicate exactly
  // But we can check environment variables
  return process.env[ccFlag] === "1" || getOpenAGFeatureFlag(ccFlag) === "1"
}

// ============================================================================
// Permission Context Compatibility
// ============================================================================

/**
 * CC permission context format
 */
export interface CCPermissionContext {
  allow: string[]
  deny: string[]
  prompt: string
  toolPermissionContext?: {
    tools: Record<string, { mode: string; suggestions: string[] }>
  }
}

/**
 * Convert OpenAG permission to CC format
 */
export function toCCPermissionContext(
  openagPerm: {
    allow?: string[]
    deny?: string[]
    tools?: Record<string, { allow: boolean }>
  }
): CCPermissionContext {
  return {
    allow: openagPerm.allow ?? [],
    deny: openagPerm.deny ?? [],
    prompt: "",
    toolPermissionContext: openagPerm.tools
      ? {
          tools: Object.fromEntries(
            Object.entries(openagPerm.tools).map(([k, v]) => [
              k,
              { mode: v.allow ? "allow" : "deny", suggestions: [] },
            ])
          ),
        }
      : undefined,
  }
}

// ============================================================================
// Export
// ============================================================================

export const ccCompatibility = {
  adaptCCToolCall,
  adaptToolResultToCC,
  adaptCCSystemPrompt,
  convertCCSessionToOpenAG,
  convertOpenAGSessionToCC,
  toCCTaskNotification,
  isCCFeatureEnabled,
  toCCPermissionContext,
  TOOL_MAPPINGS: CC_TOOL_MAPPINGS,
}
