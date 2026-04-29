// Transport factory helpers for MCP local and remote server configs.
// This file creates transports only; it does not connect, retry, store OAuth state, or list tools.

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { ConfigMCP } from "../config/mcp"
import type { McpOAuthProvider } from "./oauth-provider"
import type { TransportWithAuth } from "./pending-oauth-transports"

export function remoteTransportCandidates(
  mcp: ConfigMCP.Info & { type: "remote" },
  authProvider: McpOAuthProvider | undefined,
): Array<{ name: string; create: () => TransportWithAuth }> {
  return [
    {
      name: "StreamableHTTP",
      create: () =>
        new StreamableHTTPClientTransport(new URL(mcp.url), {
          authProvider,
          requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
        }),
    },
    {
      name: "SSE",
      create: () =>
        new SSEClientTransport(new URL(mcp.url), {
          authProvider,
          requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
        }),
    },
  ]
}

export function createLocalTransport(input: {
  command: string
  args: string[]
  cwd: string
  environment?: Record<string, string>
  onStderr?: (chunk: Buffer) => void
}): StdioClientTransport {
  const transport = new StdioClientTransport({
    stderr: "pipe",
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    env: {
      ...process.env,
      ...(input.command === "opencode" ? { BUN_BE_BUN: "1" } : {}),
      ...input.environment,
    },
  })
  if (input.onStderr) {
    transport.stderr?.on("data", input.onStderr)
  }
  return transport
}
