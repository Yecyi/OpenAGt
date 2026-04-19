import { Effect, Layer, Context } from "effect"
import { Log } from "@/util"
import { Server } from "bun"

const log = Log.create({ service: "cli.daemon" })

export interface DaemonConfig {
  port: number
  host: string
  socketPath?: string
  autoRestart: boolean
  maxRetries: number
}

export const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
  port: 8080,
  host: "localhost",
  autoRestart: true,
  maxRetries: 3,
}

export interface DaemonState {
  startedAt: number
  pid: number
  config: DaemonConfig
  status: "running" | "stopped" | "error"
  error?: string
}

export interface DaemonMessage {
  type: "ping" | "status" | "stop" | "restart" | "execute"
  payload?: unknown
}

export interface DaemonResponse {
  type: "pong" | "status" | "stopped" | "restarted" | "result" | "error"
  payload?: unknown
  timestamp: number
}

export class DaemonService extends Context.Service<DaemonService>()("@opencode/Daemon") {
  private server: Server | null = null
  private state: DaemonState | null = null

  readonly start: (config?: Partial<DaemonConfig>) => Effect.Effect<void>
  readonly stop: () => Effect.Effect<void>
  readonly restart: () => Effect.Effect<void>
  readonly getStatus: () => Effect.Effect<DaemonState | null>
  readonly sendMessage: (message: DaemonMessage) => Effect.Effect<DaemonResponse>
}

/**
 * Create a daemon process layer
 */
export function createDaemonLayer(
  config: DaemonConfig = DEFAULT_DAEMON_CONFIG
): Layer.Layer<DaemonService> {
  return Layer.effect(
    DaemonService,
    Effect.gen(function* () {
      let server: Server | null = null
      let state: DaemonState | null = null

      const start: DaemonService["start"] = (configOverride) => {
        return Effect.gen(function* () {
          const finalConfig = { ...config, ...configOverride }
          const startTime = Date.now()

          log.info("starting daemon", finalConfig)

          // Check if already running
          if (state?.status === "running") {
            log.warn("daemon already running", { pid: state.pid })
            return
          }

          try {
            server = new Server({
              port: finalConfig.port,
              hostname: finalConfig.host,
              fetch: async (req) => {
                const url = new URL(req.url)

                // Health check
                if (url.pathname === "/health") {
                  return Response.json({
                    status: "ok",
                    uptime: Date.now() - (state?.startedAt ?? Date.now()),
                    pid: state?.pid,
                  })
                }

                // Status endpoint
                if (url.pathname === "/status") {
                  return Response.json(state ?? { status: "stopped" })
                }

                // Execute endpoint
                if (url.pathname === "/execute" && req.method === "POST") {
                  try {
                    const body = await req.json()
                    // TODO: Execute command via agent
                    return Response.json({
                      type: "result",
                      payload: { executed: true, command: body },
                      timestamp: Date.now(),
                    })
                  } catch {
                    return Response.json(
                      { type: "error", message: "Invalid request body" },
                      { status: 400 }
                    )
                  }
                }

                // Stop endpoint
                if (url.pathname === "/stop" && req.method === "POST") {
                  server?.stop()
                  return Response.json({
                    type: "stopped",
                    timestamp: Date.now(),
                  })
                }

                return Response.json({ error: "Not found" }, { status: 404 })
              },
            })

            state = {
              startedAt: startTime,
              pid: Bun.pid,
              config: finalConfig,
              status: "running",
            }

            log.info("daemon started", { pid: Bun.pid, port: finalConfig.port })
          } catch (error) {
            state = {
              startedAt: startTime,
              pid: Bun.pid,
              config: finalConfig,
              status: "error",
              error: error instanceof Error ? error.message : "Unknown error",
            }
            log.error("daemon failed to start", { error })
            throw error
          }
        })
      }

      const stop: DaemonService["stop"] = () => {
        return Effect.gen(function* () {
          log.info("stopping daemon")
          server?.stop()
          state = state
            ? { ...state, status: "stopped" }
            : null
        })
      }

      const restart: DaemonService["restart"] = () => {
        return Effect.gen(function* () {
          yield* stop()
          yield* Effect.sleep(1000) // Wait 1 second
          yield* start()
          state = state
            ? { ...state, status: "running" }
            : null
        })
      }

      const getStatus: DaemonService["getStatus"] = () => {
        return Effect.succeed(state)
      }

      const sendMessage: DaemonService["sendMessage"] = (message) => {
        return Effect.gen(function* () {
          const response: DaemonResponse = {
            type: "error",
            payload: { message: "Daemon not running" },
            timestamp: Date.now(),
          }

          if (state?.status !== "running") {
            return response
          }

          switch (message.type) {
            case "ping":
              return { type: "pong", timestamp: Date.now() }
            case "status":
              return { type: "status", payload: state, timestamp: Date.now() }
            case "stop":
              yield* stop()
              return { type: "stopped", timestamp: Date.now() }
            case "restart":
              yield* restart()
              return { type: "restarted", timestamp: Date.now() }
            default:
              return response
          }
        })
      }

      return new DaemonService(
        { start, stop, restart, getStatus, sendMessage },
        "@opencode/Daemon"
      )
    })
  )
}

/**
 * Daemon CLI command
 */
export interface DaemonCommandOptions {
  port?: number
  host?: string
  foreground?: boolean
}

export async function runDaemon(options: DaemonCommandOptions): Promise<void> {
  const config: DaemonConfig = {
    port: options.port ?? DEFAULT_DAEMON_CONFIG.port,
    host: options.host ?? DEFAULT_DAEMON_CONFIG.host,
    autoRestart: options.foreground ? false : DEFAULT_DAEMON_CONFIG.autoRestart,
    maxRetries: DEFAULT_DAEMON_CONFIG.maxRetries,
  }

  log.info("initializing daemon", config)

  // In foreground mode, just run the server
  if (options.foreground) {
    const server = new Server({
      port: config.port,
      hostname: config.host,
      fetch: (req) => {
        return Response.json({
          status: "running",
          pid: Bun.pid,
          timestamp: Date.now(),
        })
      },
    })

    console.log(`Daemon running on http://${config.host}:${config.port}`)
    console.log(`PID: ${Bun.pid}`)
    console.log("Press Ctrl+C to stop")

    // Keep alive
    await new Promise(() => {})
  }
}

/**
 * Check if daemon is running
 */
export async function isDaemonRunning(
  port: number = DEFAULT_DAEMON_CONFIG.port
): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Send command to running daemon
 */
export async function sendToDaemon(
  port: number = DEFAULT_DAEMON_CONFIG.port,
  message: DaemonMessage
): Promise<DaemonResponse> {
  const response = await fetch(`http://localhost:${port}${getPathForMessage(message)}`, {
    method: message.type === "execute" ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: message.type === "execute" ? JSON.stringify(message.payload) : undefined,
  })

  return response.json()
}

function getPathForMessage(message: DaemonMessage): string {
  switch (message.type) {
    case "ping":
      return "/health"
    case "status":
      return "/status"
    case "stop":
      return "/stop"
    case "execute":
      return "/execute"
    default:
      return "/"
  }
}
