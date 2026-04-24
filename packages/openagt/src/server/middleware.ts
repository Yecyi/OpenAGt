import { Provider } from "../provider"
import { NamedError } from "@openagt/shared/util/error"
import { DEFAULT_SERVER_USERNAME, isAllowedServerUsername } from "@openagt/shared/auth"
import { NotFoundError } from "../storage"
import { Session } from "../session"
import crypto from "node:crypto"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { ErrorHandler, MiddlewareHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import { Log } from "../util"
import { Flag } from "@/flag/flag"
import { PtyTicket } from "./pty-ticket"
import { cors } from "hono/cors"
import { compress } from "hono/compress"

const log = Log.create({ service: "server" })

export const ErrorMiddleware: ErrorHandler = (err, c) => {
  log.error("failed", {
    error: err,
  })
  if (err instanceof NamedError) {
    let status: ContentfulStatusCode
    if (err instanceof NotFoundError) status = 404
    else if (err instanceof Provider.ModelNotFoundError) status = 400
    else if (err.name === "ProviderAuthValidationFailed") status = 400
    else if (err.name.startsWith("Worktree")) status = 400
    else status = 500
    return c.json(err.toObject(), { status })
  }
  if (err instanceof Session.BusyError) {
    return c.json(new NamedError.Unknown({ message: err.message }).toObject(), { status: 400 })
  }
  if (err instanceof HTTPException) return err.getResponse()
  const message = err instanceof Error && err.stack ? err.stack : err.toString()
  return c.json(new NamedError.Unknown({ message }).toObject(), {
    status: 500,
  })
}

export const AuthMiddleware: MiddlewareHandler = (c, next) => {
  // Allow CORS preflight requests to succeed without auth.
  // Browser clients sending Authorization headers will preflight with OPTIONS.
  if (c.req.method === "OPTIONS") return next()
  const password = Flag.OPENAGT_SERVER_PASSWORD ?? Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return next()
  const username = Flag.OPENAGT_SERVER_USERNAME ?? Flag.OPENCODE_SERVER_USERNAME ?? DEFAULT_SERVER_USERNAME
  const ptyID = PtyTicket.matchConnect(c.req.path)
  if (ptyID && PtyTicket.consume({ token: c.req.query("ticket"), ptyID, directory: c.req.query("directory") })) {
    return next()
  }

  const auth = parseBasic(
    c.req.header("authorization") ?? (ptyID && c.req.query("auth_token") ? `Basic ${c.req.query("auth_token")}` : ""),
  )
  if (!auth) throw new HTTPException(401, { message: "Unauthorized" })
  if (!isAllowedServerUsername(auth.username, username)) {
    throw new HTTPException(401, { message: "Unauthorized" })
  }
  if (!equalSecret(auth.password, password)) throw new HTTPException(401, { message: "Unauthorized" })
  return next()
}

function parseBasic(header: string | undefined) {
  if (!header?.startsWith("Basic ")) return
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8")
  const index = decoded.indexOf(":")
  if (index < 0) return
  return {
    username: decoded.slice(0, index),
    password: decoded.slice(index + 1),
  }
}

function equalSecret(input: string, expected: string) {
  const left = Buffer.from(input)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

export const LoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const skip = c.req.path === "/log"
  if (!skip) {
    log.info("request", {
      method: c.req.method,
      path: c.req.path,
    })
  }
  const timer = log.time("request", {
    method: c.req.method,
    path: c.req.path,
  })
  await next()
  if (!skip) timer.stop()
}

export function CorsMiddleware(opts?: { cors?: string[] }): MiddlewareHandler {
  return cors({
    maxAge: 86_400,
    origin(input) {
      if (!input) return

      if (input.startsWith("http://localhost:")) return input
      if (input.startsWith("http://127.0.0.1:")) return input
      if (input === "tauri://localhost" || input === "http://tauri.localhost" || input === "https://tauri.localhost")
        return input

      if (/^https:\/\/github\.com\/Yecyi\/OpenAGt(\/.*)?$/.test(input)) return input
      if (opts?.cors?.includes(input)) return input
    },
  })
}

const zipped = compress()
export const CompressionMiddleware: MiddlewareHandler = (c, next) => {
  const path = c.req.path
  const method = c.req.method
  if (path === "/event" || path === "/global/event") return next()
  if (method === "POST" && /\/session\/[^/]+\/(message|prompt_async)$/.test(path)) return next()
  return zipped(c, next)
}
