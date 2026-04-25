import { describe, expect, test } from "bun:test"
import { EventEnvelope } from "../../src/server/routes/instance/event"

describe("server event envelope", () => {
  test("parses server events with trace metadata", () => {
    const result = EventEnvelope.parse({
      schema_version: 1,
      event_id: crypto.randomUUID(),
      trace_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type: "server.connected",
      properties: {},
    })

    expect(result.schema_version).toBe(1)
    expect(result.type).toBe("server.connected")
  })
})
