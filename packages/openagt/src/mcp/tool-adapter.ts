// Adapts MCP tool definitions into AI SDK dynamic tools.
// It does not connect transports, cache clients, or decide MCP server lifecycle.
import { dynamicTool, type Tool, jsonSchema, type JSONSchema7 } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { CallToolResultSchema, type Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"

type MCPClient = Client

type McpToolLog = {
  warn(message: string, data?: Record<string, unknown>): void
}

const MAX_TOOL_NAME_LENGTH = 128
const ALLOWED_TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/

export const sanitizeMcpName = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_")

export function validateMcpToolName(name: string): { valid: boolean; reason?: string } {
  const sanitized = sanitizeMcpName(name)
  if (!sanitized || sanitized.length === 0) {
    return { valid: false, reason: "Empty tool name" }
  }
  if (sanitized.length > MAX_TOOL_NAME_LENGTH) {
    return { valid: false, reason: `Tool name exceeds ${MAX_TOOL_NAME_LENGTH} chars` }
  }
  if (!ALLOWED_TOOL_NAME_PATTERN.test(sanitized)) {
    return { valid: false, reason: "Tool name contains invalid characters" }
  }
  if (/\.\.|\/|\$/.test(name)) {
    return { valid: false, reason: "Tool name contains path traversal or injection patterns" }
  }
  return { valid: true }
}

export function convertMcpTool(input: {
  mcpTool: MCPToolDef
  client: MCPClient
  timeout?: number
  log: McpToolLog
}): Tool | null {
  const validation = validateMcpToolName(input.mcpTool.name)
  if (!validation.valid) {
    input.log.warn("skipping tool with invalid name", { name: input.mcpTool.name, reason: validation.reason })
    return null
  }

  const inputSchema = input.mcpTool.inputSchema as JSONSchema7 | undefined
  const schema: JSONSchema7 =
    inputSchema && typeof inputSchema === "object"
      ? (structuredClone(inputSchema) as JSONSchema7)
      : {
          type: "object",
          properties: {},
        }

  return dynamicTool({
    description: input.mcpTool.description ?? "",
    inputSchema: jsonSchema(schema),
    execute: async (args: unknown) => {
      return input.client.callTool(
        {
          name: input.mcpTool.name,
          arguments: (args || {}) as Record<string, unknown>,
        },
        CallToolResultSchema,
        {
          resetTimeoutOnProgress: true,
          timeout: input.timeout,
        },
      )
    },
  })
}
