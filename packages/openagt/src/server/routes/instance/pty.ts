import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import type { UpgradeWebSocket } from "hono/ws"
import { Effect } from "effect"
import { randomUUID } from "node:crypto"
import z from "zod"
import { AppRuntime } from "@/effect/app-runtime"
import { Pty } from "@/pty"
import { PtyID } from "@/pty/schema"
import { NotFoundError } from "@/storage"
import { errors } from "../../error"
import { jsonRequest, runRequest } from "./trace"

const PTY_TICKET_TTL_MS = 60_000
const ptyTickets = new Map<string, { ptyID: string; directory: string; expires: number }>()

function createPtyTicket(ptyID: string, directory: string) {
  const token = randomUUID()
  const expires = Date.now() + PTY_TICKET_TTL_MS
  ptyTickets.set(token, { ptyID, directory, expires })
  return { token, expires }
}

function consumePtyTicket(token: string | undefined, ptyID: string, directory: string) {
  if (!token) return false
  const ticket = ptyTickets.get(token)
  ptyTickets.delete(token)
  if (!ticket) return false
  if (ticket.expires < Date.now()) return false
  return ticket.ptyID === ptyID && ticket.directory === directory
}

export function PtyRoutes(upgradeWebSocket: UpgradeWebSocket) {
  return new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List PTY sessions",
        description: "Get a list of all active pseudo-terminal (PTY) sessions managed by OpenCode.",
        operationId: "pty.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Pty.Info.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("PtyRoutes.list", c, function* () {
          const pty = yield* Pty.Service
          return yield* pty.list()
        }),
    )
    .post(
      "/",
      describeRoute({
        summary: "Create PTY session",
        description: "Create a new pseudo-terminal (PTY) session for running shell commands and processes.",
        operationId: "pty.create",
        responses: {
          200: {
            description: "Created session",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Pty.CreateInput),
      async (c) =>
        jsonRequest("PtyRoutes.create", c, function* () {
          const pty = yield* Pty.Service
          return yield* pty.create(c.req.valid("json"))
        }),
    )
    .post(
      "/:ptyID/connect-ticket",
      describeRoute({
        summary: "Create PTY connection ticket",
        description: "Create a short-lived one-time ticket for a PTY WebSocket connection.",
        operationId: "pty.connectTicket",
        responses: {
          200: {
            description: "Connection ticket",
            content: {
              "application/json": {
                schema: resolver(z.object({ token: z.string(), expires: z.number() })),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyID: PtyID.zod })),
      validator("query", z.object({ directory: z.string() })),
      async (c) => {
        const info = await runRequest(
          "PtyRoutes.connectTicket",
          c,
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            return yield* pty.get(c.req.valid("param").ptyID)
          }),
        )
        if (!info) throw new NotFoundError({ message: "Session not found" })
        return c.json(createPtyTicket(c.req.valid("param").ptyID, c.req.valid("query").directory))
      },
    )
    .get(
      "/:ptyID",
      describeRoute({
        summary: "Get PTY session",
        description: "Retrieve detailed information about a specific pseudo-terminal (PTY) session.",
        operationId: "pty.get",
        responses: {
          200: {
            description: "Session info",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyID: PtyID.zod })),
      async (c) => {
        const info = await runRequest(
          "PtyRoutes.get",
          c,
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            return yield* pty.get(c.req.valid("param").ptyID)
          }),
        )
        if (!info) {
          throw new NotFoundError({ message: "Session not found" })
        }
        return c.json(info)
      },
    )
    .put(
      "/:ptyID",
      describeRoute({
        summary: "Update PTY session",
        description: "Update properties of an existing pseudo-terminal (PTY) session.",
        operationId: "pty.update",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Pty.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ ptyID: PtyID.zod })),
      validator("json", Pty.UpdateInput),
      async (c) =>
        jsonRequest("PtyRoutes.update", c, function* () {
          const pty = yield* Pty.Service
          return yield* pty.update(c.req.valid("param").ptyID, c.req.valid("json"))
        }),
    )
    .delete(
      "/:ptyID",
      describeRoute({
        summary: "Remove PTY session",
        description: "Remove and terminate a specific pseudo-terminal (PTY) session.",
        operationId: "pty.remove",
        responses: {
          200: {
            description: "Session removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyID: PtyID.zod })),
      async (c) =>
        jsonRequest("PtyRoutes.remove", c, function* () {
          const pty = yield* Pty.Service
          yield* pty.remove(c.req.valid("param").ptyID)
          return true
        }),
    )
    .get(
      "/:ptyID/connect",
      describeRoute({
        summary: "Connect to PTY session",
        description: "Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.",
        operationId: "pty.connect",
        responses: {
          200: {
            description: "Connected session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ ptyID: PtyID.zod })),
      upgradeWebSocket(async (c) => {
        type Handler = {
          onMessage: (message: string | ArrayBuffer) => void
          onClose: () => void
        }

        const id = PtyID.zod.parse(c.req.param("ptyID"))
        const directory = c.req.query("directory") ?? ""
        if (c.req.query("ticket") && !consumePtyTicket(c.req.query("ticket"), id, directory)) {
          throw new Error("Invalid or expired PTY connection ticket")
        }
        const cursor = (() => {
          const value = c.req.query("cursor")
          if (!value) return
          const parsed = Number(value)
          if (!Number.isSafeInteger(parsed) || parsed < -1) return
          return parsed
        })()
        let handler: Handler | undefined
        if (
          !(await runRequest(
            "PtyRoutes.connect",
            c,
            Effect.gen(function* () {
              const pty = yield* Pty.Service
              return yield* pty.get(id)
            }),
          ))
        ) {
          throw new Error("Session not found")
        }

        type Socket = {
          readyState: number
          send: (data: string | Uint8Array | ArrayBuffer) => void
          close: (code?: number, reason?: string) => void
        }

        const isSocket = (value: unknown): value is Socket => {
          if (!value || typeof value !== "object") return false
          if (!("readyState" in value)) return false
          if (!("send" in value) || typeof (value as { send?: unknown }).send !== "function") return false
          if (!("close" in value) || typeof (value as { close?: unknown }).close !== "function") return false
          return typeof (value as { readyState?: unknown }).readyState === "number"
        }

        const pending: string[] = []
        let ready = false

        return {
          async onOpen(_event, ws) {
            const socket = ws.raw
            if (!isSocket(socket)) {
              ws.close()
              return
            }
            handler = await AppRuntime.runPromise(
              Effect.gen(function* () {
                const pty = yield* Pty.Service
                return yield* pty.connect(id, socket, cursor)
              }).pipe(Effect.withSpan("PtyRoutes.connect.open")),
            )
            ready = true
            for (const msg of pending) handler?.onMessage(msg)
            pending.length = 0
          },
          onMessage(event) {
            if (typeof event.data !== "string") return
            if (!ready) {
              pending.push(event.data)
              return
            }
            handler?.onMessage(event.data)
          },
          onClose() {
            handler?.onClose()
          },
          onError() {
            handler?.onClose()
          },
        }
      }),
    )
}
