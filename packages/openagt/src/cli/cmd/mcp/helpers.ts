import { Effect } from "effect"
import { AppRuntime } from "../../../effect/app-runtime"
import { Config } from "../../../config"
import { ConfigMCP } from "../../../config/mcp"
import { MCP } from "../../../mcp"

export function getAuthStatusIcon(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "✓"
    case "expired":
      return "⚠"
    case "not_authenticated":
      return "✗"
  }
}

export function getAuthStatusText(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "authenticated"
    case "expired":
      return "expired"
    case "not_authenticated":
      return "not authenticated"
  }
}

export type McpEntry = NonNullable<Config.Info["mcp"]>[string]
export type McpConfigured = ConfigMCP.Info
export type McpRemote = Extract<McpConfigured, { type: "remote" }>

export function isMcpConfigured(config: McpEntry): config is McpConfigured {
  return typeof config === "object" && config !== null && "type" in config
}

export function isMcpRemote(config: McpEntry): config is McpRemote {
  return isMcpConfigured(config) && config.type === "remote"
}

export function configuredServers(config: Config.Info) {
  return Object.entries(config.mcp ?? {}).filter((entry): entry is [string, McpConfigured] => isMcpConfigured(entry[1]))
}

export function oauthServers(config: Config.Info) {
  return configuredServers(config).filter(
    (entry): entry is [string, McpRemote] => isMcpRemote(entry[1]) && entry[1].oauth !== false,
  )
}

export async function listState() {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const cfg = yield* Config.Service
      const mcp = yield* MCP.Service
      const config = yield* cfg.get()
      const statuses = yield* mcp.status()
      const stored = yield* Effect.all(
        Object.fromEntries(configuredServers(config).map(([name]) => [name, mcp.hasStoredTokens(name)])),
        { concurrency: "unbounded" },
      )
      return { config, statuses, stored }
    }),
  )
}

export async function authState() {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const cfg = yield* Config.Service
      const mcp = yield* MCP.Service
      const config = yield* cfg.get()
      const auth = yield* Effect.all(
        Object.fromEntries(oauthServers(config).map(([name]) => [name, mcp.getAuthStatus(name)])),
        { concurrency: "unbounded" },
      )
      return { config, auth }
    }),
  )
}
