import { type Tool } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { type Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Effect } from "effect"
import { Config } from "../config"
import { ConfigMCP } from "../config/mcp"
import type { AuthStatus } from "./auth-flow-controller"
import type { Status } from "./schema"

export type MCPClient = Client
export type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]
export type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
export type McpEntry = NonNullable<Config.Info["mcp"]>[string]

export function isMcpConfigured(entry: McpEntry): entry is ConfigMCP.Info {
  return typeof entry === "object" && entry !== null && "type" in entry
}

export interface State {
  status: Record<string, Status>
  clients: Record<string, MCPClient>
  defs: Record<string, MCPToolDef[]>
}

export interface ToolQualityReport {
  serverCount: number
  toolCount: number
  averageScore: number
  lowQualityTools: string[]
}

export interface Interface {
  readonly status: () => Effect.Effect<Record<string, Status>>
  readonly clients: () => Effect.Effect<Record<string, MCPClient>>
  readonly tools: () => Effect.Effect<Record<string, Tool>>
  readonly prompts: () => Effect.Effect<Record<string, PromptInfo & { client: string }>>
  readonly resources: () => Effect.Effect<Record<string, ResourceInfo & { client: string }>>
  readonly add: (name: string, mcp: ConfigMCP.Info) => Effect.Effect<{ status: Record<string, Status> | Status }>
  readonly connect: (name: string) => Effect.Effect<void>
  readonly disconnect: (name: string) => Effect.Effect<void>
  readonly getPrompt: (
    clientName: string,
    name: string,
    args?: Record<string, string>,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["getPrompt"]>> | undefined>
  readonly readResource: (
    clientName: string,
    resourceUri: string,
  ) => Effect.Effect<Awaited<ReturnType<MCPClient["readResource"]>> | undefined>
  readonly startAuth: (mcpName: string) => Effect.Effect<{ authorizationUrl: string; oauthState: string }>
  readonly authenticate: (mcpName: string) => Effect.Effect<Status>
  readonly finishAuth: (mcpName: string, authorizationCode: string) => Effect.Effect<Status>
  readonly removeAuth: (mcpName: string) => Effect.Effect<void>
  readonly supportsOAuth: (mcpName: string) => Effect.Effect<boolean>
  readonly hasStoredTokens: (mcpName: string) => Effect.Effect<boolean>
  readonly getAuthStatus: (mcpName: string) => Effect.Effect<AuthStatus>
  readonly checkToolQualityReport: () => Effect.Effect<ToolQualityReport | undefined>
}
