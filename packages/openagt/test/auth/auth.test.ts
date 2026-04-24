import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Auth } from "../../src/auth"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Auth.defaultLayer, node))

describe("Auth", () => {
  const withAuthEnv = <T>(content: string | undefined, fn: () => Promise<T>) => {
    const openagt = process.env.OPENAGT_AUTH_CONTENT
    const opencode = process.env.OPENCODE_AUTH_CONTENT
    if (content === undefined) delete process.env.OPENAGT_AUTH_CONTENT
    else process.env.OPENAGT_AUTH_CONTENT = content
    delete process.env.OPENCODE_AUTH_CONTENT
    return fn().finally(() => {
      if (openagt === undefined) delete process.env.OPENAGT_AUTH_CONTENT
      else process.env.OPENAGT_AUTH_CONTENT = openagt
      if (opencode === undefined) delete process.env.OPENCODE_AUTH_CONTENT
      else process.env.OPENCODE_AUTH_CONTENT = opencode
    })
  }

  it.live("validates auth content from environment", () =>
    provideTmpdirInstance(() =>
      Effect.promise(() =>
        withAuthEnv(
          JSON.stringify({
            anthropic: {
              type: "api",
              key: "sk-test",
            },
          }),
          () =>
            Effect.runPromise(
              Effect.gen(function* () {
                const auth = yield* Auth.Service
                const data = yield* auth.all()
                expect(data.anthropic?.type).toBe("api")
              }).pipe(Effect.provide(Auth.defaultLayer)),
            ),
        ),
      ),
    ),
  )

  it.live("fails on malformed auth content from environment", () =>
    provideTmpdirInstance(() =>
      Effect.promise(() =>
        withAuthEnv("{", async () => {
          await expect(
            Effect.runPromise(
              Effect.gen(function* () {
                const auth = yield* Auth.Service
                yield* auth.all()
              }).pipe(Effect.provide(Auth.defaultLayer)),
            ),
          ).rejects.toThrow("Failed to parse auth content")
        }),
      ),
    ),
  )

  it.live("fails on schema-invalid auth content from environment", () =>
    provideTmpdirInstance(() =>
      Effect.promise(() =>
        withAuthEnv(
          JSON.stringify({
            anthropic: {
              type: "api",
            },
          }),
          async () => {
            await expect(
              Effect.runPromise(
                Effect.gen(function* () {
                  const auth = yield* Auth.Service
                  yield* auth.all()
                }).pipe(Effect.provide(Auth.defaultLayer)),
              ),
            ).rejects.toThrow("Invalid auth content")
          },
        ),
      ),
    ),
  )

  it.live("set normalizes trailing slashes in keys", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com/", {
          type: "wellknown",
          key: "TOKEN",
          token: "abc",
        })
        const data = yield* auth.all()
        expect(data["https://example.com"]).toBeDefined()
        expect(data["https://example.com/"]).toBeUndefined()
      }),
    ),
  )

  it.live("set cleans up pre-existing trailing-slash entry", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com/", {
          type: "wellknown",
          key: "TOKEN",
          token: "old",
        })
        yield* auth.set("https://example.com", {
          type: "wellknown",
          key: "TOKEN",
          token: "new",
        })
        const data = yield* auth.all()
        const keys = Object.keys(data).filter((key) => key.includes("example.com"))
        expect(keys).toEqual(["https://example.com"])
        const entry = data["https://example.com"]!
        expect(entry.type).toBe("wellknown")
        if (entry.type === "wellknown") expect(entry.token).toBe("new")
      }),
    ),
  )

  it.live("remove deletes both trailing-slash and normalized keys", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com", {
          type: "wellknown",
          key: "TOKEN",
          token: "abc",
        })
        yield* auth.remove("https://example.com/")
        const data = yield* auth.all()
        expect(data["https://example.com"]).toBeUndefined()
        expect(data["https://example.com/"]).toBeUndefined()
      }),
    ),
  )

  it.live("set and remove are no-ops on keys without trailing slashes", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("anthropic", {
          type: "api",
          key: "sk-test",
        })
        const data = yield* auth.all()
        expect(data["anthropic"]).toBeDefined()
        yield* auth.remove("anthropic")
        const after = yield* auth.all()
        expect(after["anthropic"]).toBeUndefined()
      }),
    ),
  )

  it.live("validates OPENAGT_AUTH_CONTENT with the same schema as disk auth", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const previous = process.env.OPENAGT_AUTH_CONTENT
        process.env.OPENAGT_AUTH_CONTENT = JSON.stringify({ anthropic: { type: "api" } })
        const auth = yield* Auth.Service
        const result = yield* Effect.exit(auth.all())
        if (previous === undefined) delete process.env.OPENAGT_AUTH_CONTENT
        else process.env.OPENAGT_AUTH_CONTENT = previous
        expect(result._tag).toBe("Failure")
      }),
    ),
  )
})
