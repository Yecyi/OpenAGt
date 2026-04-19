import { Effect, Layer, Context, Option } from "effect"
import { Provider } from "@/provider"
import { Config } from "@/config"
import { Log } from "@/util"
import { ModelID, ProviderID } from "./schema"

const log = Log.create({ service: "provider.fallback" })

export interface FallbackEntry {
  provider: string
  model: string
}

export interface FallbackState {
  baseProviderID: string
  baseModelID: string
  chain: FallbackEntry[]
  index: number
  attempts: number
  maxRetries: number
  retryOnRateLimit: boolean
  retryOnServerError: boolean
}

export interface Interface {
  readonly createState: (providerID: string, modelID: string) => Effect.Effect<FallbackState | undefined>
  readonly next: (state: FallbackState) => Effect.Effect<{ model: Provider.Model; state: FallbackState } | undefined>
  readonly shouldFallback: (error: unknown, state: FallbackState) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProviderFallback") {}

type ParsedError = {
  statusCode?: number
  message: string
}

export const layer: Layer.Layer<Service, never, Config.Service | Provider.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const provider = yield* Provider.Service

    const createState: Interface["createState"] = Effect.fn("ProviderFallback.createState")(function* (
      providerID: string,
      modelID: string,
    ) {
      const cfg = yield* config.get()
      const fallback = cfg.provider?.[providerID]?.fallback
      if (!fallback?.enabled) return undefined

      const normalized =
        fallback.chain && fallback.chain.length > 0
          ? fallback.chain
              .filter((item) => item.provider.trim() && item.model.trim())
              .map((item) => ({
                provider: item.provider.trim(),
                model: item.model.trim(),
              }))
          : fallback.provider && fallback.model
            ? [{ provider: fallback.provider.trim(), model: fallback.model.trim() }]
            : []
      if (normalized.length === 0) return undefined

      return {
        baseProviderID: providerID,
        baseModelID: modelID,
        chain: normalized,
        index: -1,
        attempts: 0,
        maxRetries: fallback.maxRetries ?? 3,
        retryOnRateLimit: fallback.retryOnRateLimit ?? true,
        retryOnServerError: fallback.retryOnServerError ?? true,
      }
    })

    const next: Interface["next"] = Effect.fn("ProviderFallback.next")(function* (state: FallbackState) {
      if (state.attempts >= state.maxRetries) return undefined

      let index = state.index + 1
      let attempts = state.attempts
      while (index < state.chain.length && attempts < state.maxRetries) {
        const entry = state.chain[index]
        const fallbackModel = yield* provider
          .getModel(ProviderID.make(entry.provider), ModelID.make(entry.model))
          .pipe(Effect.option)
        attempts += 1
        if (Option.isSome(fallbackModel)) {
          const nextState: FallbackState = { ...state, index, attempts }
          log.info("using fallback", {
            from: `${state.baseProviderID}/${state.baseModelID}`,
            to: `${entry.provider}/${entry.model}`,
            attempts: nextState.attempts,
          })
          return { model: fallbackModel.value, state: nextState }
        }
        log.warn("fallback model unavailable", { provider: entry.provider, model: entry.model })
        index += 1
      }
      return undefined
    })

    const shouldFallback: Interface["shouldFallback"] = Effect.fn("ProviderFallback.shouldFallback")(function* (
      error: unknown,
      state: FallbackState,
    ) {
      const parsed = parseError(error)
      if (!parsed) return false

      if (parsed.statusCode === 429) return state.retryOnRateLimit
      if (parsed.statusCode !== undefined && parsed.statusCode >= 500 && parsed.statusCode < 600) {
        return state.retryOnServerError
      }

      if (parsed.message.includes("rate limit")) return state.retryOnRateLimit
      if (parsed.message.includes("too many requests")) return state.retryOnRateLimit
      if (parsed.message.includes("overloaded")) return state.retryOnServerError
      return false
    })

    return Service.of({ createState, next, shouldFallback })
  }),
)

function parseError(error: unknown): ParsedError | undefined {
  if (!isRecord(error)) return undefined
  const data = isRecord(error.data) ? error.data : error
  const statusCode = typeof data.statusCode === "number" ? data.statusCode : undefined
  const message =
    typeof data.message === "string"
      ? data.message.toLowerCase()
      : typeof error.message === "string"
        ? error.message.toLowerCase()
        : ""
  if (statusCode === undefined && !message) return undefined
  return { statusCode, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(Provider.defaultLayer)),
)

export * as ProviderFallback from "./fallback-service"
