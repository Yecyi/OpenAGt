/**
 * Claude Code MCP Bridge
 *
 * Provides an MCP server interface that wraps OpenAG tools,
 * allowing CC to use OpenAG as an MCP server.
 */

import { Effect, Context } from "effect"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequest,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Log } from "@/util"
import { adaptCCToolCall, adaptToolResultToCC } from "./cc-adapter"

const log = Log.create({ service: "mcp.cc-bridge" })

export interface CCMCPBridgeConfig {
  name: string
  version: string
  description: string
}

/**
 * Create an MCP server that exposes OpenAG tools in CC-compatible format
 */
export function createCCMCPBridge(
  config: CCMCPBridgeConfig,
  toolExecutor: (tool: string, input: Record<string, unknown>) => Effect.Effect<unknown>
): Server {
  const server = new Server(
    {
      name: config.name,
      version: config.version,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  // Register all OpenAG tools
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params

      try {
        log.debug("MCP call", { name, args })

        // Adapt CC tool name to OpenAG
        const adapted = adaptCCToolCall(name, args ?? {})
        if (!adapted) {
          return {
            content: [
              {
                type: "text",
                text: `Unknown tool: ${name}`,
              },
            ],
            isError: true,
          }
        }

        // Execute via OpenAG
        const result = await Effect.runPromise(
          toolExecutor(adapted.toolName, adapted.input)
        )

        // Adapt result to CC format
        const ccResult = adaptToolResultToCC(adapted.toolName, result)

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(ccResult, null, 2),
            },
          ],
        }
      } catch (error) {
        log.error("MCP tool error", { name, error })
        return {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : "Unknown error",
            },
          ],
          isError: true,
        }
      }
    }
  )

  return server
}

/**
 * CC tool registry for MCP
 */
export interface CCToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, { type: string; description: string }>
    required?: string[]
  }
}

const CC_COMPATIBLE_TOOLS: CCToolDefinition[] = [
  // File operations
  {
    name: "BashTool",
    description: "Execute bash commands",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to execute" },
        cwd: { type: "string", description: "Working directory" },
        timeout: { type: "number", description: "Timeout in ms" },
      },
      required: ["command"],
    },
  },
  {
    name: "FileReadTool",
    description: "Read file contents",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        offset: { type: "number", description: "Line offset" },
        limit: { type: "number", description: "Max lines" },
      },
      required: ["path"],
    },
  },
  {
    name: "FileEditTool",
    description: "Edit file contents",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        old_string: { type: "string", description: "Text to replace" },
        new_string: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "FileWriteTool",
    description: "Write file contents",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        content: { type: "string", description: "File content" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "GlobTool",
    description: "Find files by glob pattern",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "GrepTool",
    description: "Search file contents",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Search pattern" },
        path: { type: "string", description: "Directory to search" },
        regex: { type: "boolean", description: "Is regex" },
        context: { type: "number", description: "Context lines" },
      },
      required: ["pattern"],
    },
  },

  // Agent operations
  {
    name: "AgentTool",
    description: "Spawn a new agent",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Task description" },
        prompt: { type: "string", description: "Agent prompt" },
        agentType: { type: "string", description: "Agent type" },
        subagent_type: { type: "string", description: "Subagent type" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "TaskCreateTool",
    description: "Create a task",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Task subject" },
        description: { type: "string", description: "Task description" },
        activeForm: { type: "string", description: "Active form" },
      },
      required: ["subject"],
    },
  },
  {
    name: "TaskListTool",
    description: "List tasks",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter by status",
          enum: ["pending", "in_progress", "completed", "failed"],
        },
      },
    },
  },
  {
    name: "TaskGetTool",
    description: "Get task details",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "TaskUpdateTool",
    description: "Update a task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID" },
        status: {
          type: "string",
          description: "New status",
          enum: ["pending", "in_progress", "completed", "failed"],
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "TaskStopTool",
    description: "Stop a task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID" },
        reason: { type: "string", description: "Stop reason" },
      },
      required: ["taskId"],
    },
  },

  // Web operations
  {
    name: "WebFetchTool",
    description: "Fetch web page",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
      },
      required: ["url"],
    },
  },
  {
    name: "WebSearchTool",
    description: "Search the web",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
]

export { CC_COMPATIBLE_TOOLS }
