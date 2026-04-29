// Owns pending OAuth transports while MCP auth is in progress.
// This file does not start OAuth, create transports, or decide connection status.

import { Effect } from "effect"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { closeTransportIfSupported } from "./transport-utils"

export type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport

export class McpPendingOAuthTransports {
  private readonly transports = new Map<string, TransportWithAuth>()

  get(mcpName: string): TransportWithAuth | undefined {
    return this.transports.get(mcpName)
  }

  set(mcpName: string, transport: TransportWithAuth): void {
    this.transports.set(mcpName, transport)
  }

  replace(mcpName: string, transport: TransportWithAuth) {
    return this.closeExisting(mcpName, transport).pipe(
      Effect.flatMap(() => Effect.sync(() => this.set(mcpName, transport))),
    )
  }

  clearOne(mcpName: string) {
    return this.closeExisting(mcpName).pipe(Effect.flatMap(() => Effect.sync(() => this.transports.delete(mcpName))))
  }

  closeAll() {
    return Effect.forEach(Array.from(this.transports.values()), closeTransportIfSupported, {
      concurrency: "unbounded",
    }).pipe(Effect.flatMap(() => Effect.sync(() => this.transports.clear())))
  }

  private closeExisting(mcpName: string, except?: TransportWithAuth) {
    const transport = this.transports.get(mcpName)
    if (!transport || transport === except) return Effect.void
    return closeTransportIfSupported(transport)
  }
}
