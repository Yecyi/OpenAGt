// Runtime helpers for connecting MCP clients to already-created transports.
// This file does not choose servers, manage OAuth state, or store connected clients.

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { Effect } from "effect"
import { InstallationVersion } from "../installation/version"
import { withTimeout } from "@/util/timeout"

const MCP_RETRY_BASE_DELAY_MS = 1000
const MCP_RETRY_MAX_DELAY_MS = 30_000
const MCP_RETRY_JITTER = 0.3

export type MCPTransport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport

export function computeMcpBackoff(attempt: number): number {
  const exponential = Math.min(MCP_RETRY_BASE_DELAY_MS * Math.pow(2, attempt), MCP_RETRY_MAX_DELAY_MS)
  const jitter = Math.abs((Math.random() * 2 - 1) * MCP_RETRY_JITTER * exponential)
  return Math.max(MCP_RETRY_BASE_DELAY_MS, Math.round(exponential + jitter))
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function connectMcpTransport(transport: MCPTransport, timeout: number) {
  return Effect.tryPromise({
    try: async () => {
      const client = new Client({ name: "opencode", version: InstallationVersion })
      try {
        await withTimeout(client.connect(transport), timeout)
        return client
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        if (!(err instanceof UnauthorizedError) && !err.message.includes("OAuth")) {
          await transport.close().catch(() => {})
        }
        throw err
      }
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })
}
