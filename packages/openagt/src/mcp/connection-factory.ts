// Creates connected MCP clients from local or remote MCP config.
// It does not own service state, catalog aggregation, or auth command handlers.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Effect } from "effect"
import { Bus } from "../bus"
import { ConfigMCP } from "../config/mcp"
import { InstanceState } from "../effect"
import { TuiEvent } from "../cli/cmd/tui/event"
import { McpAuth } from "./auth"
import { McpOAuthProvider } from "./oauth-provider"
import { McpPendingOAuthTransports, type TransportWithAuth } from "./pending-oauth-transports"
import { computeMcpBackoff, connectMcpTransport, sleep, type MCPTransport } from "./connection-runtime"
import { createLocalTransport, remoteTransportCandidates } from "./transport-factory"
import type { Status } from "./schema"

type MCPClient = Client
type McpConnectionLog = {
  debug(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
}

export interface McpCreateResult {
  mcpClient?: MCPClient
  status: Status
  defs?: MCPToolDef[]
}

const DISABLED_RESULT: McpCreateResult = { status: { status: "disabled" } }

export class McpConnectionFactory {
  private readonly circuitBreaker: Record<string, { failures: number; lastFailure: number }> = {}

  constructor(
    private readonly deps: {
      auth: McpAuth.Interface
      bus: Bus.Interface
      defaultTimeout: number
      defs: (key: string, client: MCPClient, timeout?: number) => Effect.Effect<MCPToolDef[] | undefined>
      log: McpConnectionLog
      pendingOAuthTransports: McpPendingOAuthTransports
    },
  ) {}

  create(key: string, mcp: ConfigMCP.Info): Effect.Effect<McpCreateResult> {
    const deps = this.deps
    const connect =
      mcp.type === "remote"
        ? this.connectRemote(key, mcp as ConfigMCP.Info & { type: "remote" })
        : this.connectLocal(key, mcp as ConfigMCP.Info & { type: "local" })
    return Effect.gen(function* () {
      if (mcp.enabled === false) {
        deps.log.info("mcp server disabled", { key })
        return DISABLED_RESULT
      }

      deps.log.info("found", { key, type: mcp.type })

      const { client: mcpClient, status } = yield* connect

      if (!mcpClient) {
        return { status } satisfies McpCreateResult
      }

      const listed = yield* deps.defs(key, mcpClient, mcp.timeout)
      if (!listed) {
        yield* Effect.tryPromise(() => mcpClient.close()).pipe(Effect.ignore)
        return { status: { status: "failed", error: "Failed to get tools" } } satisfies McpCreateResult
      }

      deps.log.info("create() successfully created client", { key, toolCount: listed.length })
      return { mcpClient, status, defs: listed } satisfies McpCreateResult
    })
  }

  private connectRemote(
    key: string,
    mcp: ConfigMCP.Info & { type: "remote" },
  ): Effect.Effect<{ client: MCPClient | undefined; status: Status }> {
    const deps = this.deps
    const circuitBreaker = this.circuitBreaker
    return Effect.gen(function* () {
      const oauthDisabled = mcp.oauth === false
      const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
      let authProvider: McpOAuthProvider | undefined

      if (!oauthDisabled) {
        authProvider = new McpOAuthProvider(
          key,
          mcp.url,
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
            redirectUri: oauthConfig?.redirectUri,
          },
          {
            onRedirect: async (url) => {
              deps.log.info("oauth redirect requested", { key, origin: url.origin })
            },
          },
          deps.auth,
        )
      }

      const transports: Array<{ name: string; create: () => TransportWithAuth }> = remoteTransportCandidates(
        mcp,
        authProvider,
      )

      const connectTimeout = mcp.timeout ?? deps.defaultTimeout
      const deadline = Date.now() + connectTimeout
      const remaining = () => Math.max(0, deadline - Date.now())
      const timedOut = () =>
        ({ status: "failed" as const, error: `MCP connection timed out after ${connectTimeout}ms` }) satisfies Status
      const isAuthError = (error: Error) =>
        error instanceof UnauthorizedError || Boolean(authProvider && error.message.includes("OAuth"))
      const needsRegistration = (error: Error) =>
        error.message.includes("registration") || error.message.includes("client_id")
      let lastStatus: Status | undefined

      for (const { name, create } of transports) {
        if (remaining() <= 0) {
          lastStatus = timedOut()
          break
        }
        // Check circuit breaker before attempting
        const now = Date.now()
        const cb = circuitBreaker[key]
        if (cb && cb.failures >= 5 && now - cb.lastFailure < 60_000) {
          deps.log.info("mcp circuit breaker open, skipping server", { key, failures: cb.failures })
          lastStatus = { status: "failed" as const, error: "Circuit breaker open" }
          break
        }

        let attempt = 0
        let lastError: Error | undefined

        while (attempt < 3) {
          const timeLeft = remaining()
          if (timeLeft <= 0) {
            lastStatus = timedOut()
            break
          }

          const transport = create()
          const result = yield* connectMcpTransport(transport, timeLeft).pipe(
            Effect.map((client) => ({ client, transportName: name })),
            Effect.catch((error) => {
              const err = error instanceof Error ? error : new Error(String(error))

              if (isAuthError(err)) {
                deps.log.info("mcp server requires authentication", { key, transport: name })

                if (needsRegistration(err)) {
                  lastStatus = {
                    status: "needs_client_registration" as const,
                    error: "Server does not support dynamic client registration. Please provide clientId in config.",
                  }
                  return deps.bus
                    .publish(TuiEvent.ToastShow, {
                      title: "MCP Authentication Required",
                      message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                      variant: "warning",
                      duration: 8000,
                    })
                    .pipe(Effect.ignore, Effect.as(undefined))
                } else {
                  return Effect.gen(function* () {
                    yield* deps.pendingOAuthTransports.replace(key, transport)
                    lastStatus = { status: "needs_auth" as const }
                    yield* deps.bus
                      .publish(TuiEvent.ToastShow, {
                        title: "MCP Authentication Required",
                        message: `Server "${key}" requires authentication. Run: opencode mcp auth ${key}`,
                        variant: "warning",
                        duration: 8000,
                      })
                      .pipe(Effect.ignore)
                  })
                }
              }

              lastError = err
              deps.log.debug("transport connection failed", {
                key,
                transport: name,
                url: mcp.url,
                error: err.message,
                attempt,
              })
              return Effect.succeed(undefined)
            }),
          )

          if (result) {
            // Reset circuit breaker on success
            if (circuitBreaker[key]) {
              delete circuitBreaker[key]
            }
            deps.log.info("connected", { key, transport: result.transportName })
            return { client: result.client as MCPClient | undefined, status: { status: "connected" as const } }
          }

          // If auth error or last attempt, don't retry
          if (lastStatus?.status === "needs_auth" || lastStatus?.status === "needs_client_registration") {
            break
          }

          attempt++
          if (attempt < 3) {
            const delay = computeMcpBackoff(attempt - 1)
            const wait = Math.min(delay, 250, Math.max(0, remaining() - 25))
            if (wait <= 0) break
            deps.log.info("mcp connection retrying", { key, transport: name, attempt, delayMs: wait })
            yield* Effect.promise(() => sleep(wait))
          }
        }

        // Record circuit breaker failure
        if (lastError) {
          const ts = Date.now()
          if (!circuitBreaker[key]) {
            circuitBreaker[key] = { failures: 0, lastFailure: ts }
          }
          circuitBreaker[key].failures++
          circuitBreaker[key].lastFailure = ts
          lastStatus = { status: "failed" as const, error: lastError.message }
        }

        // If this was an auth error, stop trying other transports
        if (lastStatus?.status === "needs_auth" || lastStatus?.status === "needs_client_registration") break
      }

      return {
        client: undefined as MCPClient | undefined,
        status: (lastStatus ?? { status: "failed", error: "Unknown error" }) as Status,
      }
    })
  }

  private connectLocal(
    key: string,
    mcp: ConfigMCP.Info & { type: "local" },
  ): Effect.Effect<{ client: MCPClient | undefined; status: Status }> {
    const deps = this.deps
    return Effect.gen(function* () {
      const [cmd, ...args] = mcp.command
      const cwd = yield* InstanceState.directory
      const transport = createLocalTransport({
        command: cmd,
        args,
        cwd,
        environment: mcp.environment,
        onStderr: (chunk) => {
          deps.log.info(`mcp stderr: ${chunk.toString()}`, { key })
        },
      })

      const connectTimeout = mcp.timeout ?? deps.defaultTimeout
      return yield* connectMcpTransport(transport as MCPTransport, connectTimeout).pipe(
        Effect.map((client): { client: MCPClient | undefined; status: Status } => ({
          client,
          status: { status: "connected" },
        })),
        Effect.catch((error): Effect.Effect<{ client: MCPClient | undefined; status: Status }> => {
          const msg = error instanceof Error ? error.message : String(error)
          deps.log.error("local mcp startup failed", { key, command: mcp.command, cwd, error: msg })
          return Effect.succeed({ client: undefined, status: { status: "failed", error: msg } })
        }),
      )
    })
  }
}
