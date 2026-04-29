// Catalog aggregation helpers for connected MCP clients.
// This file does not connect transports, mutate lifecycle state, or manage OAuth.

import { type Tool } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { type Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Effect } from "effect"
import { Config } from "../config"
import { ConfigMCP } from "../config/mcp"
import { convertMcpTool, sanitizeMcpName } from "./tool-adapter"

type MCPClient = Client
type McpEntry = NonNullable<Config.Info["mcp"]>[string]

export type McpCatalogState = {
  status: Record<string, { status: string }>
  clients: Record<string, MCPClient>
  defs: Record<string, MCPToolDef[]>
}

type McpCatalogLog = {
  warn(message: string, data?: Record<string, unknown>): void
}

function isMcpConfigured(entry: McpEntry): entry is ConfigMCP.Info {
  return typeof entry === "object" && entry !== null && "type" in entry
}

export function connectedClientEntries(state: McpCatalogState): Array<[string, MCPClient]> {
  return Object.entries(state.clients).filter(([clientName]) => state.status[clientName]?.status === "connected")
}

export function aggregateMcpTools(input: {
  state: McpCatalogState
  config: NonNullable<Config.Info["mcp"]>
  defaultTimeout?: number
  log: McpCatalogLog
}): Record<string, Tool> {
  const result: Record<string, Tool> = {}
  for (const [clientName, client] of connectedClientEntries(input.state)) {
    const mcpConfig = input.config[clientName]
    const entry = mcpConfig && isMcpConfigured(mcpConfig) ? mcpConfig : undefined

    const listed = input.state.defs[clientName]
    if (!listed) {
      input.log.warn("missing cached tools for connected server", { clientName })
      continue
    }

    const timeout = entry?.timeout ?? input.defaultTimeout
    for (const mcpTool of listed) {
      const tool = convertMcpTool({ mcpTool, client, timeout, log: input.log })
      if (tool) {
        result[sanitizeMcpName(clientName) + "_" + sanitizeMcpName(mcpTool.name)] = tool
      }
    }
  }
  return result
}

export function collectNamedFromConnected<T extends { name: string }>(input: {
  state: McpCatalogState
  listFn: (c: Client) => Promise<T[]>
  label: string
  fetch: (clientName: string, client: Client, listFn: (c: Client) => Promise<T[]>, label: string) => Effect.Effect<
    Record<string, T & { client: string }> | undefined,
    never
  >
}) {
  return Effect.forEach(
    connectedClientEntries(input.state),
    ([clientName, client]) =>
      input.fetch(clientName, client, input.listFn, input.label).pipe(
        Effect.map((items) => Object.entries(items ?? {})),
      ),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((results) => Object.fromEntries<T & { client: string }>(results.flat())))
}
