import { Provider } from "../provider"
import { NamedError } from "@openagt/shared/util/error"
import { DEFAULT_SERVER_USERNAME, isAllowedServerUsername } from "@openagt/shared/auth"
import { NotFoundError } from "../storage"
import { Session } from "../session"
import crypto from "node:crypto"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { Context, ErrorHandler, MiddlewareHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import { Log } from "../util"
import { Flag } from "@/flag/flag"
import { PtyTicket } from "./pty-ticket"
import { cors } from "hono/cors"
import { compress } from "hono/compress"

const log = Log.create({ service: "server" })
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024
const MAX_JSON_DEPTH = 256

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
  if (!password) {
    const token = getLocalServerToken()
    if (!token) return next()
    if (c.req.method === "GET" || c.req.method === "HEAD") return next()
    const header = c.req.header("authorization") ?? ""
    const cookie = c.req.header("cookie") ?? ""
    if (equalBearer(header, token) || hasLocalTokenCookie(cookie, token)) return next()
    throw new HTTPException(401, { message: "Unauthorized" })
  }
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

export function getLocalServerToken() {
  return Flag.OPENAGT_SERVER_LOCAL_TOKEN ?? Flag.OPENCODE_SERVER_LOCAL_TOKEN
}

export function setLocalServerTokenCookie(c: Context) {
  const token = getLocalServerToken()
  if (!token) return
  c.header(
    "Set-Cookie",
    `openagt_local_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`,
    { append: true },
  )
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

function equalBearer(header: string, expected: string) {
  if (!header.startsWith("Bearer ")) return false
  return equalSecret(header.slice("Bearer ".length), expected)
}

function hasLocalTokenCookie(cookie: string, expected: string) {
  return cookie
    .split(";")
    .map((part) => part.trim())
    .some((part) => part.startsWith("openagt_local_token=") && decodeURIComponent(part.slice(21)) === expected)
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
      if (isAllowedOrigin(input, opts)) return input
    },
  })
}

export function LocalOriginMiddleware(opts?: { cors?: string[] }): MiddlewareHandler {
  return (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next()
    const origin = c.req.header("origin")
    if (!origin || isAllowedOrigin(origin, opts)) return next()
    throw new HTTPException(403, { message: "Origin is not allowed" })
  }
}

export const BodyLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const length = Number(c.req.header("content-length") ?? 0)
  if (Number.isFinite(length) && length > MAX_REQUEST_BODY_BYTES) {
    throw new HTTPException(413, { message: "Request body too large" })
  }
  if (!["POST", "PUT", "PATCH"].includes(c.req.method)) return next()
  const body = c.req.raw.clone().body
  if (!body) return next()
  const reader = body.getReader()
  let total = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    total += chunk.value.byteLength
    if (total > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel().catch(() => {})
      throw new HTTPException(413, { message: "Request body too large" })
    }
  }
  await next()
}

export const JsonDepthMiddleware: MiddlewareHandler = async (c, next) => {
  if (!["POST", "PUT", "PATCH"].includes(c.req.method)) return next()
  if (!c.req.header("content-type")?.toLowerCase().includes("application/json")) return next()
  const text = await c.req.raw.clone().text()
  if (!text.trim()) return next()
  if (text.length > MAX_REQUEST_BODY_BYTES) throw new HTTPException(413, { message: "Request body too large" })
  const parsed = parseJsonBody(text)
  if (jsonDepth(parsed) > MAX_JSON_DEPTH) throw new HTTPException(400, { message: "JSON body is too deeply nested" })
  return next()
}

function isAllowedOrigin(input: string | undefined, opts?: { cors?: string[] }) {
  if (!input) return false
  if (input.startsWith("http://localhost:")) return true
  if (input.startsWith("http://127.0.0.1:")) return true
  if (input.startsWith("http://[::1]:")) return true
  if (input === "tauri://localhost" || input === "http://tauri.localhost" || input === "https://tauri.localhost")
    return true
  if (/^https:\/\/github\.com\/Yecyi\/OpenAGt(\/.*)?$/.test(input)) return true
  return opts?.cors?.includes(input) === true
}

function jsonDepth(value: unknown) {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }]
  let max = 0
  while (stack.length > 0) {
    const next = stack.pop()!
    max = Math.max(max, next.depth)
    if (max > MAX_JSON_DEPTH) return max
    if (!next.value || typeof next.value !== "object") continue
    for (const child of Array.isArray(next.value) ? next.value : Object.values(next.value)) {
      stack.push({ value: child, depth: next.depth + 1 })
    }
  }
  return max
}

function parseJsonBody(text: string) {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body" })
  }
}

const zipped = compress()
export const CompressionMiddleware: MiddlewareHandler = (c, next) => {
  const path = c.req.path
  const method = c.req.method
  if (path === "/event" || path === "/global/event") return next()
  if (method === "POST" && /\/session\/[^/]+\/(message|prompt_async)$/.test(path)) return next()
  return zipped(c, next)
}
