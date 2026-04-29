// Lists and keys MCP tools, prompts, and resources from connected clients.
// It does not own connection setup, OAuth state, or service-level caches.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Effect } from "effect"
import { withTimeout } from "@/util/timeout"
import { sanitizeMcpName } from "./tool-adapter"

type MCPClient = Client

type McpListingLog = {
  error(message: string, data?: Record<string, unknown>): void
}

export function listToolDefinitions(input: {
  key: string
  client: MCPClient
  timeout?: number
  defaultTimeout: number
  log: McpListingLog
}) {
  return Effect.tryPromise({
    try: () => withTimeout(input.client.listTools(), input.timeout ?? input.defaultTimeout),
    catch: (err) => (err instanceof Error ? err : new Error(String(err))),
  }).pipe(
    Effect.map((result) => result.tools),
    Effect.catch((err) => {
      input.log.error("failed to get tools from client", { key: input.key, error: err })
      return Effect.succeed(undefined as MCPToolDef[] | undefined)
    }),
  )
}

export function fetchNamedItemsFromClient<T extends { name: string }>(input: {
  clientName: string
  client: Client
  listFn: (client: Client) => Promise<T[]>
  label: string
  log: McpListingLog
}) {
  return Effect.tryPromise({
    try: () => input.listFn(input.client),
    catch: (e: unknown) => {
      input.log.error(`failed to get ${input.label}`, {
        clientName: input.clientName,
        error: e instanceof Error ? e.message : String(e),
      })
      return e
    },
  }).pipe(
    Effect.map((items) => {
      const out: Record<string, T & { client: string }> = {}
      const sanitizedClient = sanitizeMcpName(input.clientName)
      for (const item of items) {
        out[sanitizedClient + ":" + sanitizeMcpName(item.name)] = { ...item, client: input.clientName }
      }
      return out
    }),
    Effect.orElseSucceed(() => undefined),
  )
}
