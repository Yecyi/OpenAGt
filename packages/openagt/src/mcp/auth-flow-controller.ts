// Coordinates MCP OAuth lifecycle and credential status.
// It does not connect normal MCP clients, aggregate tools, or mutate MCP config.
import { type Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import open from "open"
import { Effect, Option } from "effect"
import { ConfigMCP } from "../config/mcp"
import { InstallationVersion } from "../installation/version"
import type { Logger } from "../util/log"
import { BrowserOpenFailed } from "./events"
import { McpAuth } from "./auth"
import { McpOAuthCallback } from "./oauth-callback"
import { McpOAuthProvider } from "./oauth-provider"
import { McpPendingOAuthTransports } from "./pending-oauth-transports"
import type { Status } from "./schema"

export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

type MCPClient = Client

interface AuthResult {
  authorizationUrl: string
  oauthState: string
  client?: MCPClient
}

interface BrowserFailureBus {
  publish: (event: typeof BrowserOpenFailed, payload: { mcpName: string; url: string }) => Effect.Effect<unknown>
}

interface CreateAuthFlowControllerInput<State> {
  auth: McpAuth.Interface
  bus: BrowserFailureBus
  log: Logger
  pendingOAuthTransports: McpPendingOAuthTransports
  getMcpConfig: (mcpName: string) => Effect.Effect<ConfigMCP.Info | undefined>
  getState: () => Effect.Effect<State>
  defs: (key: string, client: MCPClient, timeout?: number) => Effect.Effect<MCPToolDef[] | undefined>
  storeClient: (
    state: State,
    name: string,
    client: MCPClient,
    listed: MCPToolDef[],
    timeout?: number,
  ) => Effect.Effect<Status>
  createAndStore: (name: string, mcp: ConfigMCP.Info) => Effect.Effect<Status>
}

export class McpAuthFlowController<State> {
  constructor(private readonly input: CreateAuthFlowControllerInput<State>) {}

  startAuth(mcpName: string): Effect.Effect<AuthResult> {
    const input = this.input
    return Effect.gen(function* () {
      const mcpConfig = yield* input.getMcpConfig(mcpName)
      if (!mcpConfig) throw new Error(`MCP server ${mcpName} not found or disabled`)
      if (mcpConfig.type !== "remote") throw new Error(`MCP server ${mcpName} is not a remote server`)
      if (mcpConfig.oauth === false) throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)

      const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined

      yield* Effect.promise(() => McpOAuthCallback.ensureRunning(oauthConfig?.redirectUri))

      const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
      yield* input.auth.updateOAuthState(mcpName, oauthState)
      let capturedUrl: URL | undefined
      const authProvider = new McpOAuthProvider(
        mcpName,
        mcpConfig.url,
        {
          clientId: oauthConfig?.clientId,
          clientSecret: oauthConfig?.clientSecret,
          scope: oauthConfig?.scope,
          redirectUri: oauthConfig?.redirectUri,
        },
        {
          onRedirect: async (url) => {
            capturedUrl = url
          },
        },
        input.auth,
      )

      const transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), { authProvider })

      return yield* Effect.tryPromise({
        try: () => {
          const client = new Client({ name: "opencode", version: InstallationVersion })
          return client
            .connect(transport)
            .then(() => ({ authorizationUrl: "", oauthState, client }) satisfies AuthResult)
        },
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) => {
          if (error instanceof UnauthorizedError && capturedUrl) {
            const authorizationUrl = capturedUrl.toString()
            return Effect.gen(function* () {
              yield* input.pendingOAuthTransports.replace(mcpName, transport)
              return { authorizationUrl, oauthState } satisfies AuthResult
            })
          }
          return Effect.die(error)
        }),
      )
    })
  }

  authenticate(mcpName: string): Effect.Effect<Status> {
    const input = this.input
    const startAuth = (name: string) => this.startAuth(name)
    const finishAuth = (name: string, code: string) => this.finishAuth(name, code)
    return Effect.gen(function* () {
      const result = yield* startAuth(mcpName)
      if (!result.authorizationUrl) {
        const client = "client" in result ? result.client : undefined
        const mcpConfig = yield* input.getMcpConfig(mcpName)
        if (!mcpConfig) {
          yield* Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)
          yield* input.pendingOAuthTransports.clearOne(mcpName)
          return { status: "failed", error: "MCP config not found after auth" } as Status
        }

        const listed = client ? yield* input.defs(mcpName, client, mcpConfig.timeout) : undefined
        if (!client || !listed) {
          yield* Effect.tryPromise(() => client?.close() ?? Promise.resolve()).pipe(Effect.ignore)
          yield* input.pendingOAuthTransports.clearOne(mcpName)
          return { status: "failed", error: "Failed to get tools" } as Status
        }

        const state = yield* input.getState()
        yield* input.auth.clearOAuthState(mcpName)
        yield* input.pendingOAuthTransports.clearOne(mcpName)
        return yield* input.storeClient(state, mcpName, client, listed, mcpConfig.timeout)
      }

      input.log.info("opening browser for oauth", { mcpName, hasAuthorizationUrl: !!result.authorizationUrl })

      const callbackPromise = McpOAuthCallback.waitForCallback(result.oauthState, mcpName)

      yield* Effect.tryPromise(() => open(result.authorizationUrl)).pipe(
        Effect.flatMap((subprocess) =>
          Effect.callback<void, Error>((resume) => {
            const timer = setTimeout(() => resume(Effect.void), 500)
            subprocess.on("error", (err) => {
              clearTimeout(timer)
              resume(Effect.fail(err))
            })
            subprocess.on("exit", (code) => {
              if (code !== null && code !== 0) {
                clearTimeout(timer)
                resume(Effect.fail(new Error(`Browser open failed with exit code ${code}`)))
              }
            })
          }),
        ),
        Effect.catch(() => {
          input.log.warn("failed to open browser, user must open URL manually", { mcpName })
          return input.bus.publish(BrowserOpenFailed, { mcpName, url: result.authorizationUrl }).pipe(Effect.ignore)
        }),
      )

      const code = yield* Effect.promise(() => callbackPromise)

      const storedState = yield* input.auth.getOAuthState(mcpName)
      if (storedState !== result.oauthState) {
        yield* input.auth.clearOAuthState(mcpName)
        throw new Error("OAuth state mismatch - potential CSRF attack")
      }
      yield* input.auth.clearOAuthState(mcpName)
      return yield* finishAuth(mcpName, code)
    })
  }

  finishAuth(mcpName: string, authorizationCode: string): Effect.Effect<Status> {
    const input = this.input
    return Effect.gen(function* () {
      const transport = input.pendingOAuthTransports.get(mcpName)
      if (!transport) throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)

      const result = yield* Effect.tryPromise({
        try: () => transport.finishAuth(authorizationCode).then(() => true as const),
        catch: (error) => {
          input.log.error("failed to finish oauth", { mcpName, error })
          return error
        },
      }).pipe(Effect.option)

      if (Option.isNone(result)) {
        return { status: "failed", error: "OAuth completion failed" } as Status
      }

      yield* input.auth.clearCodeVerifier(mcpName)
      yield* input.pendingOAuthTransports.clearOne(mcpName)

      const mcpConfig = yield* input.getMcpConfig(mcpName)
      if (!mcpConfig) return { status: "failed", error: "MCP config not found after auth" } as Status

      return yield* input.createAndStore(mcpName, mcpConfig)
    })
  }

  removeAuth(mcpName: string): Effect.Effect<void> {
    const input = this.input
    return Effect.gen(function* () {
      yield* input.auth.remove(mcpName)
      McpOAuthCallback.cancelPending(mcpName)
      yield* input.pendingOAuthTransports.clearOne(mcpName)
      input.log.info("removed oauth credentials", { mcpName })
    })
  }

  supportsOAuth(mcpName: string): Effect.Effect<boolean> {
    const input = this.input
    return Effect.gen(function* () {
      const mcpConfig = yield* input.getMcpConfig(mcpName)
      if (!mcpConfig) return false
      return mcpConfig.type === "remote" && mcpConfig.oauth !== false
    })
  }

  hasStoredTokens(mcpName: string): Effect.Effect<boolean> {
    const input = this.input
    return Effect.gen(function* () {
      const entry = yield* input.auth.get(mcpName)
      return !!entry?.tokens
    })
  }

  getAuthStatus(mcpName: string): Effect.Effect<AuthStatus> {
    const input = this.input
    return Effect.gen(function* () {
      const entry = yield* input.auth.get(mcpName)
      if (!entry?.tokens) return "not_authenticated" as AuthStatus
      const expired = yield* input.auth.isTokenExpired(mcpName)
      return (expired ? "expired" : "authenticated") as AuthStatus
    })
  }
}
