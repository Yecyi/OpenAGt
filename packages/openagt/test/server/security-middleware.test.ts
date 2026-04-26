import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import {
  BodyLimitMiddleware,
  ErrorMiddleware,
  JsonDepthMiddleware,
  LocalOriginMiddleware,
} from "../../src/server/middleware"

function app() {
  return new Hono()
    .onError(ErrorMiddleware)
    .use(BodyLimitMiddleware)
    .use(JsonDepthMiddleware)
    .use(LocalOriginMiddleware())
    .post("/json", async (c) => c.json(await c.req.json()))
}

describe("server security middleware", () => {
  test("rejects oversized request bodies by content-length", async () => {
    const response = await app().request("/json", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(11 * 1024 * 1024),
      },
      body: "{}",
    })

    expect(response.status).toBe(413)
  })

  test("rejects deeply nested JSON bodies", async () => {
    const response = await app().request("/json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `${"[".repeat(300)}0${"]".repeat(300)}`,
    })

    expect(response.status).toBe(400)
  })

  test("rejects unsafe methods from unapproved browser origins", async () => {
    const response = await app().request("/json", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.invalid",
      },
      body: "{}",
    })

    expect(response.status).toBe(403)
  })
})

