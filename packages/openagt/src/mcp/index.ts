import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { type Tool as MCPToolDef, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import { Config } from "../config"
import { ConfigMCP } from "../config/mcp"
import { Log } from "../util"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { McpAuth } from "./auth"
import { Bus } from "@/bus"
import { Effect, Layer, Context } from "effect"
import { EffectBridge } from "@/effect"
import { InstanceState } from "@/effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { checkToolsQuality } from "./tool-quality"
import { fetchNamedItemsFromClient, listToolDefinitions } from "./client-listing"
import { ToolsChanged } from "./events"
import { McpPendingOAuthTransports } from "./pending-oauth-transports"
import { aggregateMcpTools, collectNamedFromConnected } from "./catalog-aggregation"
import { McpAuthFlowController, type AuthStatus } from "./auth-flow-controller"
import { McpConnectionFactory } from "./connection-factory"
import type { Status } from "./schema"
import { isMcpConfigured, type Interface, type MCPClient, type State } from "./contracts"
import { mcpProcessDescendants } from "./process-descendants"
export { BrowserOpenFailed, Failed, ToolsChanged } from "./events"
export { Resource, Status } from "./schema"
export type { AuthStatus } from "./auth-flow-controller"
export type { Interface, MCPClient, PromptInfo, ResourceInfo, ToolQualityReport } from "./contracts"

const log = Log.create({ service: "mcp" })
const DEFAULT_TIMEOUT = 30_000

const pendingOAuthTransports = new McpPendingOAuthTransports()

function defs(key: string, client: MCPClient, timeout?: number) {
  return listToolDefinitions({ key, client, timeout, defaultTimeout: DEFAULT_TIMEOUT, log })
}

function fetchFromClient<T extends { name: string }>(
  clientName: string,
  client: Client,
  listFn: (c: Client) => Promise<T[]>,
  label: string,
) {
  return fetchNamedItemsFromClient({ clientName, client, listFn, label, log })
}

// --- Effect Service ---

export class Service extends Context.Service<Service, Interface>()("@opencode/MCP") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const auth = yield* McpAuth.Service
    const bus = yield* Bus.Service

    const connectionFactory = new McpConnectionFactory({
      auth,
      bus,
      defaultTimeout: DEFAULT_TIMEOUT,
      defs,
      log,
      pendingOAuthTransports,
    })
    const create = Effect.fn("MCP.create")((key: string, mcp: ConfigMCP.Info) => connectionFactory.create(key, mcp))
    const cfgSvc = yield* Config.Service

    const descendants = (pid: number) => mcpProcessDescendants(spawner, pid)

    function watch(s: State, name: string, client: MCPClient, bridge: EffectBridge.Shape, timeout?: number) {
      // Note: This handler runs asynchronously outside the Effect context.
      // The guard checks (s.clients[name] !== client) ensure stale callbacks are ignored.
      // This is a known limitation when bridging async callbacks with Effect state.
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        log.info("tools list changed notification received", { server: name })
        if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

        const listed = await bridge.promise(defs(name, client, timeout))
        if (!listed) return
        if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

        s.defs[name] = listed
        await bridge.promise(bus.publish(ToolsChanged, { server: name }).pipe(Effect.ignore))
      })
    }

    const state = yield* InstanceState.make<State>(
      Effect.fn("MCP.state")(function* () {
        const cfg = yield* cfgSvc.get()
        const bridge = yield* EffectBridge.make()
        const config = cfg.mcp ?? {}
        const s: State = {
          status: {},
          clients: {},
          defs: {},
        }

        yield* Effect.forEach(
          Object.entries(config),
          ([key, mcp]) =>
            Effect.gen(function* () {
              if (!isMcpConfigured(mcp)) {
                log.error("Ignoring MCP config entry without type", { key })
                return
              }

              if (mcp.enabled === false) {
                s.status[key] = { status: "disabled" }
                return
              }

              const result = yield* create(key, mcp).pipe(Effect.catch(() => Effect.void))
              if (!result) return

              s.status[key] = result.status
              if (result.mcpClient) {
                s.clients[key] = result.mcpClient
                s.defs[key] = result.defs!
                watch(s, key, result.mcpClient, bridge, mcp.timeout)
              }
            }),
          { concurrency: "unbounded" },
        )

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* Effect.forEach(
              Object.values(s.clients),
              (client) =>
                Effect.gen(function* () {
                  const pid = client.transport instanceof StdioClientTransport ? client.transport.pid : null
                  if (typeof pid === "number") {
                    const pids = yield* descendants(pid)
                    for (const dpid of pids) {
                      try {
                        process.kill(dpid, "SIGTERM")
                      } catch {}
                    }
                  }
                  yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
                }),
              { concurrency: "unbounded" },
            )
            yield* pendingOAuthTransports.closeAll()
          }),
        )

        return s
      }),
    )

    function closeClient(s: State, name: string) {
      const client = s.clients[name]
      delete s.defs[name]
      if (!client) return Effect.void
      return Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
    }

    const storeClient = Effect.fnUntraced(function* (
      s: State,
      name: string,
      client: MCPClient,
      listed: MCPToolDef[],
      timeout?: number,
    ) {
      const bridge = yield* EffectBridge.make()
      yield* closeClient(s, name)
      s.status[name] = { status: "connected" }
      s.clients[name] = client
      s.defs[name] = listed
      watch(s, name, client, bridge, timeout)
      return s.status[name]
    })

    const status = Effect.fn("MCP.status")(function* () {
      const s = yield* InstanceState.get(state)

      const cfg = yield* cfgSvc.get()
      const config = cfg.mcp ?? {}
      const result: Record<string, Status> = {}

      for (const [key, mcp] of Object.entries(config)) {
        if (!isMcpConfigured(mcp)) continue
        result[key] = s.status[key] ?? { status: "disabled" }
      }

      return result
    })

    const clients = Effect.fn("MCP.clients")(function* () {
      const s = yield* InstanceState.get(state)
      return s.clients
    })

    const createAndStore = Effect.fn("MCP.createAndStore")(function* (name: string, mcp: ConfigMCP.Info) {
      const s = yield* InstanceState.get(state)
      const result = yield* create(name, mcp)

      s.status[name] = result.status
      if (!result.mcpClient) {
        yield* closeClient(s, name)
        delete s.clients[name]
        return result.status
      }

      return yield* storeClient(s, name, result.mcpClient, result.defs!, mcp.timeout)
    })

    const add = Effect.fn("MCP.add")(function* (name: string, mcp: ConfigMCP.Info) {
      yield* createAndStore(name, mcp)
      const s = yield* InstanceState.get(state)
      return { status: s.status }
    })

    const connect = Effect.fn("MCP.connect")(function* (name: string) {
      const mcp = yield* getMcpConfig(name)
      if (!mcp) {
        log.error("MCP config not found or invalid", { name })
        return
      }
      yield* createAndStore(name, { ...mcp, enabled: true })
    })

    const disconnect = Effect.fn("MCP.disconnect")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      yield* closeClient(s, name)
      delete s.clients[name]
      s.status[name] = { status: "disabled" }
    })

    const tools = Effect.fn("MCP.tools")(function* () {
      const s = yield* InstanceState.get(state)
      const cfg = yield* cfgSvc.get()
      return aggregateMcpTools({
        state: s,
        config: cfg.mcp ?? {},
        defaultTimeout: cfg.experimental?.mcp_timeout,
        log,
      })
    })

    const prompts = Effect.fn("MCP.prompts")(function* () {
      const s = yield* InstanceState.get(state)
      return yield* collectNamedFromConnected({
        state: s,
        listFn: (c) => c.listPrompts().then((r) => r.prompts),
        label: "prompts",
        fetch: fetchFromClient,
      })
    })

    const resources = Effect.fn("MCP.resources")(function* () {
      const s = yield* InstanceState.get(state)
      return yield* collectNamedFromConnected({
        state: s,
        listFn: (c) => c.listResources().then((r) => r.resources),
        label: "resources",
        fetch: fetchFromClient,
      })
    })

    const withClient = Effect.fnUntraced(function* <A>(
      clientName: string,
      fn: (client: MCPClient) => Promise<A>,
      label: string,
      meta?: Record<string, unknown>,
    ) {
      const s = yield* InstanceState.get(state)
      const client = s.clients[clientName]
      if (!client) {
        log.warn(`client not found for ${label}`, { clientName })
        return undefined
      }
      return yield* Effect.tryPromise({
        try: () => fn(client),
        catch: (e: any) => {
          log.error(`failed to ${label}`, { clientName, ...meta, error: e?.message })
          return e
        },
      }).pipe(Effect.orElseSucceed(() => undefined))
    })

    const getPrompt = Effect.fn("MCP.getPrompt")(function* (
      clientName: string,
      name: string,
      args?: Record<string, string>,
    ) {
      return yield* withClient(clientName, (client) => client.getPrompt({ name, arguments: args }), "getPrompt", {
        promptName: name,
      })
    })

    const readResource = Effect.fn("MCP.readResource")(function* (clientName: string, resourceUri: string) {
      return yield* withClient(clientName, (client) => client.readResource({ uri: resourceUri }), "readResource", {
        resourceUri,
      })
    })

    const getMcpConfig = Effect.fnUntraced(function* (mcpName: string) {
      const cfg = yield* cfgSvc.get()
      const mcpConfig = cfg.mcp?.[mcpName]
      if (!mcpConfig || !isMcpConfigured(mcpConfig)) return undefined
      return mcpConfig
    })

    const authFlow = new McpAuthFlowController({
      auth,
      bus,
      log,
      pendingOAuthTransports,
      getMcpConfig,
      getState: () => InstanceState.get(state),
      defs,
      storeClient,
      createAndStore,
    })

    return Service.of({
      status,
      clients,
      tools,
      prompts,
      resources,
      add,
      connect,
      disconnect,
      getPrompt,
      readResource,
      startAuth: (name) => authFlow.startAuth(name),
      authenticate: (name) => authFlow.authenticate(name),
      finishAuth: (name, authorizationCode) => authFlow.finishAuth(name, authorizationCode),
      removeAuth: (name) => authFlow.removeAuth(name),
      supportsOAuth: (name) => authFlow.supportsOAuth(name),
      hasStoredTokens: (name) => authFlow.hasStoredTokens(name),
      getAuthStatus: (name) => authFlow.getAuthStatus(name),
      checkToolQualityReport: Effect.fn("MCP.checkToolQualityReport")(function* () {
        const s = yield* InstanceState.get(state)
        const allTools = Object.entries(s.defs).flatMap(([clientName, tools]) =>
          tools.map((tool) => ({ tool, clientName })),
        )

        if (allTools.length === 0) return undefined

        const result = checkToolsQuality(allTools)
        return {
          serverCount: Object.keys(s.clients).length,
          toolCount: allTools.length,
          averageScore: result.averageScore,
          lowQualityTools: result.lowQualityTools,
        }
      }),
    })
  }),
)

// --- Per-service runtime ---

export const defaultLayer = layer.pipe(
  Layer.provide(McpAuth.layer),
  Layer.provide(Bus.layer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
)

export * as MCP from "."
