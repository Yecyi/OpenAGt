import { Effect, Layer, Context } from "effect"
import type { Provider } from "@/provider"
import { Config } from "@/config"
import { Log } from "@/util"

const log = Log.create({ service: "provider.fallback" })

export interface Interface {
  readonly getWithFallback: (model: Provider.Model) => Effect.Effect<Provider.Model>
  readonly getFallback: (providerID: string, modelID: string) => Effect.Effect<Provider.Model | undefined>
  readonly shouldFallback: (error: unknown) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProviderFallback") {}

export const layer: Layer.Layer<Service, never, Config.Service | Provider.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const provider = yield* Provider.Service

    const getWithFallback: Interface["getWithFallback"] = Effect.fn("ProviderFallback.getWithFallback")(
      function* (model: Provider.Model) {
        const cfg = yield* config.get()
        const providerConfig = cfg.provider?.[model.providerID]

        if (!providerConfig?.fallback?.enabled) {
          return model
        }

        const fb = providerConfig.fallback
        if (!fb?.provider || !fb?.model) {
          return model
        }

        return model
      },
    )

    const getFallback: Interface["getFallback"] = Effect.fn("ProviderFallback.getFallback")(
      function* (providerID: string, modelID: string) {
        const cfg = yield* config.get()
        const providerConfig = cfg.provider?.[providerID]

        if (!providerConfig?.fallback?.enabled) {
          return undefined
        }

        const fb = providerConfig.fallback
        if (!fb?.provider || !fb?.model) {
          return undefined
        }

        try {
          const fallbackModel = yield* provider.getModel(fb.provider, fb.model)
          log.info("using fallback", { from: `${providerID}/${modelID}`, to: `${fb.provider}/${fb.model}` })
          return fallbackModel
        } catch {
          log.warn("fallback model unavailable", { provider: fb.provider, model: fb.model })
          return undefined
        }
      },
    )

    const shouldFallback: Interface["shouldFallback"] = Effect.fn("ProviderFallback.shouldFallback")(
      function* (error: unknown) {
        if (!isRecord(error)) return false
        const data = (error as any).data
        if (!isRecord(data)) return false

        const status = data.statusCode as number | undefined
        const msg = typeof data.message === "string" ? data.message.toLowerCase() : ""

        if (status === 429) return true
        if (status !== undefined && status >= 500 && status < 600) return true
        if (msg.includes("rate limit") || msg.includes("overloaded")) return true

        return false
      },
    )

    return Service.of({ getWithFallback, getFallback, shouldFallback })
  }),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(Provider.defaultLayer)),
)

export * as ProviderFallback from "./fallback-service"
