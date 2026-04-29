import { ToolListChangedNotificationSchema, type Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Effect } from "effect"
import { EffectBridge } from "@/effect"
import type { Bus } from "@/bus"
import { ToolsChanged } from "./events"
import type { MCPClient, State } from "./contracts"

type McpClientStateLog = {
  info(message: string, data?: Record<string, unknown>): void
}

type DefinitionLoader = (key: string, client: MCPClient, timeout?: number) => Effect.Effect<MCPToolDef[] | undefined>

export class McpClientStateStore {
  constructor(
    private readonly deps: {
      bus: Bus.Interface
      defs: DefinitionLoader
      log: McpClientStateLog
    },
  ) {}

  watch(s: State, name: string, client: MCPClient, bridge: EffectBridge.Shape, timeout?: number) {
    // This handler runs asynchronously outside the Effect context; stale guards
    // prevent old callbacks from mutating state after reconnects.
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      this.deps.log.info("tools list changed notification received", { server: name })
      if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

      const listed = await bridge.promise(this.deps.defs(name, client, timeout))
      if (!listed) return
      if (s.clients[name] !== client || s.status[name]?.status !== "connected") return

      s.defs[name] = listed
      await bridge.promise(this.deps.bus.publish(ToolsChanged, { server: name }).pipe(Effect.ignore))
    })
  }

  closeClient(s: State, name: string) {
    const client = s.clients[name]
    delete s.defs[name]
    if (!client) return Effect.void
    return Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
  }

  storeClient = Effect.fnUntraced(function* (
    this: McpClientStateStore,
    s: State,
    name: string,
    client: MCPClient,
    listed: MCPToolDef[],
    timeout?: number,
  ) {
    const bridge = yield* EffectBridge.make()
    yield* this.closeClient(s, name)
    s.status[name] = { status: "connected" }
    s.clients[name] = client
    s.defs[name] = listed
    this.watch(s, name, client, bridge, timeout)
    return s.status[name]
  })
}
