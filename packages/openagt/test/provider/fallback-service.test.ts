import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "../../src/config"
import { Provider } from "../../src/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { ProviderFallback } from "../../src/provider/fallback-service"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"

function createConfigLayer(config: unknown) {
  return Layer.succeed(
    Config.Service,
    Config.Service.of({
      get: () => Effect.succeed(config as any),
      getGlobal: () => Effect.succeed(config as any),
      getConsoleState: () => Effect.succeed({} as any),
      update: () => Effect.void,
      updateGlobal: () => Effect.succeed(config as any),
      invalidate: () => Effect.void,
      invalidateDirectory: () => Effect.void,
      directories: () => Effect.succeed([]),
      waitForDependencies: () => Effect.void,
    }),
  )
}

function createProviderLayer(models: Provider.Model[]) {
  const table = new Map(models.map((model) => [`${model.providerID}/${model.id}`, model]))
  return Layer.succeed(
    Provider.Service,
    Provider.Service.of({
      list: () => Effect.succeed({} as Record<ProviderID, Provider.Info>),
      getProvider: (_providerID) => Effect.fail(new Error("unused")) as any,
      getModel: (providerID, modelID) => {
        const found = table.get(`${providerID}/${modelID}`)
        if (!found) return Effect.fail(new Error("model not found")) as any
        return Effect.succeed(found) as any
      },
      getLanguage: (_model) => Effect.fail(new Error("unused")) as any,
      closest: () => Effect.succeed(undefined) as any,
      getSmallModel: () => Effect.succeed(undefined) as any,
      defaultModel: () => Effect.fail(new Error("unused")) as any,
    }),
  )
}

function createBusLayer(events: Array<{ type: string; properties: unknown }> = []) {
  return Layer.succeed(
    Bus.Service,
    Bus.Service.of({
      publish: (def, properties) =>
        Effect.sync(() => {
          events.push({ type: def.type, properties })
        }),
      subscribe: () => Effect.fail(new Error("unused")) as any,
      subscribeAll: () => Effect.fail(new Error("unused")) as any,
      subscribeCallback: () => Effect.fail(new Error("unused")) as any,
      subscribeAllCallback: () => Effect.fail(new Error("unused")) as any,
      getRecentEvents: () => [],
      replayEvents: () => Effect.void,
    }),
  )
}

function model(providerID: string, id: string): Provider.Model {
  return {
    id: ModelID.make(id),
    providerID: ProviderID.make(providerID),
    name: `${providerID}/${id}`,
    api: { id: providerID, npm: "@ai-sdk/openai-compatible", url: "" },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      interleaved: false,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    headers: {},
    options: {},
    release_date: "2026-01-01",
  }
}

async function run<A, E>(config: unknown, models: Provider.Model[], effect: Effect.Effect<A, E, ProviderFallback.Service>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(ProviderFallback.layer),
      Effect.provide(createBusLayer()),
      Effect.provide(createProviderLayer(models)),
      Effect.provide(createConfigLayer(config)),
    ),
  )
}

describe("provider.fallback-service", () => {
  test("builds state from chain config and trims values", async () => {
    const state = await run(
      {
        provider: {
          primary: {
            fallback: {
              enabled: true,
              chain: [
                { provider: " backup ", model: " model-a " },
                { provider: "backup", model: "model-b" },
              ],
              maxRetries: 4,
            },
          },
        },
      },
      [],
      Effect.gen(function* () {
        const fallback = yield* ProviderFallback.Service
        return yield* fallback.createState("primary", "main")
      }),
    )

    expect(state).toBeDefined()
    expect(state?.chain).toEqual([
      { provider: "backup", model: "model-a" },
      { provider: "backup", model: "model-b" },
    ])
    expect(state?.maxRetries).toBe(4)
  })

  test("supports legacy provider/model shorthand", async () => {
    const state = await run(
      {
        provider: {
          primary: {
            fallback: {
              enabled: true,
              provider: "backup",
              model: "model-a",
            },
          },
        },
      },
      [],
      Effect.gen(function* () {
        const fallback = yield* ProviderFallback.Service
        return yield* fallback.createState("primary", "main")
      }),
    )

    expect(state).toBeDefined()
    expect(state?.chain).toEqual([{ provider: "backup", model: "model-a" }])
    expect(state?.maxRetries).toBe(3)
  })

  test("skips unavailable targets and advances to first available model", async () => {
    const selected = await run(
      {
        provider: {
          primary: {
            fallback: {
              enabled: true,
              maxRetries: 3,
              chain: [
                { provider: "backup", model: "missing" },
                { provider: "backup", model: "model-b" },
              ],
            },
          },
        },
      },
      [model("backup", "model-b")],
      Effect.gen(function* () {
        const fallback = yield* ProviderFallback.Service
        const state = yield* fallback.createState("primary", "main")
        if (!state) return undefined
        return yield* fallback.next(state)
      }),
    )

    expect(selected).toBeDefined()
    expect(selected?.model.providerID).toBe(ProviderID.make("backup"))
    expect(selected?.model.id).toBe(ModelID.make("model-b"))
    expect(selected?.state.index).toBe(1)
    expect(selected?.state.attempts).toBe(2)
  })

  test("respects retry flags when deciding fallback eligibility", async () => {
    const verdict = await run(
      {
        provider: {
          primary: {
            fallback: {
              enabled: true,
              provider: "backup",
              model: "model-a",
              retryOnRateLimit: false,
              retryOnServerError: true,
            },
          },
        },
      },
      [],
      Effect.gen(function* () {
        const fallback = yield* ProviderFallback.Service
        const state = yield* fallback.createState("primary", "main")
        if (!state) throw new Error("missing fallback state")
        const rate = yield* fallback.shouldFallback({ data: { statusCode: 429, message: "rate limited" } }, state)
        const server = yield* fallback.shouldFallback({ data: { statusCode: 503, message: "overloaded" } }, state)
        return { rate, server }
      }),
    )

    expect(verdict.rate).toBe(false)
    expect(verdict.server).toBe(true)
  })

  test("publishes the shared fallback bus event and returns a safe metrics snapshot", async () => {
    const events: Array<{ type: string; properties: unknown }> = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fallback = yield* ProviderFallback.Service
        const state = yield* fallback.createState("primary", "main")
        if (!state) throw new Error("missing fallback state")
        yield* fallback.next(state)
        fallback.recordAttempt("primary", false)
        const metrics = fallback.getMetrics()
        metrics.providerErrors.primary = 999
        return fallback.getMetrics()
      }).pipe(
        Effect.provide(ProviderFallback.layer),
        Effect.provide(createBusLayer(events)),
        Effect.provide(createProviderLayer([model("backup", "model-a")])),
        Effect.provide(
          createConfigLayer({
            provider: {
              primary: {
                fallback: {
                  enabled: true,
                  provider: "backup",
                  model: "model-a",
                },
              },
            },
          }),
        ),
      ),
    )

    expect(events.some((event) => event.type === BusEvent.FallbackHopEvent.type)).toBe(true)
    expect(result.providerErrors.primary).toBe(1)
  })
})
