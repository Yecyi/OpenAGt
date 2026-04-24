import z from "zod"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Log } from "@/util"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { AsyncQueue } from "@/util/queue"

const log = Log.create({ service: "server" })

function eventEnvelope(event: { type: string; properties: unknown }) {
  const properties =
    typeof event.properties === "object" && event.properties !== null && !Array.isArray(event.properties)
      ? event.properties
      : {}
  const sessionID =
    "sessionID" in properties && typeof properties.sessionID === "string"
      ? properties.sessionID
      : "session_id" in properties && typeof properties.session_id === "string"
        ? properties.session_id
        : undefined
  return {
    schema_version: 1,
    event_id: crypto.randomUUID(),
    trace_id: sessionID ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...event,
  }
}

export const EventRoutes = () =>
  new Hono().get(
    "/event",
    describeRoute({
      summary: "Subscribe to events",
      description: "Get events",
      operationId: "event.subscribe",
      responses: {
        200: {
          description: "Event stream",
          content: {
            "text/event-stream": {
              schema: resolver(
                z.union(BusEvent.payloads()).meta({
                  ref: "Event",
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      log.info("event connected")
      c.header("Cache-Control", "no-cache, no-transform")
      c.header("X-Accel-Buffering", "no")
      c.header("X-Content-Type-Options", "nosniff")
      return streamSSE(c, async (stream) => {
        const q = new AsyncQueue<string | null>()
        let done = false

        q.push(
          JSON.stringify(eventEnvelope({
            type: "server.connected",
            properties: {},
          })),
        )

        // Send heartbeat every 10s to prevent stalled proxy streams.
        const heartbeat = setInterval(() => {
          q.push(
            JSON.stringify(eventEnvelope({
              type: "server.heartbeat",
              properties: {},
            })),
          )
        }, 10_000)

        const stop = () => {
          if (done) return
          done = true
          clearInterval(heartbeat)
          unsub()
          q.push(null)
          log.info("event disconnected")
        }

        const unsub = Bus.subscribeAll((event) => {
          q.push(JSON.stringify(eventEnvelope(event)))
          if (event.type === Bus.InstanceDisposed.type) {
            stop()
          }
        })

        stream.onAbort(stop)

        try {
          for await (const data of q) {
            if (data === null) return
            await stream.writeSSE({ data })
          }
        } finally {
          stop()
        }
      })
    },
  )
