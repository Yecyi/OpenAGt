// Public MCP bus events and typed errors.
// This file does not connect MCP clients or publish events.

import { NamedError } from "@openagt/shared/util/error"
import z from "zod/v4"
import { BusEvent } from "../bus/bus-event"

export const ToolsChanged = BusEvent.define(
  "mcp.tools.changed",
  z.object({
    server: z.string(),
  }),
)

export const BrowserOpenFailed = BusEvent.define(
  "mcp.browser.open.failed",
  z.object({
    mcpName: z.string(),
    url: z.string(),
  }),
)

export const Failed = NamedError.create(
  "MCPFailed",
  z.object({
    name: z.string(),
  }),
)
